import type { ServiceDefinition } from "../../services/types";
import { DashboardPage } from "./DashboardPage";
import { UserPoolDetailPage } from "./UserPoolDetailPage";
import { UserPoolsPage } from "./UserPoolsPage";

export const cognitoService: ServiceDefinition = {
  id: "cognito",
  name: "Cognito",
  description: "ユーザー認証",
  basePath: "/cognito",
  enabled: true,
  home: "/cognito",
  nav: [
    { label: "ダッシュボード", path: "/cognito", testId: "nav-cognito-dashboard", group: 0 },
    { label: "ユーザープール", path: "/cognito/user-pools", testId: "nav-user-pools", group: 0 },
  ],
  routes: [
    { path: "/cognito", element: <DashboardPage /> },
    { path: "/cognito/user-pools", element: <UserPoolsPage /> },
    { path: "/cognito/user-pools/:id", element: <UserPoolDetailPage /> },
  ],
  crumbLabel: (pathname) => {
    if (pathname.startsWith("/cognito/user-pools/")) {
      const id = decodeURIComponent(pathname.slice("/cognito/user-pools/".length));
      return ["ユーザープール", id];
    }
    if (pathname.startsWith("/cognito/user-pools")) return ["ユーザープール"];
    if (pathname === "/cognito") return ["ダッシュボード"];
    return null;
  },
};
