import { Button, type ButtonVariant } from "./Button";
import { cx } from "./tokens";

const MAX_WIDTH = {
  md: "max-w-md",
  lg: "max-w-lg",
  "2xl": "max-w-2xl",
} as const;

interface ModalProps {
  title: React.ReactNode;
  onClose: () => void;
  maxWidth?: "md" | "lg" | "2xl"; // matches the three existing panel widths
  panelClassName?: string; // extra panel classes (e.g. "flex h-[80vh] flex-col")
  titleActions?: React.ReactNode; // inline slot right of the title (e.g. a mode toggle)
  children: React.ReactNode; // body
  footer?: React.ReactNode; // usually <ModalFooter>
}

/** Backdrop + centered panel with stopPropagation (§1.3 / §2.6). */
export function Modal({
  title,
  onClose,
  maxWidth = "md",
  panelClassName,
  titleActions,
  children,
  footer,
}: ModalProps) {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className={cx("w-full rounded-lg bg-white p-6", MAX_WIDTH[maxWidth], panelClassName)}
        onClick={(e) => e.stopPropagation()}
      >
        {titleActions !== undefined ? (
          // Header-row styling copied verbatim from ItemEditorModal so the
          // sole current use site keeps pixel parity.
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-bold">{title}</h2>
            {titleActions}
          </div>
        ) : (
          <h2 className="mb-3 text-lg font-bold">{title}</h2>
        )}
        {children}
        {footer}
      </div>
    </div>
  );
}

interface ModalFooterProps {
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  cancelLabel?: string; // default "キャンセル"
  cancelTestId?: string; // e.g. "item-cancel"
  confirmLabel: string;
  confirmingLabel?: string; // shown while busy (e.g. "作成中...")
  confirmVariant?: ButtonVariant; // default primary
  confirmDisabled?: boolean;
  confirmTestId?: string;
  busy?: boolean;
}

/** Cancel + confirm button row with busy-state labelling (§2.6). */
export function ModalFooter({
  onCancel,
  onConfirm,
  cancelLabel = "キャンセル",
  cancelTestId,
  confirmLabel,
  confirmingLabel,
  confirmVariant = "primary",
  confirmDisabled,
  confirmTestId,
  busy,
}: ModalFooterProps) {
  return (
    <div className="mt-4 flex justify-end gap-2">
      <Button variant="secondary" onClick={onCancel} data-testid={cancelTestId}>
        {cancelLabel}
      </Button>
      <Button
        variant={confirmVariant}
        onClick={() => void onConfirm()}
        disabled={confirmDisabled || busy}
        data-testid={confirmTestId}
      >
        {busy ? (confirmingLabel ?? confirmLabel) : confirmLabel}
      </Button>
    </div>
  );
}
