import { useState } from "react";
import type { CacheEngine, CreateCacheRequest } from "../../api/elasticache";
import { Modal, ModalFooter } from "../../components/ui";

export function CreateCacheModal({
  onSubmit,
  onClose,
}: {
  onSubmit: (req: CreateCacheRequest) => Promise<void>;
  onClose: () => void;
}) {
  const [id, setId] = useState("");
  const [engine, setEngine] = useState<CacheEngine>("redis");
  const [nodeType, setNodeType] = useState("cache.t3.micro");
  const [numNodes, setNumNodes] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  const valid = id.trim() && nodeType.trim() && numNodes > 0;

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      await onSubmit({
        id: id.trim(),
        engine,
        nodeType: nodeType.trim(),
        numNodes,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="キャッシュを作成"
      onClose={onClose}
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={submit}
          confirmLabel="作成"
          confirmingLabel="作成中..."
          confirmDisabled={!valid}
          confirmTestId="c-save"
          busy={submitting}
        />
      }
    >
      <div className="space-y-3">
        <label className="block text-sm">
          <span className="text-gray-600">ID</span>
          <input
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            data-testid="c-id"
            value={id}
            onChange={(e) => setId(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="text-gray-600">エンジン</span>
          <select
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            data-testid="c-engine"
            value={engine}
            onChange={(e) => setEngine(e.target.value as CacheEngine)}
          >
            <option value="redis">redis</option>
            <option value="valkey">valkey</option>
            <option value="memcached">memcached</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-gray-600">ノードタイプ</span>
          <input
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            data-testid="c-nodetype"
            value={nodeType}
            onChange={(e) => setNodeType(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="text-gray-600">ノード数</span>
          <input
            type="number"
            min={1}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            data-testid="c-nodes"
            value={numNodes}
            onChange={(e) => setNumNodes(Number(e.target.value))}
          />
        </label>
        <p className="text-xs text-gray-500">
          redis / valkey はレプリケーショングループ、memcached はキャッシュクラスターとして作成されます。
        </p>
      </div>
    </Modal>
  );
}
