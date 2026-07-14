import type { ServiceDefinition } from "../../services/types";
import rdsIcon from "../../assets/aws/icon-rds.svg";
import { DashboardPage } from "./DashboardPage";
import { InstancesPage } from "./InstancesPage";
import { ParameterGroupsPage } from "./ParameterGroupsPage";
import { SnapshotsPage } from "./SnapshotsPage";

export const rdsService: ServiceDefinition = {
  id: "rds",
  name: "RDS",
  description: "リレーショナルデータベース",
  icon: rdsIcon,
  basePath: "/rds",
  enabled: true,
  home: "/rds",
  nav: [
    { label: "ダッシュボード", path: "/rds", testId: "nav-rds-dashboard", group: 0 },
    { label: "データベース", path: "/rds/instances", testId: "nav-instances", group: 0 },
    { label: "スナップショット", path: "/rds/snapshots", testId: "nav-snapshots", group: 0 },
    {
      label: "パラメータグループ",
      path: "/rds/parameter-groups",
      testId: "nav-parameter-groups",
      group: 0,
    },
  ],
  routes: [
    { path: "/rds", element: <DashboardPage /> },
    { path: "/rds/instances", element: <InstancesPage /> },
    { path: "/rds/snapshots", element: <SnapshotsPage /> },
    { path: "/rds/parameter-groups", element: <ParameterGroupsPage /> },
  ],
  crumbLabel: (pathname) => {
    if (pathname.startsWith("/rds/instances")) return ["データベース"];
    if (pathname.startsWith("/rds/snapshots")) return ["スナップショット"];
    if (pathname.startsWith("/rds/parameter-groups")) return ["パラメータグループ"];
    if (pathname === "/rds") return ["ダッシュボード"];
    return null;
  },
};
