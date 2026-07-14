# 共通コンポーネント化 & サービス拡張アーキテクチャ設計

- 対象ブランチ: `feature/phase3-dashboard-partiql-backup`
- 状態: 設計のみ(実装・コミットは含まない)
- 目的:
  1. **共通化** — DynamoDB 各ページに散在する重複パターン(スタイル定数・テーブル・モーダル・状態表示・フォーマッタ)を再利用可能なコンポーネント/フックに抽出する。
  2. **サービス拡張性** — 将来サービス(SQS / SNS / S3 / EC2 / EKS)を追加するとき、原則 `src/features/<service>/` と `src-tauri/src/commands/<service>.rs` を足すだけで済み、共通基盤(Layout / SideNav / ルーティング / エラー契約 / クライアント生成)に手を入れなくてよい構造にする。

前提: **視覚的リデザインは行わない**(`docs/design/ui-mock.html` 準拠を維持)。抽出は「見た目を保ったまま実装を 1 箇所へ寄せる」ことが目的。E2E が依存する `data-testid` は一切変更しない。

---

## 1. 現状の重複カタログ

「occ.」= 概ね同一の実装が現れる箇所数。行番号は現行 HEAD 時点。

### 1.1 スタイル定数(既知バックログ「style-const dedup」= `.superpowers/sdd/progress.md:16`)

| パターン | occ. | 参照 (file:line) |
|---|---|---|
| `CARD` = `rounded-[10px] border border-[#d9dee3] bg-white shadow-...` | 4 | `TableDetailPage.tsx:9`, `ExplorePage.tsx:13`, `DashboardPage.tsx:8`, `PartiqlPage.tsx:9`(加えて `TablesPage.tsx:177` / `BackupsPage.tsx:301` はインライン同等文字列) |
| `CARD_HEAD` = `flex items-center gap-[10px] border-b ... text-[14.5px] font-bold` | 4 | `TableDetailPage.tsx:10`, `ExplorePage.tsx:14`, `DashboardPage.tsx:9`, `PartiqlPage.tsx:10` |
| `BTN`(secondary) | 4 | `TableDetailPage.tsx:14`, `ExplorePage.tsx:16`, `DashboardPage.tsx:10`, `PartiqlPage.tsx:12`(`disabled:` 有無で 2 変種) |
| `BTN_PRIMARY` | 4 | `TableDetailPage.tsx:15`, `ExplorePage.tsx:17`, `DashboardPage.tsx:11`, `PartiqlPage.tsx:13`(+ インライン: `TablesPage.tsx:169`, `BackupsPage.tsx:270`, `DashboardPage.tsx`/`ConnectionsPage.tsx` の追加ボタン) |
| `BTN_DANGER` / danger インライン | 3 | `TableDetailPage.tsx:17`, `TablesPage.tsx:162`(border-color-mix 版), `ConnectionsPage.tsx:217` |
| `BTN_SM` / `BTN_SM_PRIMARY` | 2 | `TableDetailPage.tsx:16`, `ExplorePage.tsx:18-19` |
| `INPUT` = `rounded-lg border border-[#d9dee3] ... px-[10px] py-[6px] text-[13px]` | 2(+inline) | `ExplorePage.tsx:15`, `PartiqlPage.tsx:11`(+ `ConnectionsPage.tsx:108`, `CreateTableModal`/`BackupsPage` はグレー系の別インライン) |
| `KEY_CHIP` / KeyChip(pk/sk のモノスペースチップ) | 3 | `TablesPage.tsx:14`(`CHIP_KEY`)+`KeyChip:17`, `TableDetailPage.tsx:19`(`keyChip`), `ExplorePage.tsx:20`(`KEY_CHIP`) |

### 1.2 データテーブル

2 系統のテーブルヘッダ実装が重複している。

| パターン | occ. | 参照 |
|---|---|---|
| 一覧テーブル `<thead>`(`[&>th]:... bg-[color-mix(in_srgb,#fff_60%,#f0f1f3)]`) | 3 | `TablesPage.tsx:185`, `DashboardPage.tsx:137`, `BackupsPage.tsx:311` |
| 行 hover(`[&>td]:border-b ... hover:[&>td]:bg-[color-mix(in_srgb,#0972d3_5%,#fff)]`) | 3 | `TablesPage.tsx:202`, `DashboardPage.tsx:151`, `BackupsPage.tsx:325` |
| 結果テーブル `<thead>`(`bg-[#f5f6f7] text-[12px] text-[#5f6b7a]`) | 3 | `TableDetailPage.tsx:95`(IndexCard), `ExplorePage.tsx:416`, `PartiqlPage.tsx:164` |
| 行チェックボックス選択(`Set` トグル) | 2 | `TablesPage.tsx:103-110`(name), `ExplorePage.tsx:217-224`(index) |
| セル列生成 `columnsOf` / `cellText` | 2 | `explore.ts:23-39`(共有ヘルパ), `PartiqlPage.tsx:18-34`(独自コピー) |

### 1.3 モーダル

| パターン | occ. | 参照 |
|---|---|---|
| バックドロップ `fixed inset-0 flex items-center justify-center bg-black/40` + `onClick={onClose}` | 6 | `TableDetailPage.tsx:40`, `ItemEditorModal.tsx:57`, `BackupsPage.tsx:53`, `BackupsPage.tsx:123`, `CreateTableModal.tsx:78`, `ConnectionsPage.tsx:227` |
| パネル `w-full max-w-* rounded-lg bg-white p-6` + `stopPropagation` | 6 | 同上 |
| フッターボタン行 `flex justify-end gap-2` (キャンセル/実行) + `submitting` 表示 | 5 | `TableDetailPage.tsx:55`, `BackupsPage.tsx:80`/`138`, `CreateTableModal.tsx:151`, `ItemEditorModal.tsx:87`, `ConnectionsPage.tsx:272` |

### 1.4 危険操作(削除)確認

| パターン | occ. | 参照 |
|---|---|---|
| テーブル名タイプ確認削除 | 2(2 変種) | `TablesPage.tsx:123-134`(`window.prompt`)、`TableDetailPage.tsx:27-81`(`DeleteTableModal`、入力+`disabled` 一致判定) |
| `window.confirm` 破壊確認 | 3 | `ExplorePage.tsx:188`, `BackupsPage.tsx:231`, `ConnectionsPage.tsx:77` |

### 1.5 状態表示(loading / empty / error / badge)

| パターン | occ. | 参照 |
|---|---|---|
| ローディング `読み込み中...`(中央グレー) | 4 | `TablesPage.tsx:178`, `DashboardPage.tsx:120`, `BackupsPage.tsx:302`, `ExplorePage.tsx:426` |
| 空表示 `〜がありません`(中央グレー) | 4 | `TablesPage.tsx:180`, `DashboardPage.tsx:121`, `BackupsPage.tsx:303`, `ExplorePage.tsx:433` |
| 接続未選択ガード(`接続が未登録です…`) | 3 | `TablesPage.tsx:136`, `DashboardPage.tsx:73`, `BackupsPage.tsx:242`(Explore/Partiql は未実装 = 不整合) |
| ステータスバッジ(緑 `● アクティブ`) | 3 | `TablesPage.tsx:26-37`(`StatusCell`), `TableDetailPage.tsx:240`, `DashboardPage.tsx:155` |
| `ErrorBanner` + `onRetry={load}` 配線 | 6 | 全 DDB ページ(`TablesPage.tsx:175` ほか) |

### 1.6 ページヘッダ / サマリ

| パターン | occ. | 参照 |
|---|---|---|
| ヘッダ `flex ... gap-3` + `h1 text-[20px] font-bold` + 件数 + `flex-1` スペーサ + 右アクション | 7 | `TablesPage.tsx:150`, `DashboardPage.tsx:87`, `ExplorePage.tsx:228`, `PartiqlPage.tsx:105`, `BackupsPage.tsx:256`, `ConnectionsPage.tsx:118`, `Home.tsx:41` |
| サマリカード(ラベル+大数値) | 1(将来必須) | `DashboardPage.tsx:27`(`SummaryCard`) |

### 1.7 フォーマッタ(発散した重複 = 要注意)

| パターン | occ. | 参照 |
|---|---|---|
| バイト整形 `formatBytes` | 3(実装が**非一致**) | `explore.ts:42`(log ベース, `TableDetailPage` が使用), `DashboardPage.tsx:14`(ループ, TB まで), `BackupsPage.tsx:13`(`formatSize`, MB まで, `undefined` 許容) |
| 日時整形 `formatDate`(`toLocaleString("ja-JP")`) | 1(将来必須) | `BackupsPage.tsx:21` |

### 1.8 プロフィール変更時フェッチ副作用

同一形の `load = useCallback(...if(!active)return...)` + `useEffect(()=>{void load()},[load])`(`active` に暗黙依存)。

- occ. 6: `TablesPage.tsx:64-81`, `TableDetailPage.tsx:141-153`, `DashboardPage.tsx:43-60`, `PartiqlPage.tsx:47-57`, `BackupsPage.tsx:167-185`, `ExplorePage.tsx:50-64`
- 付随バックログ: 「async-switch race guards」「onRetry guard」「re-describe chatter」(`.superpowers/sdd/progress.md:16`)は、このフックへ集約すれば一括で解消できる。

### 1.9 Rust 側の重複

| パターン | occ. | 参照 |
|---|---|---|
| `#[tauri::command] pub async fn ddb_*(profile) { core(&make_client(&profile), ...).await }` 薄いラッパ | 13 | `ddb.rs:467-568` |
| クライアント設定ビルダ(creds+timeout+endpoint+region) | 2 | `connections.rs:70-90`(`make_client`), `connections.rs:92-111`(`probe`)。既知バックログ「config-builder dedup」(`.superpowers/sdd/progress.md:16`) |

---

## 2. 共通コンポーネント設計

新規ディレクトリ `src/components/ui/`(プリミティブ)と `src/lib/`(非 UI ロジック)へ集約する。YAGNI 基準: **現時点で 2 箇所以上の実使用があるもの**、または**全サービスページが確実に必要とするもの**のみ抽出。型は `src/api/types.ts` の既存型に対して整合する。

### 2.1 スタイルトークン `src/components/ui/tokens.ts`

Tailwind クラス文字列を単一定義に集約(視覚は不変)。コンポーネント未使用箇所の暫定利用にも使える。

```ts
export const cx = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(" ");

export const card = "rounded-[10px] border border-[#d9dee3] bg-white shadow-[0_1px_2px_rgba(0,21,41,.08)]";
export const cardHead = "flex items-center gap-[10px] border-b border-[#d9dee3] px-4 py-3 text-[14.5px] font-bold";
export const input = "rounded-lg border border-[#d9dee3] bg-white px-[10px] py-[6px] text-[13px]";
```

置換対象: §1.1 の `CARD` / `CARD_HEAD` / `INPUT` 全箇所。

### 2.2 `<Button>` — `src/components/ui/Button.tsx`

```ts
type ButtonVariant = "primary" | "secondary" | "danger";
type ButtonSize = "md" | "sm";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant; // default "secondary"
  size?: ButtonSize;       // default "md"
}

export function Button(props: ButtonProps): JSX.Element;
```

- 挙動集約: `disabled:cursor-not-allowed disabled:opacity-45` を全 variant に一律付与(現状は付いている箇所と無い箇所が混在 §1.1)。
- 置換対象: `BTN` / `BTN_PRIMARY` / `BTN_DANGER` / `BTN_SM` / `BTN_SM_PRIMARY` と各ページのインラインボタン。`data-testid` は `props` 経由でそのまま透過(E2E 不変)。

### 2.3 `<PageHeader>` — `src/components/ui/PageHeader.tsx`

```ts
interface PageHeaderProps {
  title: string;
  count?: number;            // 指定時 "(n)" をグレー表示
  titleTestId?: string;      // 例 "tables-heading"
  countTestId?: string;      // 例 "tables-count"
  children?: React.ReactNode; // 右寄せアクション(spacer は内部で挿入)
}
export function PageHeader(props: PageHeaderProps): JSX.Element;
```

置換対象: §1.6 の 7 箇所のヘッダ行。

### 2.4 `<Card>` / `<CardSection>` — `src/components/ui/Card.tsx`

```ts
interface CardProps {
  title?: React.ReactNode;         // 指定時 cardHead を描画
  headerActions?: React.ReactNode; // タイトル右の flex-1 後ろに配置
  overflowHidden?: boolean;
  className?: string;
  children: React.ReactNode;
}
export function Card(props: CardProps): JSX.Element;
```

置換対象: `TableDetailPage`(一般情報/項目概要/IndexCard 外枠), `ExplorePage`(条件/結果), `PartiqlPage`(ステートメント/結果), `DashboardPage`(テーブル)。

### 2.5 `<DataTable>` — `src/components/ui/DataTable.tsx`

2 系統(一覧 / 結果)を `variant` で吸収。列定義駆動。

```ts
interface Column<Row> {
  key: string;
  header: React.ReactNode;
  render?: (row: Row) => React.ReactNode; // 既定は String(row[key])
  className?: string;                       // td 付与(例 max-w truncate)
  headerClassName?: string;
}

interface DataTableProps<Row> {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row, index: number) => string;
  variant?: "list" | "results";       // thead スタイル 2 系統(§1.2)
  loading?: boolean;                   // 行スパンで "読み込み中..."
  emptyText?: React.ReactNode;         // 0 件時
  onRowClick?: (row: Row) => void;     // hover cursor-pointer(Dashboard 行)
  selection?: {                        // 先頭チェックボックス列
    isSelected: (row: Row, index: number) => boolean;
    onToggle: (row: Row, index: number) => void;
    ariaLabel?: (row: Row) => string;
  };
  rowTestId?: string;                  // 例 "backup-row" / "explore-row"
}
export function DataTable<Row>(props: DataTableProps<Row>): JSX.Element;
```

- 挙動集約: loading/empty のセルスパン、sticky でない現行 thead スタイル、行 hover、チェックボックス選択(`TablesPage`/`ExplorePage` の `Set` トグル)。
- 置換対象: §1.2 の一覧/結果テーブル計 6 箇所。IndexCard(`TableDetailPage.tsx:83`)も `variant="results"` で表現可。
- 注意: セル内の `data-testid`(例 `explore-pk-link`, `table-link-*`)は `render` 内でこれまで通り付与する。

### 2.6 `<Modal>` — `src/components/ui/Modal.tsx`

```ts
interface ModalProps {
  title: React.ReactNode;
  onClose: () => void;
  maxWidth?: "md" | "lg" | "2xl";   // 既存 3 幅に対応
  children: React.ReactNode;         // 本文
  footer?: React.ReactNode;          // 通常 <ModalFooter>
}
export function Modal(props: ModalProps): JSX.Element; // backdrop+panel+stopPropagation を内包

interface ModalFooterProps {
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  confirmLabel: string;
  confirmingLabel?: string;      // 実行中(例 "作成中...")
  confirmVariant?: ButtonVariant; // 既定 primary
  confirmDisabled?: boolean;
  confirmTestId?: string;
  busy?: boolean;
}
export function ModalFooter(props: ModalFooterProps): JSX.Element;
```

置換対象: §1.3 の 6 モーダル。`CreateTableModal` / `ItemEditorModal` / `CreateBackupModal` / `RestoreBackupModal` / `DeleteTableModal` / `ConnectionsPage` 編集モーダルの外枠とフッターを内包(本文の入力群は各所固有のまま残す)。

### 2.7 `<ConfirmDangerModal>` — `src/components/ui/ConfirmDangerModal.tsx`

名前タイプ一致確認を 1 実装へ統一(`TablesPage` の `window.prompt` も置換=UX 統一)。

```ts
interface ConfirmDangerModalProps {
  title: string;
  description: React.ReactNode;
  requiredText: string;            // 一致必須の文字列(例 テーブル名)
  confirmLabel: string;            // 例 "削除"
  onConfirm: () => Promise<void>;  // 失敗時は内部でメッセージ表示
  onClose: () => void;
  inputTestId?: string;            // 例 "td-delete-input"
  confirmTestId?: string;          // 例 "td-delete-confirm"
}
export function ConfirmDangerModal(props: ConfirmDangerModalProps): JSX.Element;
```

置換対象: `TableDetailPage.tsx:27-81`(そのまま)、`TablesPage.tsx:123-134`(prompt から昇格)。

### 2.8 `<StatusBadge>` — `src/components/ui/StatusBadge.tsx`

```ts
interface StatusBadgeProps {
  status: string;         // "ACTIVE" | ... を受け、ACTIVE を "アクティブ" 緑表示
  testId?: string;
}
export function StatusBadge(props: StatusBadgeProps): JSX.Element;
```

置換対象: §1.5 バッジ 3 箇所。`接続OK` 表示(`ConnectionsPage.tsx:191`)は色/文言が別系なので**対象外**(YAGNI)。

### 2.9 `<KeyChip>` — `src/components/ui/KeyChip.tsx`

```ts
import type { KeyDef, KeyAttr } from "../../api/types";
interface KeyChipProps {
  keyDef?: Pick<KeyDef, "name" | "attrType"> | KeyAttr | null;
  testId?: string;
}
export function KeyChip(props: KeyChipProps): JSX.Element; // null は "-"
```

置換対象: §1.1 の 3 実装。

### 2.10 `<EmptyState>` — `src/components/ui/EmptyState.tsx`

```ts
interface EmptyStateProps {
  message: React.ReactNode;
  action?: React.ReactNode; // 例 Dashboard "最初のテーブルを作成" リンク
  testId?: string;
}
export function EmptyState(props: EmptyStateProps): JSX.Element;
```

置換対象: §1.5 空表示のうち Card 内配置のもの。単純テーブル 0 件は `DataTable.emptyText` で吸収するため二重に使わない。

### 2.11 `<SummaryCards>` — `src/components/ui/SummaryCards.tsx`

```ts
interface SummaryItem { label: string; value: string; testId?: string; }
interface SummaryCardsProps { items: SummaryItem[]; testId?: string; }
export function SummaryCards(props: SummaryCardsProps): JSX.Element;
```

置換対象: `DashboardPage.tsx:27,95`。将来の各サービスダッシュボードが再利用。

### 2.12 `<ConnectionRequired>` ガード

```ts
export function ConnectionRequired({ children }: { children: React.ReactNode }): JSX.Element;
// active が無ければ "接続が未登録です…/接続管理" を表示、あれば children
```

置換対象: §1.5 の 3 箇所を統一し、Explore/Partiql の不整合も解消。

### 2.13 `useProfileScopedFetch` フック — `src/lib/useProfileScopedFetch.ts`

```ts
import type { AppError, ConnectionProfile } from "../api/types";

interface ProfileScopedFetch<T> {
  data: T | null;
  error: AppError | null;
  loading: boolean;
  reload: () => Promise<void>;   // ErrorBanner onRetry に直結
  setData: React.Dispatch<React.SetStateAction<T | null>>;
}

export function useProfileScopedFetch<T>(
  fetcher: (profile: ConnectionProfile) => Promise<T>,
  deps?: React.DependencyList,   // 追加依存(例 tableName)
): ProfileScopedFetch<T>;
```

- 挙動集約: `active` 変化での再取得、`toAppError` 変換、ローディング、**古いレスポンス破棄**(cancel フラグ = バックログ「async-switch race guards」)、`reload` guard(「onRetry guard」)。
- 置換対象: §1.8 の 6 箇所の `load`/`useEffect` ペア。`ExplorePage` のような多段フェッチはコアのみ本フックへ、派生取得は個別実装のまま(過剰抽象を避ける)。

### 2.14 フォーマッタ集約 `src/lib/format.ts`

```ts
export function formatBytes(bytes: number | null | undefined): string; // 単一の正規実装
export function formatDate(iso: string | null | undefined): string;    // ja-JP, 不正値は原文
```

- 置換対象: §1.7 の 3 バイト実装を 1 本化(端数/上限の挙動は 1 つに統一、要オーナー確認)、`formatDate` を `BackupsPage` から移設。
- `explore.ts` の `columnsOf`/`cellText`/`typedValue`/`keyOf` は DynamoDB 固有ロジックのため `features/dynamodb/` に残す。`PartiqlPage` の独自 `columnsOf`/`cellText`(§1.2)は共有版へ寄せる(キー優先ロジック無しの差異は引数化)。

---

## 3. サービス拡張アーキテクチャ

現状ハードコード箇所: `Home.tsx:12`(SERVICES 配列), `SideNav.tsx`(DynamoDB 決め打ち), `Layout.tsx:20`(`buildCrumb` 決め打ち), `App.tsx:40-45`(ルート決め打ち)。これらを **1 つのサービスレジストリ**から駆動する。

### 3.1 `ServiceDefinition` — `src/services/types.ts`

```ts
import type { RouteObject } from "react-router-dom";

export interface ServiceNavItem {
  label: string;      // 例 "テーブル"
  path: string;       // 例 "/dynamodb/tables"
  testId: string;     // 例 "nav-tables"
  matchPrefix?: string; // active 判定用(既定は path)
  group?: number;     // SideNav の区切り線グループ(0,1,...)
}

export interface ServiceDefinition {
  id: string;                 // "dynamodb"
  name: string;               // "DynamoDB"
  description: string;        // "NoSQL データベース"
  icon: string;               // import した svg
  basePath: string;           // "/dynamodb"
  enabled: boolean;           // false = Home で "coming soon" グレー
  home: string;               // Home カードのリンク先(例 "/dynamodb/tables")
  nav: ServiceNavItem[];      // SideNav 項目(空なら SideNav 非表示)
  routes: RouteObject[];      // この service 配下のルート群
  crumbLabel?: (pathname: string) => string[] | null; // パンくず末端(任意)
}
```

### 3.2 レジストリ — `src/services/registry.ts`

```ts
import { dynamodbService } from "../features/dynamodb/service";
// 将来: import { sqsService } from "../features/sqs/service";

export const SERVICES: ServiceDefinition[] = [
  dynamodbService,
  // sqsService,
];

export const serviceForPath = (pathname: string): ServiceDefinition | undefined =>
  SERVICES.find((s) => pathname.startsWith(s.basePath));
```

各サービスは自分の定義を `src/features/<service>/service.ts`(または `service.tsx`)で **自己申告**する。DynamoDB の場合、既存ページ import + nav 5 項目 + routes 5 本 + `crumbLabel` を束ねるだけ。

### 3.3 共通基盤の書き換え(この設計で 1 度だけ触る)

- **`Home.tsx`**: `SERVICES` を `registry` から map。`enabled` で有効/`coming soon` を分岐(現行の `to?` 判定を置換)。アイコン/説明もレジストリ由来。
- **`SideNav.tsx`**: `serviceForPath(pathname)` で現在サービスを解決し、`service.name` 見出し + `service.nav` を描画、`group` で区切り線。DynamoDB 固有記述を除去。
- **`Layout.tsx`**: `showSidebar = !!serviceForPath(pathname)?.nav.length`。`buildCrumb` は `service.name` + `service.crumbLabel(pathname)` から生成(接続管理など非サービスパスは別途小さな固定表)。
- **`App.tsx`**: `SERVICES.flatMap(s => s.routes)` を `<Route element={<Layout/>}>` 配下へ展開。トップ(`/`, `/connections`, `*`)のみ固定のまま。

これ以降、サービス追加で上記 4 ファイルは**編集不要**。

### 3.4 API 層のサービス分割 — `src/api/`

- 現行 `api.ddb.*`(`client.ts:31-58`)は維持しつつ、サービス別ファイルへ分離: `src/api/dynamodb.ts` が `dynamodb` オブジェクトを export、`client.ts` は `invoke`/`toAppError`/接続系のみ残し、`api = { ...connections, dynamodb }` を集約。型は `src/api/types.ts` にサービス別セクション(または `types/dynamodb.ts`)を追加。**wire 契約(`camelCase`)は Rust と両側同時変更**(AGENTS.md 準拠)。

### 3.5 Rust モジュール規約 — `src-tauri/src/commands/<service>.rs`

- **クライアント生成の一般化**: `connections.rs` に `make_sdk_config(profile: &ConnectionProfile) -> aws_config::SdkConfig`(creds/timeout/endpoint/region を 1 箇所で構築)を追加し、`make_client`(DDB)と `probe` はこれを再利用(既知バックログ「config-builder dedup」も同時解消)。各サービスは `aws_sdk_sqs::Client::new(&cfg)` のように **自分の SDK クライアントを SdkConfig から生成**する。
- **モジュール配置**: 既存 `ddb.rs` を `commands/dynamodb.rs` へ寄せる規約(段階移行可)。新サービスは `commands/sqs.rs` を追加し `commands/mod.rs` で `pub mod sqs;`。
- **エラー契約**: `AppError`(`error.rs`)は全サービス共通で不変。ただし `map_sdk_err` の型境界は現状 `aws_sdk_dynamodb::error::ProvideErrorMetadata`(`error.rs:29`)に依存 → **`aws_smithy_types::error::metadata::ProvideErrorMetadata` へ緩める**ことで SQS/SNS などの SDK エラーにも再利用可能にする(挙動不変・境界のみ変更)。サービス固有のコード分類が必要なら、共通 `map_sdk_err` を土台にサービス側で薄くラップする。
- **コマンド登録**: `lib.rs:39` の `generate_handler!` に新サービスのコマンドを追記(ここは追記が必要=避けられない)。薄いラッパ(§1.9)は各サービス内で同型に保つ。

### 3.6 「SQS を追加するには」チェックリスト(設計の検証)

**追加するファイル:**
1. `src-tauri/src/commands/sqs.rs` — `make_sdk_config` から `aws_sdk_sqs::Client` を生成するコア関数群 + `#[tauri::command] sqs_*` ラッパ。
2. `src-tauri/src/commands/mod.rs` に `pub mod sqs;`(初回のみ mod.rs 新設)。
3. `src/api/sqs.ts` — `invoke` ラッパ(`api.sqs.*`)。
4. `src/api/types.ts`(または `types/sqs.ts`)に wire 型追加。
5. `src/features/sqs/*.tsx` — ページ群(§2 の共通コンポーネントを使用)。
6. `src/features/sqs/service.ts` — `ServiceDefinition` を export。
7. `src/assets/aws/icon-sqs.svg` — **既に存在**(`Home.tsx:5` が import 済み)。

**編集する共通ファイル(最小):**
- `src/services/registry.ts` に `sqsService` を 1 行追加。
- `src-tauri/src/lib.rs` の `generate_handler!` に `sqs_*` を追記。
- `src/api/client.ts` の `api` 集約に `sqs` を 1 行追加。
- E2E: `e2e/SPEC-COVERAGE.md` と spec を同時更新(プロジェクト規約)。

**編集不要であるべきファイル(設計が正しければ触らない):**
- `Home.tsx` / `SideNav.tsx` / `Layout.tsx` / `App.tsx`
- `src/components/ui/*`(共通プリミティブ)
- `src-tauri/src/error.rs` / `connections.rs`(§3.5 の一般化を先に済ませていれば不変)

---

## 4. 移行計画の概略(低リスク順)

各フェーズは独立にマージ可能で、各フェーズ後に全チェック(`tsc` + `vitest` + `cargo fmt/clippy/test`)と E2E が green を維持する。`data-testid` は全フェーズで不変。

- **Phase 0(下ごしらえ / ゼロ挙動変化)**: `tokens.ts`・`src/lib/format.ts` を新設し、既存のスタイル定数/フォーマッタを **中身そのまま** import へ置換。`formatBytes` は 3 実装を 1 本化する前に、まず正規実装をどれに合わせるかオーナー確認(§5)。純粋関数中心でテスト影響最小。
- **Phase 1(視覚に安全なプリミティブ)**: `<Button>` `<KeyChip>` `<StatusBadge>` `<Card>` `<PageHeader>` を導入し、1 ページずつ差し替え。DOM 構造/testid を保つスナップショット・既存 vitest で担保。**最初の抽出候補=`<Button>`(occ. 最多・低リスク)と スタイルトークン(既知バックログ直撃)**。
- **Phase 2(構造コンポーネント)**: `<DataTable>` `<Modal>`/`<ModalFooter>` `<ConfirmDangerModal>` `<EmptyState>` `<ConnectionRequired>` `<SummaryCards>`。テーブル/モーダルは testid をレンダラ経由で厳密に維持。`window.prompt` → `ConfirmDangerModal` 昇格時は E2E の削除フローを実機確認。
- **Phase 3(フック)**: `useProfileScopedFetch` を単純ページ(Tables/Dashboard/Partiql/Backups)から順に適用し、race guard/onRetry guard バックログを回収。Explore は最後(多段フェッチのため慎重に)。
- **Phase 4(サービスレジストリ)**: `ServiceDefinition` 型と `registry.ts` を追加、`features/dynamodb/service.ts` を新設し、`Home`/`SideNav`/`Layout`/`App` をレジストリ駆動へ移行。ルーティング挙動は不変(パス・testid 同一)。
- **Phase 5(API/Rust 分割)**: `src/api/dynamodb.ts` 分離、`make_sdk_config` 抽出 + `map_sdk_err` 型境界緩和、`ddb.rs`→`commands/dynamodb.rs` 移設。wire 契約は両側同時。ここまでで「SQS 追加=新規ファイル+レジストリ 1 行」が成立。

E2E 維持の要点: (1) testid 不変、(2) 各フェーズ後に `scripts/emulator.sh` + `npm run e2e` を実行、(3) `e2e/SPEC-COVERAGE.md` は挙動不変フェーズでは変更不要、サービス追加フェーズでのみ更新。

---

## 5. やらないこと(非目標)

- **視覚リデザイン/ダークテーマ非対応**: 色・余白・フォントは現行のまま(AGENTS.md「Light theme only」)。抽出は実装統合のみ。
- **testid・ルーティング・wire 契約の意味変更**: 名前・パス・camelCase キーは一切変えない。
- **`接続OK` バッジの `StatusBadge` 統合**: 色/文言が別系統(接続プローブ)で occ.1、共通化利益が薄い → 見送り。
- **`ErrorBanner` の全面ラッパ化(例 `<AsyncBoundary>` で loading/error/empty を一括制御)**: 各ページの loading/empty 配置が微妙に異なり(Card 内/テーブル内/バナー)、単一境界に押し込むと分岐が増え可読性が下がるため見送り。`useProfileScopedFetch` + 個別描画に留める。
- **汎用フォームビルダ**: `CreateTableModal` の GSI 動的行や `ConnectionsPage` の `field()` を汎用フォーム DSL 化しない(各 1 箇所・要件差が大きく過抽象)。共通化は `<Modal>` の外枠と入力プリミティブ止まり。
- **Rust コマンドのマクロ生成**: 13 個の薄いラッパ(§1.9)を宣言的マクロで畳む案は、可読性・`generate_handler!` との整合・デバッグ容易性を優先して見送り(手書き同型を維持)。
- **状態管理ライブラリ導入**(Redux/Zustand 等): 現状の Context + local state で十分。サービス追加も per-feature state で対応でき、導入しない。
- **確定事項(2026-07-14 オーナー承認: 推奨案で実装)**:
  1. `formatBytes` は log ベース(`explore.ts` 版)を正規実装とし、単位は B〜TB、`null`/`undefined` は `"-"` を返す。
  2. `TablesPage` の `window.prompt` 削除確認は `ConfirmDangerModal` へ統一する(UX 統一)。E2E は要件 R6 のままテスト実装のみ更新する。
  3. サービスレジストリ導入(Phase 4〜5)は共通コンポーネント化(Phase 0〜3)と別 PR に分割する。
