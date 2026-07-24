import type { AppError } from "../../api/types";

/**
 * Amber "this emulator does not support MSK" banner, shared by the dashboard and
 * clusters pages. MSK is a Pro feature on localstack:3 and absent on kumo; only
 * floci (Redpanda) and ministack implement the Kafka API.
 */
export function UnsupportedBanner({ error }: { error: AppError }) {
  return (
    <div
      data-testid="msk-unsupported"
      className="m-4 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <div className="font-semibold">このエミュレータは MSK API をサポートしていません</div>
      <div className="mt-1 text-amber-800">対応エミュレータ: floci、ministack</div>
      <div className="mt-1 text-amber-800">{error.message}</div>
    </div>
  );
}
