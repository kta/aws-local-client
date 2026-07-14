/**
 * Shared display formatters (§2.14). Consolidates the previously divergent
 * byte/date formatting so every page renders values identically.
 */

/**
 * Human-readable byte size (e.g. 2202009 -> "2.1 MB"). Canonical log-based
 * implementation (formerly explore.ts), extended to B..TB. null/undefined -> "-".
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "-";
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`;
}

/**
 * Locale date-time string (ja-JP). null/undefined -> "-"; an unparseable
 * input is returned unchanged (formerly BackupsPage.formatDate).
 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("ja-JP");
}
