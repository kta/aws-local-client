/**
 * Amber "this emulator does not support Cognito user pools" banner, shown when a
 * describe/list rejects with an unsupported-operation signature (localstack:3 =
 * Pro-only). Mirrors the RDS unsupported banner style; the create actions are
 * hidden by the caller when this renders.
 */
export function UnsupportedBanner({ message }: { message: string }) {
  return (
    <div
      data-testid="cognito-unsupported"
      className="m-4 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <div className="font-semibold">
        このエミュレータは Cognito ユーザープールをサポートしていません
      </div>
      <div className="mt-1 text-amber-800">対応エミュレータ: floci、ministack、kumo</div>
      <div className="mt-1 text-amber-800">{message}</div>
    </div>
  );
}
