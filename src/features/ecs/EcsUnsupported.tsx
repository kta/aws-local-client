import type { AppError } from "../../api/types";

/**
 * Amber notice shown when the active emulator does not implement the ECS
 * control plane (localstack:3 is Pro-only for ECS). Mirrors the RDS
 * unsupported banner style. `testId` defaults to the shared `ecs-unsupported`
 * id used by the E2E suite.
 */
export function EcsUnsupported({
  error,
  testId = "ecs-unsupported",
}: {
  error: AppError;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className="m-4 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <div className="font-semibold">このエミュレータは ECS API をサポートしていません</div>
      <div className="mt-1 text-amber-800">対応エミュレータ: floci、ministack、kumo</div>
      <div className="mt-1 text-amber-800">{error.message}</div>
    </div>
  );
}
