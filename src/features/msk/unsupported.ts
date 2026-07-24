import type { AppError } from "../../api/types";
import { isUnsupportedOperation } from "../../lib/unsupported";

/**
 * MSK-specific "this emulator does not support Kafka" detection, shared by the
 * clusters and dashboard pages. In addition to the standard unsupported-operation
 * signatures, kumo routes MSK actions to a plain HTTP 404 ("404 page not found")
 * — surfaced by the Rust error layer either as a message the shared regex matches
 * or, when the body is empty, as a not_found-kinded error — so treat a
 * not-found / 404 load failure as "unsupported" here as well (mirrors
 * lambda/LayersPage#isLayersUnsupported and route53/HealthChecksPage).
 *
 * ministack-pip (the macOS/Windows CI variant) does not model MSK and instead
 * misroutes the Kafka REST path (/v1/clusters) to its S3 handler, which answers
 * HTTP 404 with an S3-style XML body ("NoSuchBucket" / "The specified bucket
 * does not exist"). error.rs surfaces that raw body verbatim, so recognise the
 * S3-misroute signature as "unsupported" too.
 */
export function isMskUnsupported(err: AppError): boolean {
  return (
    isUnsupportedOperation(err) ||
    err.kind === "not_found" ||
    /404|no such bucket|specified bucket does not exist/i.test(err.message)
  );
}
