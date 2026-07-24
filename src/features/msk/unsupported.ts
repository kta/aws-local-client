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
 */
export function isMskUnsupported(err: AppError): boolean {
  return isUnsupportedOperation(err) || err.kind === "not_found" || /404/.test(err.message);
}
