import type { ServiceDefinition } from "../../services/types";
import snsIcon from "../../assets/aws/icon-sns.svg";
import { DashboardPage } from "./DashboardPage";
import { SubscriptionsPage } from "./SubscriptionsPage";
import { TopicDetailPage } from "./TopicDetailPage";
import { TopicsPage } from "./TopicsPage";

export const snsService: ServiceDefinition = {
  id: "sns",
  name: "SNS",
  description: "通知トピック",
  icon: snsIcon,
  basePath: "/sns",
  enabled: true,
  home: "/sns",
  nav: [
    { label: "ダッシュボード", path: "/sns", testId: "nav-sns-dashboard", group: 0 },
    { label: "トピック", path: "/sns/topics", testId: "nav-topics", group: 0 },
    { label: "サブスクリプション", path: "/sns/subscriptions", testId: "nav-subscriptions", group: 0 },
  ],
  routes: [
    { path: "/sns", element: <DashboardPage /> },
    { path: "/sns/topics", element: <TopicsPage /> },
    { path: "/sns/topics/:name", element: <TopicDetailPage /> },
    { path: "/sns/subscriptions", element: <SubscriptionsPage /> },
  ],
  crumbLabel: (pathname) => {
    if (pathname.startsWith("/sns/topics/")) {
      const name = decodeURIComponent(pathname.slice("/sns/topics/".length));
      return ["トピック", name];
    }
    if (pathname.startsWith("/sns/topics")) return ["トピック"];
    if (pathname.startsWith("/sns/subscriptions")) return ["サブスクリプション"];
    return null;
  },
};
