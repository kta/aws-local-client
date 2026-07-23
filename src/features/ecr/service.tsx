import { Navigate } from "react-router-dom";
import type { ServiceDefinition } from "../../services/types";
import { RepositoriesPage } from "./RepositoriesPage";
import { RepositoryDetailPage } from "./RepositoryDetailPage";

export const ecrService: ServiceDefinition = {
  id: "ecr",
  name: "ECR",
  description: "コンテナレジストリ",
  basePath: "/ecr",
  enabled: true,
  home: "/ecr/repositories",
  nav: [
    { label: "リポジトリ", path: "/ecr/repositories", testId: "nav-ecr-repositories", group: 0 },
  ],
  routes: [
    { path: "/ecr", element: <Navigate to="/ecr/repositories" replace /> },
    { path: "/ecr/repositories", element: <RepositoriesPage /> },
    { path: "/ecr/repositories/:name", element: <RepositoryDetailPage /> },
  ],
  crumbLabel: (pathname) => {
    if (pathname.startsWith("/ecr/repositories/")) {
      const name = decodeURIComponent(pathname.slice("/ecr/repositories/".length));
      return ["リポジトリ", name];
    }
    if (pathname.startsWith("/ecr/repositories")) return ["リポジトリ"];
    return null;
  },
};
