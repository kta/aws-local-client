import { Navigate } from "react-router-dom";
import type { ServiceDefinition } from "../../services/types";
import rdsIcon from "../../assets/aws/icon-rds.svg";
import { InstancesPage } from "./InstancesPage";

export const rdsService: ServiceDefinition = {
  id: "rds",
  name: "RDS",
  description: "リレーショナルデータベース",
  icon: rdsIcon,
  basePath: "/rds",
  enabled: true,
  home: "/rds/instances",
  nav: [{ label: "データベース", path: "/rds/instances", testId: "nav-instances", group: 0 }],
  routes: [
    { path: "/rds", element: <Navigate to="/rds/instances" replace /> },
    { path: "/rds/instances", element: <InstancesPage /> },
  ],
  crumbLabel: (pathname) => {
    if (pathname.startsWith("/rds/instances")) return ["データベース"];
    return null;
  },
};
