import { LambdaClient } from "@aws-sdk/client-lambda";
import { APIGatewayClient } from "@aws-sdk/client-api-gateway";
import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { ElastiCacheClient } from "@aws-sdk/client-elasticache";
import { CloudFormationClient } from "@aws-sdk/client-cloudformation";
import { ECSClient } from "@aws-sdk/client-ecs";
import { ECRClient } from "@aws-sdk/client-ecr";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { OpenSearchClient } from "@aws-sdk/client-opensearch";
import { AthenaClient } from "@aws-sdk/client-athena";
import { KafkaClient } from "@aws-sdk/client-kafka";
import { RDSClient } from "@aws-sdk/client-rds";
import { Route53Client } from "@aws-sdk/client-route-53";
import { S3Client } from "@aws-sdk/client-s3";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { SFNClient } from "@aws-sdk/client-sfn";
import { SNSClient } from "@aws-sdk/client-sns";
import { SQSClient } from "@aws-sdk/client-sqs";
import { SSMClient } from "@aws-sdk/client-ssm";

/**
 * AWS SDK client factories for the SQS / SNS / S3 / RDS E2E specs (R22-R35).
 *
 * These talk to the same emulator the app under test uses (via E2E_ENDPOINT),
 * but directly through the AWS SDK so specs can seed fixtures and verify the
 * side effects of UI actions without going through the UI a second time —
 * mirroring how `helpers/emulator.ts` does it for DynamoDB. Kept in a separate
 * module so the DynamoDB helpers stay untouched.
 */
export const E2E_ENDPOINT = process.env.E2E_ENDPOINT ?? "http://localhost:4566";
export const E2E_REGION = process.env.E2E_REGION ?? "ap-northeast-1";

const credentials = { accessKeyId: "dummy", secretAccessKey: "dummy" };

export function makeSqsClient(endpoint = E2E_ENDPOINT, region = E2E_REGION): SQSClient {
  return new SQSClient({ endpoint, region, credentials });
}

export function makeSnsClient(endpoint = E2E_ENDPOINT, region = E2E_REGION): SNSClient {
  return new SNSClient({ endpoint, region, credentials });
}

export function makeS3Client(endpoint = E2E_ENDPOINT, region = E2E_REGION): S3Client {
  // Path-style addressing is required for localhost emulators (no per-bucket DNS).
  return new S3Client({ endpoint, region, credentials, forcePathStyle: true });
}

export function makeRdsClient(endpoint = E2E_ENDPOINT, region = E2E_REGION): RDSClient {
  return new RDSClient({ endpoint, region, credentials });
}

export function makeLambdaClient(endpoint = E2E_ENDPOINT, region = E2E_REGION): LambdaClient {
  return new LambdaClient({ endpoint, region, credentials });
}

export function makeApiGatewayClient(
  endpoint = E2E_ENDPOINT,
  region = E2E_REGION,
): APIGatewayClient {
  return new APIGatewayClient({ endpoint, region, credentials });
}

export function makeCognitoClient(
  endpoint = E2E_ENDPOINT,
  region = E2E_REGION,
): CognitoIdentityProviderClient {
  return new CognitoIdentityProviderClient({ endpoint, region, credentials });
}

export function makeEventBridgeClient(
  endpoint = E2E_ENDPOINT,
  region = E2E_REGION,
): EventBridgeClient {
  return new EventBridgeClient({ endpoint, region, credentials });
}

export function makeSecretsManagerClient(
  endpoint = E2E_ENDPOINT,
  region = E2E_REGION,
): SecretsManagerClient {
  return new SecretsManagerClient({ endpoint, region, credentials });
}

export function makeElastiCacheClient(
  endpoint = E2E_ENDPOINT,
  region = E2E_REGION,
): ElastiCacheClient {
  return new ElastiCacheClient({ endpoint, region, credentials });
}

export function makeCfnClient(
  endpoint = E2E_ENDPOINT,
  region = E2E_REGION,
): CloudFormationClient {
  return new CloudFormationClient({ endpoint, region, credentials });
}

export function makeEcsClient(endpoint = E2E_ENDPOINT, region = E2E_REGION): ECSClient {
  return new ECSClient({ endpoint, region, credentials });
}

export function makeEcrClient(endpoint = E2E_ENDPOINT, region = E2E_REGION): ECRClient {
  return new ECRClient({ endpoint, region, credentials });
}

// CloudWatch Logs speaks the AWS JSON protocol, which every emulator implements,
// so the SDK works for seeding/verifying log fixtures. CloudWatch Metrics/Alarms
// do NOT get an SDK client: modern SDKs use smithy-rpc-v2-cbor which localstack:3
// rejects (spec §2.1-1) — use `awsQuery("monitoring", ...)` for those instead.
export function makeCloudWatchLogsClient(
  endpoint = E2E_ENDPOINT,
  region = E2E_REGION,
): CloudWatchLogsClient {
  return new CloudWatchLogsClient({ endpoint, region, credentials });
}

/**
 * Raw AWS **Query-protocol** call (form POST + XML/JSON body), the generalized
 * form of the former RDS-only probe. Some services cannot be driven through the
 * JS SDK against these emulators:
 *   - RDS: kumo answers unsupported actions with a JSON body on the XML protocol,
 *     which the SDK turns into an opaque deserialization error.
 *   - CloudWatch (service token `monitoring`): the SDK speaks CBOR, which
 *     localstack:3 rejects with "Operation detection failed".
 * A raw HTTP call lets tests seed/verify and classify the body text directly.
 * The `api/<service>` User-Agent token is required by kumo to disambiguate
 * action names shared across services (the JS SDK sends it automatically).
 */
export async function awsQuery(
  service: string,
  action: string,
  params: Record<string, string> = {},
  version: string,
): Promise<{ ok: boolean; body: string }> {
  const form = new URLSearchParams({ Action: action, Version: version, ...params });
  const res = await fetch(`${E2E_ENDPOINT}/`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=utf-8",
      "user-agent": `aws-sdk-js/3.0 api/${service}#3.0`,
      // Emulators do not verify signatures but some partition data by the
      // credential-scope region (e.g. ministack keeps CloudWatch metrics/alarms
      // per region), so the scope MUST match the region the app connects with
      // (E2E_REGION) or seeded fixtures are invisible to the app under test.
      authorization: `AWS4-HMAC-SHA256 Credential=dummy/20260101/${E2E_REGION}/${service}/aws4_request, SignedHeaders=host, Signature=dummy`,
    },
    body: form.toString(),
  });
  return { ok: res.ok, body: await res.text() };
}

/** CloudWatch Metrics/Alarms Query call (`monitoring` service, API version 2010-08-01). */
export function cwQuery(
  action: string,
  params: Record<string, string> = {},
): Promise<{ ok: boolean; body: string }> {
  return awsQuery("monitoring", action, params, "2010-08-01");
}

export function makeSfnClient(endpoint = E2E_ENDPOINT, region = E2E_REGION): SFNClient {
  return new SFNClient({ endpoint, region, credentials });
}

export function makeOpenSearchClient(
  endpoint = E2E_ENDPOINT,
  region = E2E_REGION,
): OpenSearchClient {
  return new OpenSearchClient({ endpoint, region, credentials });
}

export function makeAthenaClient(endpoint = E2E_ENDPOINT, region = E2E_REGION): AthenaClient {
  return new AthenaClient({ endpoint, region, credentials });
}

export function makeKafkaClient(endpoint = E2E_ENDPOINT, region = E2E_REGION): KafkaClient {
  return new KafkaClient({ endpoint, region, credentials });
}

export function makeSsmClient(endpoint = E2E_ENDPOINT, region = E2E_REGION): SSMClient {
  return new SSMClient({ endpoint, region, credentials });
}

export function makeRoute53Client(endpoint = E2E_ENDPOINT, region = E2E_REGION): Route53Client {
  return new Route53Client({ endpoint, region, credentials });
}

/** True if an SDK error looks like "this emulator does not implement the op". */
export function isUnsupportedError(e: unknown): boolean {
  const err = e as { name?: string; message?: string };
  const text = `${err.name ?? ""} ${err.message ?? ""}`;
  return /unknown ?operation|not ?implemented|not supported|InvalidAction|pro feature|501/i.test(
    text,
  );
}
