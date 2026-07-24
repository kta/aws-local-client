import type { ServiceDefinition } from "../../services/types";
import { DashboardPage } from "./DashboardPage";
import { FunctionDetailPage } from "./FunctionDetailPage";
import { FunctionsPage } from "./FunctionsPage";
import { LayersPage } from "./LayersPage";

export const lambdaService: ServiceDefinition = {
  id: "lambda",
  name: "Lambda",
  description: "サーバーレス関数",
  basePath: "/lambda",
  enabled: true,
  home: "/lambda",
  nav: [
    { label: "ダッシュボード", path: "/lambda", testId: "nav-lambda-dashboard", group: 0 },
    { label: "関数", path: "/lambda/functions", testId: "nav-functions", group: 0 },
    { label: "レイヤー", path: "/lambda/layers", testId: "nav-layers", group: 0 },
  ],
  routes: [
    { path: "/lambda", element: <DashboardPage /> },
    { path: "/lambda/functions", element: <FunctionsPage /> },
    { path: "/lambda/functions/:name", element: <FunctionDetailPage /> },
    { path: "/lambda/layers", element: <LayersPage /> },
  ],
  crumbLabel: (pathname) => {
    if (pathname.startsWith("/lambda/functions/")) {
      const name = decodeURIComponent(pathname.slice("/lambda/functions/".length));
      return ["関数", name];
    }
    if (pathname.startsWith("/lambda/functions")) return ["関数"];
    if (pathname.startsWith("/lambda/layers")) return ["レイヤー"];
    if (pathname === "/lambda") return ["ダッシュボード"];
    return null;
  },
};
