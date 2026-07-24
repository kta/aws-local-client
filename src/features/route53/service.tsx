import type { ServiceDefinition } from "../../services/types";
import { DashboardPage } from "./DashboardPage";
import { HealthChecksPage } from "./HealthChecksPage";
import { HostedZoneDetailPage } from "./HostedZoneDetailPage";
import { HostedZonesPage } from "./HostedZonesPage";

export const route53Service: ServiceDefinition = {
  id: "route53",
  name: "Route 53",
  description: "DNS・ヘルスチェック",
  basePath: "/route53",
  enabled: true,
  home: "/route53",
  nav: [
    { label: "ダッシュボード", path: "/route53", testId: "nav-route53-dashboard", group: 0 },
    { label: "ホストゾーン", path: "/route53/hosted-zones", testId: "nav-hosted-zones", group: 0 },
    {
      label: "ヘルスチェック",
      path: "/route53/health-checks",
      testId: "nav-health-checks",
      group: 0,
    },
  ],
  routes: [
    { path: "/route53", element: <DashboardPage /> },
    { path: "/route53/hosted-zones", element: <HostedZonesPage /> },
    { path: "/route53/hosted-zones/:id", element: <HostedZoneDetailPage /> },
    { path: "/route53/health-checks", element: <HealthChecksPage /> },
  ],
  crumbLabel: (pathname) => {
    if (pathname.startsWith("/route53/hosted-zones/")) {
      const id = decodeURIComponent(pathname.slice("/route53/hosted-zones/".length));
      return ["ホストゾーン", id];
    }
    if (pathname.startsWith("/route53/hosted-zones")) return ["ホストゾーン"];
    if (pathname.startsWith("/route53/health-checks")) return ["ヘルスチェック"];
    if (pathname === "/route53") return ["ダッシュボード"];
    return null;
  },
};
