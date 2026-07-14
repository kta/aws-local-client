import { card, cx } from "./tokens";

interface SummaryItem {
  label: string;
  value: string;
  testId?: string;
}

interface SummaryCardsProps {
  items: SummaryItem[];
  testId?: string;
}

/** Grid of label + large-number summary cards (§2.11). Markup from DashboardPage. */
export function SummaryCards({ items, testId }: SummaryCardsProps) {
  return (
    <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-3" data-testid={testId}>
      {items.map((item) => (
        <div key={item.label} className={cx(card, "px-4 py-4")} data-testid={item.testId}>
          <div className="text-[12.5px] font-semibold text-[#5f6b7a]">{item.label}</div>
          <div className="mt-1 text-[26px] font-bold text-[#16191f] [font-variant-numeric:tabular-nums]">
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}
