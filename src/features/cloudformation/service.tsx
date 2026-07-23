import type { ServiceDefinition } from "../../services/types";
import { DashboardPage } from "./DashboardPage";
import { StackDetailPage } from "./StackDetailPage";
import { StacksPage } from "./StacksPage";

export const cloudformationService: ServiceDefinition = {
  id: "cloudformation",
  name: "CloudFormation",
  description: "インフラのコード管理",
  basePath: "/cloudformation",
  enabled: true,
  home: "/cloudformation",
  nav: [
    {
      label: "ダッシュボード",
      path: "/cloudformation",
      testId: "nav-cloudformation-dashboard",
      group: 0,
    },
    { label: "スタック", path: "/cloudformation/stacks", testId: "nav-stacks", group: 0 },
  ],
  routes: [
    { path: "/cloudformation", element: <DashboardPage /> },
    { path: "/cloudformation/stacks", element: <StacksPage /> },
    { path: "/cloudformation/stacks/:name", element: <StackDetailPage /> },
  ],
  crumbLabel: (pathname) => {
    if (pathname.startsWith("/cloudformation/stacks/")) {
      const name = decodeURIComponent(pathname.slice("/cloudformation/stacks/".length));
      return ["スタック", name];
    }
    if (pathname.startsWith("/cloudformation/stacks")) return ["スタック"];
    if (pathname === "/cloudformation") return ["ダッシュボード"];
    return null;
  },
};
