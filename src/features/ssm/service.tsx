import { Navigate } from "react-router-dom";
import type { ServiceDefinition } from "../../services/types";
import { ParametersPage } from "./ParametersPage";

export const ssmService: ServiceDefinition = {
  id: "ssm",
  name: "Systems Manager",
  description: "パラメータストア",
  basePath: "/ssm",
  enabled: true,
  home: "/ssm/parameters",
  nav: [
    { label: "パラメータストア", path: "/ssm/parameters", testId: "nav-parameters", group: 0 },
  ],
  routes: [
    { path: "/ssm", element: <Navigate to="/ssm/parameters" replace /> },
    { path: "/ssm/parameters", element: <ParametersPage /> },
  ],
  crumbLabel: (pathname) => {
    if (pathname.startsWith("/ssm/parameters")) return ["パラメータストア"];
    return null;
  },
};
