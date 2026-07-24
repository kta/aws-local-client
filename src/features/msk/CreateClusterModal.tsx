import { useState } from "react";
import { Modal, ModalFooter } from "../../components/ui";

/**
 * Create-cluster modal. The BrokerNodeGroupInfo (instance type / subnet / Kafka
 * version) is hardcoded in the Rust command to the probe-confirmed minimal
 * config, so the UI only collects the cluster name and broker count.
 */
export function CreateClusterModal({
  onSubmit,
  onClose,
}: {
  onSubmit: (name: string, numBrokers: number) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [numBrokers, setNumBrokers] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  const valid = name.trim().length > 0 && numBrokers > 0;

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      await onSubmit(name.trim(), numBrokers);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="クラスターを作成"
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
          <span className="text-gray-600">クラスター名</span>
          <input
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            data-testid="c-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="text-gray-600">ブローカー数</span>
          <input
            type="number"
            min={1}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            data-testid="c-brokers"
            value={numBrokers}
            onChange={(e) => setNumBrokers(Number(e.target.value))}
          />
        </label>
        <p className="text-xs text-gray-500">
          Kafka バージョン 3.6.0 / kafka.t3.small で作成されます。
        </p>
      </div>
    </Modal>
  );
}
