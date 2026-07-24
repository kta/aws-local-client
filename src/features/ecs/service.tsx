import type { ServiceDefinition } from "../../services/types";
import { ClusterDetailPage } from "./ClusterDetailPage";
import { ClustersPage } from "./ClustersPage";
import { DashboardPage } from "./DashboardPage";
import { TaskDefinitionsPage } from "./TaskDefinitionsPage";

export const ecsService: ServiceDefinition = {
  id: "ecs",
  name: "ECS",
  description: "コンテナオーケストレーション",
  basePath: "/ecs",
  enabled: true,
  home: "/ecs",
  nav: [
    { label: "ダッシュボード", path: "/ecs", testId: "nav-ecs-dashboard", group: 0 },
    { label: "クラスター", path: "/ecs/clusters", testId: "nav-ecs-clusters", group: 0 },
    {
      label: "タスク定義",
      path: "/ecs/task-definitions",
      testId: "nav-ecs-task-definitions",
      group: 0,
    },
  ],
  routes: [
    { path: "/ecs", element: <DashboardPage /> },
    { path: "/ecs/clusters", element: <ClustersPage /> },
    { path: "/ecs/clusters/:name", element: <ClusterDetailPage /> },
    { path: "/ecs/task-definitions", element: <TaskDefinitionsPage /> },
  ],
  crumbLabel: (pathname) => {
    if (pathname.startsWith("/ecs/clusters/")) {
      const name = decodeURIComponent(pathname.slice("/ecs/clusters/".length));
      return ["クラスター", name];
    }
    if (pathname.startsWith("/ecs/clusters")) return ["クラスター"];
    if (pathname.startsWith("/ecs/task-definitions")) return ["タスク定義"];
    if (pathname === "/ecs") return ["ダッシュボード"];
    return null;
  },
};
