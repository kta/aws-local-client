/**
 * Shared Tailwind class-string tokens. Extracted verbatim from the DynamoDB
 * pages so the visual result is unchanged (see §2.1 of the shared-components
 * design spec). Use these for card / header / input styling instead of
 * re-declaring the strings per page.
 */

/** Join class-name parts, dropping falsy values. */
export const cx = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(" ");

export const card =
  "rounded-[10px] border border-[#d9dee3] bg-white shadow-[0_1px_2px_rgba(0,21,41,.08)]";
export const cardHead =
  "flex items-center gap-[10px] border-b border-[#d9dee3] px-4 py-3 text-[14.5px] font-bold";
export const input =
  "rounded-lg border border-[#d9dee3] bg-white px-[10px] py-[6px] text-[13px]";
