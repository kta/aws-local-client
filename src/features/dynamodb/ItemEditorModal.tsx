import { useMemo, useState } from "react";
import { toAppError } from "../../api/client";
import { Modal } from "../../components/ui";
import type { DdbItem } from "../../lib/ddbJson";
import { itemToPlain, plainToItem } from "../../lib/ddbJson";

export function ItemEditorModal({
  initial,
  onSubmit,
  onClose,
}: {
  initial: DdbItem | null; // null = new item
  onSubmit: (item: DdbItem) => Promise<void>;
  onClose: () => void;
}) {
  const [ddbMode, setDdbMode] = useState(false);
  const initialText = useMemo(() => {
    const item = initial ?? {};
    return {
      plain: JSON.stringify(itemToPlain(item), null, 2),
      ddb: JSON.stringify(item, null, 2),
    };
  }, [initial]);
  const [text, setText] = useState(initialText.plain);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const toggleMode = () => {
    try {
      const parsed = JSON.parse(text);
      const next = ddbMode
        ? JSON.stringify(itemToPlain(parsed), null, 2)
        : JSON.stringify(plainToItem(parsed), null, 2);
      setText(next);
      setDdbMode(!ddbMode);
      setError(null);
    } catch (e) {
      setError(`JSON が不正です: ${String(e)}`);
    }
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const parsed = JSON.parse(text);
      const item: DdbItem = ddbMode ? parsed : plainToItem(parsed);
      await onSubmit(item);
    } catch (e) {
      // JSON.parse throws SyntaxError (an Error); invoke rejects with a plain
      // {kind, message} AppError object which stringifies to [object Object].
      setError(e instanceof Error ? String(e) : toAppError(e).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={initial ? "アイテムの編集" : "アイテムの作成"}
      onClose={onClose}
      maxWidth="2xl"
      panelClassName="flex h-[80vh] flex-col"
      titleActions={
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            data-testid="item-ddb-toggle"
            checked={ddbMode}
            onChange={toggleMode}
          />
          DynamoDB JSON
        </label>
      }
      // Bespoke footer (not <ModalFooter>): keeps the original mt-3 spacing
      // and gray/blue button styling for pixel parity.
      footer={
        <div className="mt-3 flex justify-end gap-2">
          <button
            onClick={onClose}
            data-testid="item-cancel"
            className="rounded border border-gray-300 px-3 py-1 text-sm"
          >
            キャンセル
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            data-testid="item-save"
            className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "保存中..." : "保存"}
          </button>
        </div>
      }
    >
      {!ddbMode && (
        <p className="mb-2 text-xs text-gray-400">
          通常 JSON モードではセット型(SS/NS/BS)とバイナリ型は表現できません。また JavaScript の安全な整数範囲(2^53)を超える整数は文字列として表示され、そのまま保存すると文字列型になります。N 型を保持したい場合は DynamoDB JSON に切り替えてください。
        </p>
      )}
      <textarea
        className="flex-1 resize-none rounded border border-gray-300 p-2 font-mono text-sm"
        data-testid="item-json"
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
      />
      {error && <div className="mt-2 text-sm text-red-600">{error}</div>}
    </Modal>
  );
}
