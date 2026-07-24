import type { ServiceDefinition } from "../../services/types";
import { CachesPage } from "./CachesPage";
import { DashboardPage } from "./DashboardPage";

export const elasticacheService: ServiceDefinition = {
  id: "elasticache",
  name: "ElastiCache",
  description: "インメモリキャッシュ",
  basePath: "/elasticache",
  enabled: true,
  home: "/elasticache",
  nav: [
    {
      label: "ダッシュボード",
      path: "/elasticache",
      testId: "nav-elasticache-dashboard",
      group: 0,
    },
    { label: "キャッシュ", path: "/elasticache/caches", testId: "nav-caches", group: 0 },
  ],
  routes: [
    { path: "/elasticache", element: <DashboardPage /> },
    { path: "/elasticache/caches", element: <CachesPage /> },
  ],
  crumbLabel: (pathname) => {
    if (pathname.startsWith("/elasticache/caches")) return ["キャッシュ"];
    if (pathname === "/elasticache") return ["ダッシュボード"];
    return null;
  },
};
