import type { ServiceDefinition } from "../../services/types";
import { DashboardPage } from "./DashboardPage";
import { QueueDetailPage } from "./QueueDetailPage";
import { QueuesPage } from "./QueuesPage";

export const sqsService: ServiceDefinition = {
  id: "sqs",
  name: "SQS",
  description: "メッセージキュー",
  basePath: "/sqs",
  enabled: true,
  home: "/sqs",
  nav: [
    { label: "ダッシュボード", path: "/sqs", testId: "nav-sqs-dashboard", group: 0 },
    { label: "キュー", path: "/sqs/queues", testId: "nav-queues", group: 0 },
  ],
  routes: [
    { path: "/sqs", element: <DashboardPage /> },
    { path: "/sqs/queues", element: <QueuesPage /> },
    { path: "/sqs/queues/:name", element: <QueueDetailPage /> },
  ],
  crumbLabel: (pathname) => {
    if (pathname.startsWith("/sqs/queues/")) {
      const name = decodeURIComponent(pathname.slice("/sqs/queues/".length));
      return ["キュー", name];
    }
    if (pathname.startsWith("/sqs/queues")) return ["キュー"];
    if (pathname === "/sqs") return ["ダッシュボード"];
    return null;
  },
};
