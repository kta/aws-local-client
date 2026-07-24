import type { AppError } from "../../api/types";

/** Amber "unsupported" takeover banner shared by the dashboard and domains
 *  pages (RDS 文体, testid `opensearch-unsupported`). */
export function UnsupportedBanner({ error }: { error: AppError }) {
  return (
    <div
      data-testid="opensearch-unsupported"
      className="m-4 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <div className="font-semibold">このエミュレータは OpenSearch API をサポートしていません</div>
      <div className="mt-1 text-amber-800">
        対応エミュレータ: localstack、ministack、floci(--volume /var/run/docker.sock マウント時)
      </div>
      <div className="mt-1 text-amber-800">{error.message}</div>
    </div>
  );
}
