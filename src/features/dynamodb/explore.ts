import type { KeyDef, TableDetail } from "../../api/types";
import type { DdbAttr, DdbItem } from "../../lib/ddbJson";
import { ddbToPlain } from "../../lib/ddbJson";

/**
 * Build a typed DynamoDB AttributeValue from a raw string input using the key's
 * declared attribute type. Only N is treated as numeric; everything else is a string.
 */
export function typedValue(attrType: string, raw: string): DdbAttr {
  return attrType === "N" ? { N: raw } : { S: raw };
}

/** Extract the primary key (HASH/RANGE) attributes from an item for delete/get. */
export function keyOf(keys: KeyDef[], item: DdbItem): DdbItem {
  const key: DdbItem = {};
  for (const k of keys) {
    if (item[k.name] !== undefined) key[k.name] = item[k.name];
  }
  return key;
}

/**
 * Column order for the results table: key attributes first (when a table detail
 * is supplied), then discovered attributes. Pass `null` for `detail` when there
 * is no key priority (e.g. PartiQL results).
 */
export function columnsOf(detail: TableDetail | null, items: DdbItem[], max = 8): string[] {
  const cols = detail ? detail.keys.map((k) => k.name) : [];
  for (const item of items) {
    for (const k of Object.keys(item)) {
      if (!cols.includes(k)) cols.push(k);
    }
  }
  return cols.slice(0, max);
}

/** Render a single cell as display text (objects/arrays are JSON-stringified). */
export function cellText(item: DdbItem, col: string): string {
  const v = item[col];
  if (v === undefined) return "";
  const plain = ddbToPlain(v);
  return typeof plain === "object" && plain !== null ? JSON.stringify(plain) : String(plain);
}

/** Human-readable byte size (e.g. 2202009 -> "2.1 MB"). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`;
}
