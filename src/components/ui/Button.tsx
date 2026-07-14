import { cx } from "./tokens";

export type ButtonVariant = "primary" | "secondary" | "danger";
export type ButtonSize = "md" | "sm";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant; // default "secondary"
  size?: ButtonSize; // default "md"
}

// Class strings copied verbatim from BTN / BTN_PRIMARY / BTN_DANGER /
// BTN_SM / BTN_SM_PRIMARY across the DynamoDB pages (§1.1, §2.2).
const STYLES: Record<ButtonSize, Record<ButtonVariant, string>> = {
  md: {
    secondary:
      "rounded-lg border border-[#d9dee3] bg-white px-[14px] py-[6px] text-[13px] font-semibold hover:border-[#5f6b7a]",
    primary:
      "rounded-lg border border-[#0972d3] bg-[#0972d3] px-[14px] py-[6px] text-[13px] font-semibold text-white hover:bg-[#075bab]",
    danger:
      "rounded-lg border border-[#e08a72] bg-white px-[14px] py-[6px] text-[13px] font-semibold text-[#d13212] hover:border-[#d13212]",
  },
  sm: {
    secondary:
      "rounded-md border border-[#d9dee3] bg-white px-[10px] py-[3px] text-[12px] font-semibold hover:border-[#5f6b7a]",
    primary:
      "rounded-md border border-[#0972d3] bg-[#0972d3] px-[10px] py-[3px] text-[12px] font-semibold text-white hover:bg-[#075bab]",
    danger:
      "rounded-md border border-[#e08a72] bg-white px-[10px] py-[3px] text-[12px] font-semibold text-[#d13212] hover:border-[#d13212]",
  },
};

// Behaviour consolidation (§2.2): every variant gets the disabled treatment,
// which was previously inconsistent across the pages.
const DISABLED = "disabled:cursor-not-allowed disabled:opacity-45";

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...rest
}: ButtonProps) {
  return <button className={cx(STYLES[size][variant], DISABLED, className)} {...rest} />;
}
