import type { ServiceDefinition } from "../../services/types";
import { BackupsPage } from "./BackupsPage";
import { DashboardPage } from "./DashboardPage";
import { ExplorePage } from "./ExplorePage";
import { PartiqlPage } from "./PartiqlPage";
import { TableDetailPage } from "./TableDetailPage";
import { TablesPage } from "./TablesPage";

export const dynamodbService: ServiceDefinition = {
  id: "dynamodb",
  name: "DynamoDB",
  description: "NoSQL データベース",
  basePath: "/dynamodb",
  enabled: true,
  home: "/dynamodb/tables",
  nav: [
    { label: "ダッシュボード", path: "/dynamodb", testId: "nav-dashboard", group: 0 },
    { label: "テーブル", path: "/dynamodb/tables", testId: "nav-tables", group: 0 },
    { label: "項目を探索", path: "/dynamodb/explore", testId: "nav-explore", group: 0 },
    { label: "PartiQL エディタ", path: "/dynamodb/partiql", testId: "nav-partiql", group: 1 },
    { label: "バックアップ", path: "/dynamodb/backups", testId: "nav-backups", group: 1 },
  ],
  routes: [
    { path: "/dynamodb", element: <DashboardPage /> },
    { path: "/dynamodb/tables", element: <TablesPage /> },
    { path: "/dynamodb/tables/:tableName", element: <TableDetailPage /> },
    { path: "/dynamodb/explore", element: <ExplorePage /> },
    { path: "/dynamodb/partiql", element: <PartiqlPage /> },
    { path: "/dynamodb/backups", element: <BackupsPage /> },
  ],
  crumbLabel: (pathname) => {
    if (pathname.startsWith("/dynamodb/tables/")) {
      const name = decodeURIComponent(pathname.slice("/dynamodb/tables/".length));
      return ["テーブル", name];
    }
    if (pathname.startsWith("/dynamodb/tables")) return ["テーブル"];
    if (pathname.startsWith("/dynamodb/explore")) return ["項目を探索"];
    return null;
  },
};
