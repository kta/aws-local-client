import { Navigate } from "react-router-dom";
import type { ServiceDefinition } from "../../services/types";
import sqsIcon from "../../assets/aws/icon-sqs.svg";
import { QueueDetailPage } from "./QueueDetailPage";
import { QueuesPage } from "./QueuesPage";

export const sqsService: ServiceDefinition = {
  id: "sqs",
  name: "SQS",
  description: "メッセージキュー",
  icon: sqsIcon,
  basePath: "/sqs",
  enabled: true,
  home: "/sqs/queues",
  nav: [{ label: "キュー", path: "/sqs/queues", testId: "nav-queues", group: 0 }],
  routes: [
    { path: "/sqs", element: <Navigate to="/sqs/queues" replace /> },
    { path: "/sqs/queues", element: <QueuesPage /> },
    { path: "/sqs/queues/:name", element: <QueueDetailPage /> },
  ],
  crumbLabel: (pathname) => {
    if (pathname.startsWith("/sqs/queues/")) {
      const name = decodeURIComponent(pathname.slice("/sqs/queues/".length));
      return ["キュー", name];
    }
    if (pathname.startsWith("/sqs/queues")) return ["キュー"];
    return null;
  },
};
