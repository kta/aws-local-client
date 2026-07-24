import type { ServiceDefinition } from "../../services/types";
import { DashboardPage } from "./DashboardPage";
import { ExecutionDetailPage } from "./ExecutionDetailPage";
import { StateMachineDetailPage } from "./StateMachineDetailPage";
import { StateMachinesPage } from "./StateMachinesPage";

export const stepFunctionsService: ServiceDefinition = {
  id: "step-functions",
  name: "Step Functions",
  description: "サーバーレスワークフロー",
  basePath: "/step-functions",
  enabled: true,
  home: "/step-functions",
  nav: [
    {
      label: "ダッシュボード",
      path: "/step-functions",
      testId: "nav-step-functions-dashboard",
      group: 0,
    },
    {
      label: "ステートマシン",
      path: "/step-functions/state-machines",
      testId: "nav-state-machines",
      group: 0,
    },
  ],
  routes: [
    { path: "/step-functions", element: <DashboardPage /> },
    { path: "/step-functions/state-machines", element: <StateMachinesPage /> },
    { path: "/step-functions/state-machines/:name", element: <StateMachineDetailPage /> },
    { path: "/step-functions/executions/:arn", element: <ExecutionDetailPage /> },
  ],
  crumbLabel: (pathname) => {
    if (pathname.startsWith("/step-functions/executions/")) {
      return ["実行"];
    }
    if (pathname.startsWith("/step-functions/state-machines/")) {
      const name = decodeURIComponent(
        pathname.slice("/step-functions/state-machines/".length),
      );
      return ["ステートマシン", name];
    }
    if (pathname.startsWith("/step-functions/state-machines")) return ["ステートマシン"];
    if (pathname === "/step-functions") return ["ダッシュボード"];
    return null;
  },
};
