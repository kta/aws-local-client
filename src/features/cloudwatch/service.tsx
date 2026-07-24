import type { ServiceDefinition } from "../../services/types";
import { AlarmsPage } from "./AlarmsPage";
import { DashboardPage } from "./DashboardPage";
import { LogGroupDetailPage } from "./LogGroupDetailPage";
import { LogGroupsPage } from "./LogGroupsPage";
import { MetricsPage } from "./MetricsPage";

export const cloudwatchService: ServiceDefinition = {
  id: "cloudwatch",
  name: "CloudWatch",
  description: "モニタリングとログ",
  basePath: "/cloudwatch",
  enabled: true,
  home: "/cloudwatch",
  nav: [
    { label: "ダッシュボード", path: "/cloudwatch", testId: "nav-cloudwatch-dashboard", group: 0 },
    { label: "ロググループ", path: "/cloudwatch/log-groups", testId: "nav-log-groups", group: 0 },
    { label: "メトリクス", path: "/cloudwatch/metrics", testId: "nav-metrics", group: 0 },
    { label: "アラーム", path: "/cloudwatch/alarms", testId: "nav-alarms", group: 0 },
  ],
  routes: [
    { path: "/cloudwatch", element: <DashboardPage /> },
    { path: "/cloudwatch/log-groups", element: <LogGroupsPage /> },
    { path: "/cloudwatch/log-groups/:name", element: <LogGroupDetailPage /> },
    { path: "/cloudwatch/metrics", element: <MetricsPage /> },
    { path: "/cloudwatch/alarms", element: <AlarmsPage /> },
  ],
  crumbLabel: (pathname) => {
    if (pathname.startsWith("/cloudwatch/log-groups/")) {
      const name = decodeURIComponent(pathname.slice("/cloudwatch/log-groups/".length));
      return ["ロググループ", name];
    }
    if (pathname.startsWith("/cloudwatch/log-groups")) return ["ロググループ"];
    if (pathname.startsWith("/cloudwatch/metrics")) return ["メトリクス"];
    if (pathname.startsWith("/cloudwatch/alarms")) return ["アラーム"];
    if (pathname === "/cloudwatch") return ["ダッシュボード"];
    return null;
  },
};
