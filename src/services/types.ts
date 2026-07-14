import type { RouteObject } from "react-router-dom";

export interface ServiceNavItem {
  label: string; // 例 "テーブル"
  path: string; // 例 "/dynamodb/tables"
  testId: string; // 例 "nav-tables"
  matchPrefix?: string; // active 判定用(既定は path)
  group?: number; // SideNav の区切り線グループ(0,1,...)
}

export interface ServiceDefinition {
  id: string; // "dynamodb"
  name: string; // "DynamoDB"
  description: string; // "NoSQL データベース"
  icon?: string; // import した svg(無ければ Home が略称タイルを描画)
  basePath: string; // "/dynamodb"
  enabled: boolean; // false = Home で "coming soon" グレー
  home: string; // Home カードのリンク先(例 "/dynamodb/tables")
  nav: ServiceNavItem[]; // SideNav 項目(空なら SideNav 非表示)
  routes: RouteObject[]; // この service 配下のルート群
  crumbLabel?: (pathname: string) => string[] | null; // パンくず末端(任意)
}
