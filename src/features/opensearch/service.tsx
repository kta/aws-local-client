import type { ServiceDefinition } from "../../services/types";
import { DashboardPage } from "./DashboardPage";
import { DomainDetailPage } from "./DomainDetailPage";
import { DomainsPage } from "./DomainsPage";

export const opensearchService: ServiceDefinition = {
  id: "opensearch",
  name: "OpenSearch",
  description: "検索・分析エンジン",
  basePath: "/opensearch",
  enabled: true,
  home: "/opensearch",
  nav: [
    { label: "ダッシュボード", path: "/opensearch", testId: "nav-opensearch-dashboard", group: 0 },
    { label: "ドメイン", path: "/opensearch/domains", testId: "nav-domains", group: 0 },
  ],
  routes: [
    { path: "/opensearch", element: <DashboardPage /> },
    { path: "/opensearch/domains", element: <DomainsPage /> },
    { path: "/opensearch/domains/:name", element: <DomainDetailPage /> },
  ],
  crumbLabel: (pathname) => {
    if (pathname.startsWith("/opensearch/domains/")) return ["ドメイン", "詳細"];
    if (pathname.startsWith("/opensearch/domains")) return ["ドメイン"];
    if (pathname === "/opensearch") return ["ダッシュボード"];
    return null;
  },
};
