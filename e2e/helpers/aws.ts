import { OpenSearchClient } from "@aws-sdk/client-opensearch";
import { RDSClient } from "@aws-sdk/client-rds";
import { S3Client } from "@aws-sdk/client-s3";
import { SNSClient } from "@aws-sdk/client-sns";
import { SQSClient } from "@aws-sdk/client-sqs";

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

export function makeOpenSearchClient(
  endpoint = E2E_ENDPOINT,
  region = E2E_REGION,
): OpenSearchClient {
  return new OpenSearchClient({ endpoint, region, credentials });
}

/** True if an SDK error looks like "this emulator does not implement the op". */
export function isUnsupportedError(e: unknown): boolean {
  const err = e as { name?: string; message?: string };
  const text = `${err.name ?? ""} ${err.message ?? ""}`;
  return /unknown ?operation|not ?implemented|not supported|InvalidAction|pro feature|501/i.test(
    text,
  );
}
