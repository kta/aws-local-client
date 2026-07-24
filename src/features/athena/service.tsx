import type { ServiceDefinition } from "../../services/types";
import { QueryEditorPage } from "./QueryEditorPage";
import { SavedQueriesPage } from "./SavedQueriesPage";
import { WorkgroupsPage } from "./WorkgroupsPage";

export const athenaService: ServiceDefinition = {
  id: "athena",
  name: "Athena",
  description: "サーバーレスクエリ",
  basePath: "/athena",
  enabled: true,
  home: "/athena",
  nav: [
    { label: "クエリエディタ", path: "/athena", testId: "nav-athena-editor", group: 0 },
    {
      label: "保存したクエリ",
      path: "/athena/saved-queries",
      testId: "nav-athena-saved",
      group: 0,
    },
    {
      label: "ワークグループ",
      path: "/athena/workgroups",
      testId: "nav-athena-workgroups",
      group: 0,
    },
  ],
  routes: [
    { path: "/athena", element: <QueryEditorPage /> },
    { path: "/athena/saved-queries", element: <SavedQueriesPage /> },
    { path: "/athena/workgroups", element: <WorkgroupsPage /> },
  ],
  crumbLabel: (pathname) => {
    if (pathname.startsWith("/athena/saved-queries")) return ["保存したクエリ"];
    if (pathname.startsWith("/athena/workgroups")) return ["ワークグループ"];
    if (pathname === "/athena") return ["クエリエディタ"];
    return null;
  },
};
