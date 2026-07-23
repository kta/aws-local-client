import {
  ExecuteStatementCommand,
  ListBackupsCommand,
} from "@aws-sdk/client-dynamodb";
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  GetBucketTaggingCommand,
  ListObjectsV2Command,
  PutBucketTaggingCommand,
} from "@aws-sdk/client-s3";
import {
  CreateTopicCommand,
  DeleteTopicCommand,
  ListTagsForResourceCommand,
  TagResourceCommand,
} from "@aws-sdk/client-sns";
import { DescribeReplicationGroupsCommand } from "@aws-sdk/client-elasticache";
import { ListDeadLetterSourceQueuesCommand } from "@aws-sdk/client-sqs";
import { makeClient } from "./emulator";
import {
  E2E_ENDPOINT,
  isUnsupportedError,
  makeElastiCacheClient,
  makeS3Client,
  makeSnsClient,
  makeSqsClient,
} from "./aws";

/**
 * Emulator capability registry.
 *
 * Emulators implement different subsets of each AWS service (kumo, for
 * example, supports RDS instance CRUD but not reboot/snapshots/parameter
 * groups). Instead of classifying "which emulator is this" — a model that
 * breaks as soon as one emulator partially implements a family — every
 * capability-branching test declares the operations it actually exercises and
 * `gate()` probes the live emulator for exactly those.
 *
 * Rules (see docs/superpowers/specs/2026-07-22-kumo-emulator-capability-gates-design.md):
 * - AND gating: a "supported"-side test gates on ALL operations it calls.
 * - Symmetry: every gated test has an unsupported-side counterpart asserting
 *   the banner / error UI.
 * - Coverage guard: each spec's `after` asserts at least one test of every
 *   requirement family ran, so no capability combination silently yields a
 *   requirement with zero verification.
 *
 * Probes run once per capability per worker and are memoized. A probe only
 * answers "unsupported" for errors that look like "this operation is not
 * implemented here" (isUnsupportedError); a NotFound-style rejection proves
 * the operation exists, and anything else (a real outage) is re-thrown so it
 * cannot masquerade as a skip.
 */
export type CapabilityId =
  | "dynamodb.partiql"
  | "dynamodb.backups"
  | "rds.instances.describe"
  | "rds.instances.create"
  | "rds.instances.reboot"
  | "rds.snapshots.describe"
  | "rds.snapshots.restore"
  | "rds.parameterGroups.describe"
  | "elasticache.describe"
  | "sqs.dlqSources"
  | "sns.topicTags"
  | "s3.bucketTagging"
  | "s3.folderKeys";

/** Unsupported-operation shapes seen in raw response bodies across emulators. */
function isUnsupportedText(text: string): boolean {
  return /unknown ?operation|unknownaction|not ?implemented|not supported|invalidaction|is not valid|pro feature/i.test(
    text,
  );
}

/** NotFound-style rejections prove the operation itself is implemented. */
function isNotFoundText(text: string): boolean {
  return /notfound|not found|does not exist/i.test(text);
}

/**
 * Classify an AWS SDK error thrown by a probe call: `false` when the emulator
 * does not implement the operation, `true` when it answered with any other
 * service error (it understood the call — e.g. ResourceNotFound for a probe
 * against a deliberately missing resource). Transport errors are re-thrown.
 */
function serviceErrorMeansImplemented(e: unknown): boolean {
  if (isUnsupportedError(e)) return false;
  const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  if (status !== undefined) return true;
  throw e;
}

/**
 * Raw RDS Query-protocol call. The AWS SDK cannot be used for RDS probes:
 * kumo answers unsupported RDS actions with a JSON error body on this XML
 * protocol, which the SDK turns into an opaque deserialization error. A raw
 * HTTP call lets us classify the body text directly on every emulator.
 * The `api/rds` User-Agent token is required by kumo to disambiguate action
 * names shared across services (e.g. CreateDBInstance vs DocumentDB).
 */
async function rdsQuery(
  action: string,
  params: Record<string, string> = {},
): Promise<{ ok: boolean; body: string }> {
  const form = new URLSearchParams({ Action: action, Version: "2014-10-31", ...params });
  const res = await fetch(`${E2E_ENDPOINT}/`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=utf-8",
      "user-agent": "aws-sdk-js/3.0 api/rds#3.0",
      // Emulators do not verify signatures but some route by the credential scope.
      authorization:
        "AWS4-HMAC-SHA256 Credential=dummy/20260101/us-east-1/rds/aws4_request, SignedHeaders=host, Signature=dummy",
    },
    body: form.toString(),
  });
  return { ok: res.ok, body: await res.text() };
}

/** RDS describe-style probe: the call itself must succeed. */
async function rdsDescribeProbe(action: string): Promise<boolean> {
  const { ok, body } = await rdsQuery(action);
  if (ok) return true;
  if (isUnsupportedText(body)) return false;
  throw new Error(`capability probe ${action} failed unexpectedly: ${body.slice(0, 300)}`);
}

/**
 * RDS mutation probe against a deliberately missing resource: a NotFound
 * answer proves the operation is implemented without touching real state.
 */
async function rdsNotFoundProbe(
  action: string,
  params: Record<string, string>,
): Promise<boolean> {
  const { ok, body } = await rdsQuery(action, params);
  if (ok) return true;
  if (isUnsupportedText(body)) return false;
  if (isNotFoundText(body)) return true;
  throw new Error(`capability probe ${action} failed unexpectedly: ${body.slice(0, 300)}`);
}

const PROBE_STAMP = Date.now();

const PROBES: Record<CapabilityId, () => Promise<boolean>> = {
  "dynamodb.partiql": async () => {
    try {
      await makeClient().send(
        new ExecuteStatementCommand({ Statement: 'SELECT * FROM "nlsd_cap_probe_missing"' }),
      );
      return true;
    } catch (e) {
      return serviceErrorMeansImplemented(e);
    }
  },

  "dynamodb.backups": async () => {
    try {
      await makeClient().send(new ListBackupsCommand({}));
      return true;
    } catch (e) {
      return serviceErrorMeansImplemented(e);
    }
  },

  "rds.instances.describe": () => rdsDescribeProbe("DescribeDBInstances"),

  // Mirrors the old rds.e2e.ts probe: any create rejection (floci's default
  // docker-socket-less start rejects creates with a non-unsupported error)
  // counts as "not create-capable".
  "rds.instances.create": async () => {
    const id = `nlsd-cap-probe-${PROBE_STAMP}`;
    const { ok } = await rdsQuery("CreateDBInstance", {
      DBInstanceIdentifier: id,
      Engine: "mysql",
      DBInstanceClass: "db.t3.micro",
      MasterUsername: "admin",
      MasterUserPassword: "password123",
      AllocatedStorage: "20",
    });
    if (!ok) return false;
    // Cleanup is best effort; the probe instance is uniquely named.
    await rdsQuery("DeleteDBInstance", {
      DBInstanceIdentifier: id,
      SkipFinalSnapshot: "true",
    }).catch(() => {});
    return true;
  },

  "rds.instances.reboot": () =>
    rdsNotFoundProbe("RebootDBInstance", { DBInstanceIdentifier: "nlsd-cap-probe-missing" }),

  "rds.snapshots.describe": () => rdsDescribeProbe("DescribeDBSnapshots"),

  "rds.snapshots.restore": () =>
    rdsNotFoundProbe("RestoreDBInstanceFromDBSnapshot", {
      DBInstanceIdentifier: "nlsd-cap-probe-restored",
      DBSnapshotIdentifier: "nlsd-cap-probe-missing",
    }),

  "rds.parameterGroups.describe": () => rdsDescribeProbe("DescribeDBParameterGroups"),

  // ElastiCache is Pro-only on localstack:3 (rejects describe with an
  // unsupported/pro-feature error); ministack/floci/kumo implement it. A
  // successful DescribeReplicationGroups (or any non-unsupported service error)
  // proves the API is routed.
  "elasticache.describe": async () => {
    try {
      await makeElastiCacheClient().send(new DescribeReplicationGroupsCommand({}));
      return true;
    } catch (e) {
      return serviceErrorMeansImplemented(e);
    }
  },

  // A missing queue is enough: QueueDoesNotExist proves the action is routed.
  "sqs.dlqSources": async () => {
    try {
      await makeSqsClient().send(
        new ListDeadLetterSourceQueuesCommand({
          QueueUrl: `${E2E_ENDPOINT}/000000000000/nlsd-cap-probe-missing`,
        }),
      );
      return true;
    } catch (e) {
      return serviceErrorMeansImplemented(e);
    }
  },

  // Functional round-trip: kumo's TagResource answers success without storing
  // the tag, so only "the tag comes back from ListTagsForResource" proves it.
  "sns.topicTags": async () => {
    const sns = makeSnsClient();
    const { TopicArn } = await sns.send(
      new CreateTopicCommand({ Name: `nlsd-cap-probe-${PROBE_STAMP}` }),
    );
    try {
      await sns.send(
        new TagResourceCommand({
          ResourceArn: TopicArn,
          Tags: [{ Key: "probe", Value: "1" }],
        }),
      );
      const got = await sns.send(new ListTagsForResourceCommand({ ResourceArn: TopicArn }));
      return (got.Tags ?? []).some((t) => t.Key === "probe");
    } catch (e) {
      serviceErrorMeansImplemented(e); // re-throws transport errors
      return false;
    } finally {
      await sns.send(new DeleteTopicCommand({ TopicArn })).catch(() => {});
    }
  },

  // Functional round-trip: kumo mis-routes PutBucketTagging to CreateBucket,
  // so only "the tag actually persisted" proves the capability.
  "s3.bucketTagging": async () => {
    const s3 = makeS3Client();
    const bucket = `nlsd-cap-probe-${PROBE_STAMP}`;
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    try {
      await s3.send(
        new PutBucketTaggingCommand({
          Bucket: bucket,
          Tagging: { TagSet: [{ Key: "probe", Value: "1" }] },
        }),
      );
      const got = await s3.send(new GetBucketTaggingCommand({ Bucket: bucket }));
      return (got.TagSet ?? []).some((t) => t.Key === "probe");
    } catch (e) {
      serviceErrorMeansImplemented(e); // re-throws transport errors
      return false;
    } finally {
      await s3.send(new DeleteBucketCommand({ Bucket: bucket })).catch(() => {});
    }
  },

  // Functional round-trip: kumo strips the trailing slash from "folder marker"
  // keys ("p/" is stored as "p"), which breaks prefix navigation. The
  // capability holds only when the slash-suffixed key survives. The marker is
  // PUT over raw HTTP because the JS SDK normalizes the trailing slash out of
  // the request path (the app's Rust SDK preserves it).
  "s3.folderKeys": async () => {
    const s3 = makeS3Client();
    const bucket = `nlsd-cap-probe-fk-${PROBE_STAMP}`;
    const markerUrl = `${E2E_ENDPOINT}/${bucket}/probe/`;
    // Emulators do not verify signatures but some route by the credential scope.
    const authorization =
      "AWS4-HMAC-SHA256 Credential=dummy/20260101/us-east-1/s3/aws4_request, SignedHeaders=host, Signature=dummy";
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    try {
      const res = await fetch(markerUrl, { method: "PUT", headers: { authorization } });
      if (!res.ok) return false;
      const listed = await s3.send(
        new ListObjectsV2Command({ Bucket: bucket, Delimiter: "/" }),
      );
      return (
        (listed.CommonPrefixes ?? []).some((p) => p.Prefix === "probe/") ||
        (listed.Contents ?? []).some((o) => o.Key === "probe/")
      );
    } catch (e) {
      serviceErrorMeansImplemented(e); // re-throws transport errors
      return false;
    } finally {
      await fetch(markerUrl, { method: "DELETE", headers: { authorization } }).catch(() => {});
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: "probe" })).catch(() => {});
      await s3.send(new DeleteBucketCommand({ Bucket: bucket })).catch(() => {});
    }
  },
};

const cache = new Map<CapabilityId, Promise<boolean>>();

/** Probe (memoized) whether the emulator under test supports a capability. */
export function supports(id: CapabilityId): Promise<boolean> {
  let p = cache.get(id);
  if (!p) {
    p = PROBES[id]().then((v) => {
      console.log(`[capability] ${id} = ${v ? "supported" : "unsupported"}`);
      return v;
    });
    cache.set(id, p);
  }
  return p;
}

export type CapabilityCondition = {
  /** Run only when ALL of these are supported (AND over the ops the test calls). */
  on?: CapabilityId[];
  /** Run only when NONE of these are supported. */
  off?: CapabilityId[];
  /** Run unless ALL of these are supported (the "partial support" middle case). */
  notAll?: CapabilityId[];
};

const ranByFamily = new Map<string, number>();

/** Record that a test of `family` ran (for unconditional tests). */
export function markCovered(family: string): void {
  ranByFamily.set(family, (ranByFamily.get(family) ?? 0) + 1);
}

/**
 * Declarative capability gate. Call first in a gated test (a `function`, not
 * an arrow, so `this` is the Mocha context): skips the test unless the
 * condition holds, and records the run for the family's coverage guard.
 */
export async function gate(
  ctx: Mocha.Context,
  family: string,
  cond: CapabilityCondition,
): Promise<void> {
  for (const id of cond.on ?? []) {
    if (!(await supports(id))) ctx.skip();
  }
  for (const id of cond.off ?? []) {
    if (await supports(id)) ctx.skip();
  }
  if (cond.notAll && cond.notAll.length > 0) {
    const all = await Promise.all(cond.notAll.map((id) => supports(id)));
    if (all.every(Boolean)) ctx.skip();
  }
  markCovered(family);
}

/**
 * Coverage guard: fail loudly when capability gating left a requirement
 * family completely unverified on this emulator. Call from the spec's `after`.
 */
export function expectCovered(family: string): void {
  if (!ranByFamily.get(family)) {
    throw new Error(
      `coverage guard: no "${family}" test ran on this emulator — ` +
        `the capability gates left the requirement unverified`,
    );
  }
}

/** Like expectCovered, but only when ALL of `when` are supported (e.g. R48 is
 *  meaningless on an emulator whose RDS describe is unsupported). */
export async function expectCoveredIf(family: string, when: CapabilityId[]): Promise<void> {
  for (const id of when) {
    if (!(await supports(id))) return;
  }
  expectCovered(family);
}
