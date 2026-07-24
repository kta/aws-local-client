import type { ServiceDefinition } from "../../services/types";
import { BusesPage } from "./BusesPage";
import { DashboardPage } from "./DashboardPage";
import { RulesPage } from "./RulesPage";

export const eventbridgeService: ServiceDefinition = {
  id: "eventbridge",
  name: "EventBridge",
  description: "イベントバス",
  basePath: "/eventbridge",
  enabled: true,
  home: "/eventbridge",
  nav: [
    { label: "ダッシュボード", path: "/eventbridge", testId: "nav-eventbridge-dashboard", group: 0 },
    { label: "イベントバス", path: "/eventbridge/buses", testId: "nav-buses", group: 0 },
    { label: "ルール", path: "/eventbridge/rules", testId: "nav-rules", group: 0 },
  ],
  routes: [
    { path: "/eventbridge", element: <DashboardPage /> },
    { path: "/eventbridge/buses", element: <BusesPage /> },
    { path: "/eventbridge/rules", element: <RulesPage /> },
  ],
  crumbLabel: (pathname) => {
    if (pathname.startsWith("/eventbridge/buses")) return ["イベントバス"];
    if (pathname.startsWith("/eventbridge/rules")) return ["ルール"];
    if (pathname === "/eventbridge") return ["ダッシュボード"];
    return null;
  },
};
