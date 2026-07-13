export type DdbAttr = Record<string, unknown>;
export type DdbItem = Record<string, DdbAttr>;

export function ddbToPlain(attr: DdbAttr): unknown {
  const [tag] = Object.keys(attr);
  const v = attr[tag];
  switch (tag) {
    case "S":
      return v as string;
    case "N": {
      const n = Number(v as string);
      return Number.isInteger(n) && !Number.isSafeInteger(n) ? (v as string) : n;
    }
    case "BOOL":
      return v as boolean;
    case "NULL":
      return null;
    case "B":
      return v as string; // base64 のまま表示
    case "SS":
      return v as string[];
    case "NS":
      return (v as string[]).map((s) => ddbToPlain({ N: s }));
    case "BS":
      return v as string[];
    case "L":
      return (v as DdbAttr[]).map(ddbToPlain);
    case "M":
      return itemToPlain(v as DdbItem);
    default:
      return v;
  }
}

export function itemToPlain(item: DdbItem): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(item).map(([k, v]) => [k, ddbToPlain(v)]),
  );
}

export function plainToDdb(v: unknown): DdbAttr {
  if (v === null || v === undefined) return { NULL: true };
  switch (typeof v) {
    case "string":
      return { S: v };
    case "number":
      return { N: String(v) };
    case "boolean":
      return { BOOL: v };
    case "object":
      if (Array.isArray(v)) return { L: v.map(plainToDdb) };
      return { M: plainToItem(v as Record<string, unknown>) };
    default:
      throw new Error(`unsupported value: ${String(v)}`);
  }
}

export function plainToItem(obj: Record<string, unknown>): DdbItem {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k, plainToDdb(v)]),
  );
}
