import { card, cardHead, cx } from "./tokens";

interface CardProps {
  title?: React.ReactNode; // when set, renders the cardHead bar
  headerActions?: React.ReactNode; // placed after a flex-1 spacer, right of the title
  overflowHidden?: boolean;
  className?: string;
  children: React.ReactNode;
}

/** Bordered white card with an optional header bar (§2.4). */
export function Card({ title, headerActions, overflowHidden, className, children }: CardProps) {
  return (
    <div className={cx(card, overflowHidden && "overflow-hidden", className)}>
      {title !== undefined && (
        <div className={cardHead}>
          {title}
          {headerActions !== undefined && headerActions !== null && (
            <>
              <span className="flex-1" />
              {headerActions}
            </>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
