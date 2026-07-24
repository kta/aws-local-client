import type { ServiceDefinition } from "../../services/types";
import { ClusterDetailPage } from "./ClusterDetailPage";
import { ClustersPage } from "./ClustersPage";
import { DashboardPage } from "./DashboardPage";

export const mskService: ServiceDefinition = {
  id: "msk",
  name: "MSK",
  description: "マネージド Apache Kafka",
  basePath: "/msk",
  enabled: true,
  home: "/msk",
  nav: [
    { label: "ダッシュボード", path: "/msk", testId: "nav-msk-dashboard", group: 0 },
    { label: "クラスター", path: "/msk/clusters", testId: "nav-clusters", group: 0 },
  ],
  routes: [
    { path: "/msk", element: <DashboardPage /> },
    { path: "/msk/clusters", element: <ClustersPage /> },
    { path: "/msk/clusters/:name", element: <ClusterDetailPage /> },
  ],
  crumbLabel: (pathname) => {
    if (pathname.startsWith("/msk/clusters/")) {
      const name = decodeURIComponent(pathname.split("/")[3] ?? "");
      return ["クラスター", name];
    }
    if (pathname.startsWith("/msk/clusters")) return ["クラスター"];
    if (pathname === "/msk") return ["ダッシュボード"];
    return null;
  },
};
