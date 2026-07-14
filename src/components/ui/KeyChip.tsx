import type { KeyAttr, KeyDef } from "../../api/types";

const KEY_CHIP =
  "inline-block rounded bg-[#0972d31f] px-2 py-px font-mono text-[11.5px] text-[#0972d3]";

interface KeyChipProps {
  keyDef?: Pick<KeyDef, "name" | "attrType"> | KeyAttr | null;
  testId?: string;
}

/** Monospace pk/sk chip; null/undefined renders "-" (§2.9). */
export function KeyChip({ keyDef, testId }: KeyChipProps) {
  if (!keyDef) return <span className="text-[#5f6b7a]">-</span>;
  return (
    <span className={KEY_CHIP} data-testid={testId}>
      {keyDef.name} ({keyDef.attrType})
    </span>
  );
}
