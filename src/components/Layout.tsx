import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useConnections } from "../state/connections";
import { serviceForPath } from "../services/registry";
import { AWS_REGIONS } from "../lib/regions";
import { SideNav } from "./SideNav";

const CONN_DEFAULT = "#7c4dff";

type Crumb = { service?: string; parts: string[] };

// Non-service (fixed) paths keep a small hand-maintained crumb table.
const FIXED_CRUMBS: Record<string, Crumb> = {
  "/connections": { parts: ["接続管理"] },
};

function buildCrumb(pathname: string): Crumb | null {
  const fixed = FIXED_CRUMBS[pathname];
  if (fixed) return fixed;
  const service = serviceForPath(pathname);
  const parts = service?.crumbLabel?.(pathname);
  if (service && parts) return { service: service.name, parts };
  return null; // "/" (home) shows no crumb
}

export function Layout() {
  const { profiles, active, setActiveId, refresh } = useConnections();
  const location = useLocation();
  const navigate = useNavigate();
  const connColor = active?.color || CONN_DEFAULT;
  const showSidebar = !!serviceForPath(location.pathname)?.nav.length;
  const crumb = buildCrumb(location.pathname);

  const regionOptions =
    active && !AWS_REGIONS.includes(active.region)
      ? [active.region, ...AWS_REGIONS]
      : AWS_REGIONS;

  const handleRegionChange = async (region: string) => {
    if (!active) return;
    await api.saveConnection({ ...active, region });
    await refresh();
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#f0f1f3] text-[#16191f]">
      <header className="flex items-center gap-[14px] bg-[#232f3e] px-4 py-2 text-white">
        <button
          className="cursor-pointer border-none bg-transparent p-0 text-[14px] font-bold tracking-[0.2px] text-white"
          onClick={() => navigate("/")}
        >
          neo-localstack<small className="ml-[6px] font-normal opacity-55">desktop</small>
        </button>
        {crumb && (
          <span className="text-[13px] text-white/60">
            {crumb.service && <b className="font-semibold text-white">{crumb.service}</b>}
            {crumb.service && " › "}
            {crumb.parts.map((p, i) => (
              <span key={i}>
                {i > 0 && " › "}
                {p}
              </span>
            ))}
          </span>
        )}

        <div className="ml-auto flex items-center gap-[10px]">
          <span className="rounded-[3px] bg-[#7c4dff] px-[7px] py-[2px] text-[10px] font-bold tracking-[0.12em] text-white">
            LOCAL
          </span>
          <div className="flex items-center gap-2 rounded-full border border-white/[0.17] bg-white/[0.08] py-1 pl-2 pr-[10px]">
            <span
              data-testid="header-conn-color"
              className="h-[10px] w-[10px] rounded-full"
              style={{ backgroundColor: connColor, boxShadow: `0 0 0 3px color-mix(in srgb, ${connColor} 30%, transparent)` }}
            />
            <select
              aria-label="接続を切り替え"
              data-testid="header-conn-select"
              className="cursor-pointer border-none bg-transparent text-[13px] font-semibold text-white outline-none"
              value={active?.id ?? ""}
              onChange={(e) => setActiveId(e.target.value)}
            >
              {profiles.length === 0 && (
                <option value="" className="text-[#16191f]">
                  接続なし
                </option>
              )}
              {profiles.map((p) => (
                <option key={p.id} value={p.id} className="text-[#16191f]">
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          {active ? (
            <select
              aria-label="リージョンを変更"
              data-testid="header-region-select"
              className="cursor-pointer rounded-full border border-white/[0.17] bg-white/[0.08] px-[10px] py-1 text-[12px] font-semibold text-white outline-none hover:bg-white/20"
              value={active.region}
              onChange={(e) => void handleRegionChange(e.target.value)}
            >
              {regionOptions.map((r) => (
                <option key={r} value={r} className="text-[#16191f]">
                  {r}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-[12px] text-white/55">-</span>
          )}
          <Link
            to="/connections"
            data-testid="nav-connections"
            className="rounded-md border border-white/[0.17] bg-white/[0.08] px-[10px] py-[3px] text-[12px] font-semibold text-white hover:bg-white/20"
          >
            接続管理
          </Link>
        </div>
      </header>
      <div className="h-[3px] transition-colors" style={{ backgroundColor: connColor }} />

      <div className="flex flex-1 min-h-0">
        {showSidebar && <SideNav />}
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
