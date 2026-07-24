import type { DomainDetail, DomainSummary } from "../../api/opensearch";

/**
 * Map the OpenSearch processing/created flags to a Japanese status label.
 * OpenSearch does not expose a single status string, so the console-style label
 * is derived: a fully created, non-processing domain is "アクティブ"; a domain
 * still spinning up (or applying changes) is "処理中"; anything else is "保留中".
 */
export function domainStatusLabel(d: Pick<DomainSummary | DomainDetail, "processing" | "created">): string {
  if (d.processing) return "処理中";
  if (d.created) return "アクティブ";
  return "保留中";
}
