import {
  ListNamedQueriesCommand,
  ListWorkGroupsCommand,
  StartQueryExecutionCommand,
} from "@aws-sdk/client-athena";
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
  CreateRepositoryCommand,
  DeleteRepositoryCommand,
  DescribeRepositoriesCommand,
} from "@aws-sdk/client-ecr";
import {
  CreateTopicCommand,
  DeleteTopicCommand,
  ListTagsForResourceCommand,
  ListTopicsCommand,
  TagResourceCommand,
} from "@aws-sdk/client-sns";
import {
  CreateFunctionCommand,
  DeleteFunctionCommand,
  GetFunctionCommand,
  InvokeCommand,
  ListLayersCommand,
} from "@aws-sdk/client-lambda";
  AdminSetUserPasswordCommand,
  ListGroupsCommand,
  ListUserPoolsCommand,
} from "@aws-sdk/client-cognito-identity-provider";
  CreateSecretCommand,
  DeleteSecretCommand,
  DescribeSecretCommand,
  TagResourceCommand as SecretsTagResourceCommand,
} from "@aws-sdk/client-secrets-manager";
import { DescribeReplicationGroupsCommand } from "@aws-sdk/client-elasticache";
  CreateStackCommand,
  DeleteStackCommand,
  DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";
import { ListClustersCommand } from "@aws-sdk/client-ecs";
import { UpdateStateMachineCommand } from "@aws-sdk/client-sfn";
  CreateDomainCommand,
  DeleteDomainCommand,
  ListDomainNamesCommand,
} from "@aws-sdk/client-opensearch";
import { ListDeadLetterSourceQueuesCommand } from "@aws-sdk/client-sqs";
import {
  CreateApiKeyCommand,
  DeleteApiKeyCommand,
} from "@aws-sdk/client-api-gateway";
import { makeClient } from "./emulator";
import {
  awsQuery,
  cwQuery,
  E2E_ENDPOINT,
  isUnsupportedError,
  makeLambdaClient,
  makeApiGatewayClient,
  makeCognitoClient,
  makeElastiCacheClient,
  makeCfnClient,
  makeEcsClient,
  makeEcrClient,
  makeOpenSearchClient,
  makeAthenaClient,
  makeS3Client,
  makeSecretsManagerClient,
  makeSfnClient,
  makeSnsClient,
  makeSqsClient,
} from "./aws";
import { buildHandlerZip } from "./lambdaZip";

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
  | "cloudformation.resourceCreation"
  | "sqs.dlqSources"
  | "sfn.updateStateMachine"
  | "sns.topicTags"
  | "s3.bucketTagging"
  | "s3.folderKeys"
  | "lambda.invoke"
  | "lambda.layers";
  | "apigateway.apiKeys"
  | "apigateway.apiKeyDelete";
  | "cognito.userPools"
  | "cognito.groups"
  | "cognito.adminUserState";
  | "secretsmanager.tags";
  | "ecs.clusters";
  | "ecr.repositories"
  | "ecr.create";
  | "cloudwatch.metrics"
  | "cloudwatch.alarms";
  | "opensearch.domains"
  | "opensearch.create";
  | "athena.query"
  | "athena.workgroups"
  | "athena.namedQueries";

/** Unsupported-operation shapes seen in raw response bodies across emulators.
 *  `unknown service` covers kumo, which does not route the CloudWatch
 *  `monitoring` service at all (`{"__type":"UnknownService"}`). */
function isUnsupportedText(text: string): boolean {
  return /unknown ?operation|unknownaction|unknown ?service|not ?implemented|not supported|invalidaction|is not valid|pro feature/i.test(
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
 * Raw RDS Query-protocol call — a thin wrapper over the shared `awsQuery`
 * helper (`api/rds`, API version 2014-10-31), behaviour-identical to the
 * former inline implementation. The AWS SDK cannot be used for RDS probes:
 * kumo answers unsupported RDS actions with a JSON error body on this XML
 * protocol, which the SDK turns into an opaque deserialization error.
 */
function rdsQuery(
  action: string,
  params: Record<string, string> = {},
): Promise<{ ok: boolean; body: string }> {
  return awsQuery("rds", action, params, "2014-10-31");
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
  // Functional round-trip: kumo's CloudFormation is control-plane only — it
  // reaches CREATE_COMPLETE but never provisions the templated resource, so
  // only "the SNS topic the template declares actually exists afterwards"
  // proves resources are really created. Real emulators (ministack/floci/
  // localstack) provision it; kumo does not.
  "cloudformation.resourceCreation": async () => {
    const cfn = makeCfnClient();
    const sns = makeSnsClient();
    const stack = `nlsd-cap-cfn-${PROBE_STAMP}`;
    const topic = `nlsd-cap-cfn-topic-${PROBE_STAMP}`;
    const template = JSON.stringify({
      Resources: {
        ProbeTopic: { Type: "AWS::SNS::Topic", Properties: { TopicName: topic } },
      },
    });
    try {
      await cfn.send(new CreateStackCommand({ StackName: stack, TemplateBody: template }));
    } catch (e) {
      serviceErrorMeansImplemented(e); // re-throws transport errors
      return false; // any create rejection => not resource-creation-capable
    }
    try {
      // Wait for CREATE_COMPLETE (bounded), then check the real resource.
      for (let i = 0; i < 30; i++) {
        try {
          const out = await cfn.send(new DescribeStacksCommand({ StackName: stack }));
          const st = out.Stacks?.[0]?.StackStatus;
          if (st === "CREATE_COMPLETE") break;
          if (st?.endsWith("_FAILED")) return false;
        } catch {
          /* not ready yet */
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      const topics = await sns.send(new ListTopicsCommand({}));
      return (topics.Topics ?? []).some((t) => t.TopicArn?.includes(topic));
    } finally {
      await cfn.send(new DeleteStackCommand({ StackName: stack })).catch(() => {});
  // ECS control plane. localstack:3 is ECS-Pro-only and rejects ListClusters
  // as unsupported; ministack/floci implement it. A clean ListClusters (or any
  // non-unsupported service error) proves the control plane is available.
  "ecs.clusters": async () => {
    try {
      await makeEcsClient().send(new ListClustersCommand({}));
  // Domain describe: ListDomainNames must be routed. kumo answers unsupported
  // (its console has no OpenSearch); a NotFound-style/other service error proves
  // the operation exists.
  "opensearch.domains": async () => {
    try {
      await makeOpenSearchClient().send(new ListDomainNamesCommand({}));
      return true;
    } catch (e) {
      return serviceErrorMeansImplemented(e);
    }
  },

  // Domain create needs a real OpenSearch node: floci only creates one when
  // started with the docker socket mounted (T0). Any create rejection — the
  // socket-less "cannot start container" error included — counts as
  // not-create-capable, mirroring the rds.instances.create probe. The probe
  // domain is deleted promptly because floci spins up a heavy real container.
  "opensearch.create": async () => {
    const os = makeOpenSearchClient();
    const name = `nlsd-os-probe-${PROBE_STAMP % 100000}`;
    try {
      await os.send(new CreateDomainCommand({ DomainName: name }));
    } catch {
      return false;
    }
    await os.send(new DeleteDomainCommand({ DomainName: name })).catch(() => {});
    return true;
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

  // UpdateStateMachine is unimplemented on floci (UnsupportedOperation) and kumo
  // (InvalidAction). A missing-ARN probe distinguishes cleanly: localstack /
  // ministack answer StateMachineDoesNotExist (implemented), the others answer
  // an unsupported-shaped error.
  "sfn.updateStateMachine": async () => {
    try {
      await makeSfnClient().send(
        new UpdateStateMachineCommand({
          stateMachineArn:
            "arn:aws:states:us-east-1:000000000000:stateMachine:nlsd-cap-probe-missing",
          definition: '{"StartAt":"P","States":{"P":{"Type":"Pass","End":true}}}',
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

  // Functional round-trip: create a function, wait for it to become Active
  // (localstack goes Pending while the runtime container starts) and invoke it.
  // Only a 200 with no FunctionError proves the emulator can actually run code;
  // kumo routes Invoke but has "no runtime handler", so it fails here.
  "lambda.invoke": async () => {
    const lambda = makeLambdaClient();
    const name = `nlsd-cap-probe-inv-${PROBE_STAMP}`;
    try {
      await lambda.send(
        new CreateFunctionCommand({
          FunctionName: name,
          Runtime: "python3.12",
          Role: "arn:aws:iam::000000000000:role/nlsd-dummy",
          Handler: "index.handler",
          Code: { ZipFile: buildHandlerZip() },
        }),
      );
    } catch (e) {
      return serviceErrorMeansImplemented(e);
    }
    try {
      // Wait (best effort) for the function to become invokable.
      for (let i = 0; i < 30; i++) {
        const got = await lambda.send(new GetFunctionCommand({ FunctionName: name }));
        if (got.Configuration?.State === "Active") break;
        if (got.Configuration?.State === "Failed") return false;
        await new Promise((r) => setTimeout(r, 1000));
      }
      for (let i = 0; i < 20; i++) {
        try {
          const res = await lambda.send(
            new InvokeCommand({ FunctionName: name, Payload: Buffer.from('{"a":1}') }),
          );
          if (res.FunctionError) return false;
          return (res.StatusCode ?? 0) >= 200 && (res.StatusCode ?? 0) < 300;
        } catch (e) {
          if (isUnsupportedError(e)) return false;
          // ResourceConflict while Pending -> retry a few times.
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      return false;
    } finally {
      await lambda.send(new DeleteFunctionCommand({ FunctionName: name })).catch(() => {});
    }
  },

  // ListLayers is unavailable on some emulators (kumo answers with a
  // NoSuchBucket / 404 body rather than a classic unsupported signature).
  "lambda.layers": async () => {
    const lambda = makeLambdaClient();
    try {
      await lambda.send(new ListLayersCommand({}));
      return true;
    } catch (e) {
      if (isUnsupportedError(e)) return false;
      const err = e as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
      const text = `${err.name ?? ""} ${err.message ?? ""}`;
      if (/no ?such ?bucket|not ?found/i.test(text)) return false;
      if (err.$metadata?.httpStatusCode === 404) return false;
      throw e;
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

  // API-key create/list: kumo mis-routes API Gateway key operations to S3 and
  // rejects both create and list (NoSuchBucket / InvalidRequest — a 4xx service
  // error, not a clean "unsupported" signature), so only a successful create
  // proves support. floci implements create/list but NOT delete (see
  // apigateway.apiKeyDelete), so this capability covers the create/list side.
  "apigateway.apiKeys": async () => {
    const client = makeApiGatewayClient();
    try {
      const created = await client.send(
        new CreateApiKeyCommand({ name: `nlsd-cap-probe-${PROBE_STAMP}`, enabled: true }),
      );
      if (created.id) {
        await client.send(new DeleteApiKeyCommand({ apiKey: created.id })).catch(() => {});
      }
      return true;
    } catch (e) {
      if (isUnsupportedError(e)) return false;
      // A service error (any HTTP status, e.g. kumo's mis-routed 4xx) means the
      // emulator does not really implement API keys; a transport error re-throws.
      const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      if (status !== undefined) return false;
      throw e;
    }
  },

  // API-key delete: floci mis-routes DeleteApiKey to S3 and answers 404
  // NoSuchBucket even though create/list work, so the only proof of support is
  // a create+delete round-trip that both succeed. Kumo can't create keys at all
  // and is unsupported here too. The probe key is left behind when delete fails
  // (that is the condition under test); the ephemeral container is torn down.
  "apigateway.apiKeyDelete": async () => {
    const client = makeApiGatewayClient();
    let id: string | undefined;
    try {
      const created = await client.send(
        new CreateApiKeyCommand({ name: `nlsd-cap-probe-del-${PROBE_STAMP}`, enabled: true }),
      );
      id = created.id;
    } catch {
      return false; // cannot create -> delete is moot
    }
    if (!id) return false;
    try {
      await client.send(new DeleteApiKeyCommand({ apiKey: id }));
      return true;
    } catch (e) {
      if (isUnsupportedError(e)) return false;
      const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      if (status !== undefined) return false;
      throw e;
  // localstack:3 CE answers every cognito-idp action with a "pro feature"
  // error; floci/ministack/kumo implement user pools. A successful ListUserPools
  // is enough.
  "cognito.userPools": async () => {
    try {
      await makeCognitoClient().send(new ListUserPoolsCommand({ MaxResults: 1 }));
      return true;
    } catch (e) {
      return serviceErrorMeansImplemented(e);
    }
  },

  // Groups are implemented on floci/ministack but not kumo (InvalidAction). A
  // ListGroups against a deliberately missing pool answers ResourceNotFound
  // where implemented (proving routing) and InvalidAction where not.
  "cognito.groups": async () => {
    try {
      await makeCognitoClient().send(
        new ListGroupsCommand({ UserPoolId: "ap-northeast-1_nlsdprobe" }),
      );
      return true;
    } catch (e) {
      return serviceErrorMeansImplemented(e);
    }
  },

  // AdminSetUserPassword / AdminEnableUser / AdminDisableUser are implemented on
  // floci/ministack but not kumo (InvalidAction). Probe the password op against
  // a missing pool: NotFound proves it is routed, InvalidAction proves it is not.
  "cognito.adminUserState": async () => {
    try {
      await makeCognitoClient().send(
        new AdminSetUserPasswordCommand({
          UserPoolId: "ap-northeast-1_nlsdprobe",
          Username: "nlsd-cap-probe-missing",
          Password: "Probe1234!",
          Permanent: true,
        }),
      );
      return true;
    } catch (e) {
      return serviceErrorMeansImplemented(e);
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

  // Functional round-trip: kumo answers TagResource/UntagResource with
  // InvalidAction ("is not valid"), so only "the tag comes back from
  // DescribeSecret" proves the capability. DescribeSecret itself works on all
  // four emulators, so tag LISTING is unconditional; only the mutations gate.
  "secretsmanager.tags": async () => {
    const sm = makeSecretsManagerClient();
    const name = `nlsd-cap-probe-sm-${PROBE_STAMP}`;
    await sm.send(new CreateSecretCommand({ Name: name, SecretString: "{}" }));
    try {
      await sm.send(
        new SecretsTagResourceCommand({ SecretId: name, Tags: [{ Key: "probe", Value: "1" }] }),
      );
      const got = await sm.send(new DescribeSecretCommand({ SecretId: name }));
      return (got.Tags ?? []).some((t) => t.Key === "probe");
    } catch (e) {
      serviceErrorMeansImplemented(e); // re-throws transport errors
      return false;
    } finally {
      await sm
        .send(new DeleteSecretCommand({ SecretId: name, ForceDeleteWithoutRecovery: true }))
        .catch(() => {});
    }
  },
  // DescribeRepositories: localstack CE answers ECR with a "pro feature" /
  // "not yet implemented" error; ministack/kumo/floci (with docker.sock)
  // implement it.
  "ecr.repositories": async () => {
    try {
      await makeEcrClient().send(new DescribeRepositoriesCommand({}));
  // StartQueryExecution routes on Athena-capable emulators (floci/ministack/
  // kumo) and returns an id; localstack:3 CE answers "pro feature". The result
  // set write may still fail later (missing bucket) — that does not affect
  // whether the operation is implemented, so probing the start call is enough.
  "athena.query": async () => {
    try {
      await makeAthenaClient().send(
        new StartQueryExecutionCommand({
          QueryString: "SELECT 1",
          ResultConfiguration: { OutputLocation: "s3://nlsd-athena-results/" },
        }),
      );
      return true;
    } catch (e) {
      return serviceErrorMeansImplemented(e);
    }
  },

  // CreateRepository: separated from describe because floci only creates
  // repositories when started with the docker socket mounted (it spawns a real
  // registry container). Create a uniquely-named repo and clean it up.
  "ecr.create": async () => {
    const ecr = makeEcrClient();
    const name = `nlsd-cap-probe-${PROBE_STAMP}`;
    try {
      await ecr.send(new CreateRepositoryCommand({ repositoryName: name }));
    } catch (e) {
      return serviceErrorMeansImplemented(e);
    }
    await ecr
      .send(new DeleteRepositoryCommand({ repositoryName: name, force: true }))
      .catch(() => {});
    return true;
  },
  // CloudWatch Metrics/Alarms via the legacy Query protocol (`monitoring`
  // service). kumo does not route the service at all (UnknownService); the SDK
  // is unusable here because localstack:3 rejects its CBOR encoding, so the
  // probe (like the app's Rust client) speaks raw Query HTTP.
  "cloudwatch.metrics": () => cwQueryProbe("ListMetrics"),
  "cloudwatch.alarms": () => cwQueryProbe("DescribeAlarms"),
  // ListWorkGroups is implemented on floci/ministack; localstack answers "pro
  // feature" and kumo answers InvalidAction (workgroups unimplemented).
  "athena.workgroups": async () => {
    try {
      await makeAthenaClient().send(new ListWorkGroupsCommand({}));
      return true;
    } catch (e) {
      return serviceErrorMeansImplemented(e);
    }
  },

  // NamedQuery CRUD is ministack-only among the four emulators (floci, kumo and
  // localstack all reject ListNamedQueries as unsupported/InvalidAction).
  "athena.namedQueries": async () => {
    try {
      await makeAthenaClient().send(new ListNamedQueriesCommand({}));
      return true;
    } catch (e) {
      return serviceErrorMeansImplemented(e);
    }
  },
};

/** CloudWatch Query-protocol probe: the describe-style call itself must succeed. */
async function cwQueryProbe(action: string): Promise<boolean> {
  const { ok, body } = await cwQuery(action);
  if (isUnsupportedText(body)) return false;
  if (ok) return true;
  throw new Error(`capability probe ${action} failed unexpectedly: ${body.slice(0, 300)}`);
}

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
