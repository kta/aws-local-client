import type { ServiceDefinition } from "../../services/types";
import { ApiDetailPage } from "./ApiDetailPage";
import { ApiKeysPage } from "./ApiKeysPage";
import { ApisPage } from "./ApisPage";
import { DashboardPage } from "./DashboardPage";

export const apiGatewayService: ServiceDefinition = {
  id: "api-gateway",
  name: "API Gateway",
  description: "REST API の管理",
  basePath: "/api-gateway",
  enabled: true,
  home: "/api-gateway",
  nav: [
    { label: "ダッシュボード", path: "/api-gateway", testId: "nav-apigw-dashboard", group: 0 },
    { label: "API", path: "/api-gateway/apis", testId: "nav-apis", group: 0 },
    { label: "API キー", path: "/api-gateway/api-keys", testId: "nav-api-keys", group: 0 },
  ],
  routes: [
    { path: "/api-gateway", element: <DashboardPage /> },
    { path: "/api-gateway/apis", element: <ApisPage /> },
    { path: "/api-gateway/apis/:id", element: <ApiDetailPage /> },
    { path: "/api-gateway/api-keys", element: <ApiKeysPage /> },
  ],
  crumbLabel: (pathname) => {
    if (pathname.startsWith("/api-gateway/apis/")) {
      const id = decodeURIComponent(pathname.slice("/api-gateway/apis/".length));
      return ["API", id];
    }
    if (pathname.startsWith("/api-gateway/apis")) return ["API"];
    if (pathname.startsWith("/api-gateway/api-keys")) return ["API キー"];
    if (pathname === "/api-gateway") return ["ダッシュボード"];
    return null;
  },
};
