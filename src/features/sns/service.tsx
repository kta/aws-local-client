import { Navigate } from "react-router-dom";
import type { ServiceDefinition } from "../../services/types";
import snsIcon from "../../assets/aws/icon-sns.svg";
import { TopicDetailPage } from "./TopicDetailPage";
import { TopicsPage } from "./TopicsPage";

export const snsService: ServiceDefinition = {
  id: "sns",
  name: "SNS",
  description: "通知トピック",
  icon: snsIcon,
  basePath: "/sns",
  enabled: true,
  home: "/sns/topics",
  nav: [{ label: "トピック", path: "/sns/topics", testId: "nav-topics", group: 0 }],
  routes: [
    { path: "/sns", element: <Navigate to="/sns/topics" replace /> },
    { path: "/sns/topics", element: <TopicsPage /> },
    { path: "/sns/topics/:name", element: <TopicDetailPage /> },
  ],
  crumbLabel: (pathname) => {
    if (pathname.startsWith("/sns/topics/")) {
      const name = decodeURIComponent(pathname.slice("/sns/topics/".length));
      return ["トピック", name];
    }
    if (pathname.startsWith("/sns/topics")) return ["トピック"];
    return null;
  },
};
