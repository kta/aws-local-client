# neo-localstack-desktop — Phase 1: DynamoDB クライアント設計

日付: 2026-07-13
ステータス: 承認済み

## 背景・目的

LocalStack Desktop の有料化に伴い、ローカル AWS エミュレータ用の GUI クライアントを自作する。
AWS コンソールのような使用感(サービスロゴのグリッドから遷移)で、複数のエミュレータ
(LocalStack / floci / ministack / dynamodb-local など)を切り替えて使えるデスクトップアプリ。

Phase 1 では **DynamoDB クライアントとして一気通貫**で動くものを作る。

## スコープ(Phase 1)

必須機能:

1. 接続プロファイル管理(手動登録 + localhost ポートスキャンによる自動検出)
2. テーブル一覧・スキーマ表示(PK/SK、GSI/LSI、アイテム数などのメタ情報)
3. アイテムの Scan / Query 閲覧(フィルタ・ページネーション付き)
4. アイテムの作成・編集・削除(JSON エディタ)
5. テーブルの作成(PK/SK/GSI 定義)・削除

スコープ外(将来): SQS / SNS / S3 / EC2 / EKS 等の他サービス、実 AWS アカウントへの接続、
エミュレータ自体の起動・停止管理。

## 技術スタック

- **Tauri 2**(Rust バックエンド + WebView)
- フロントエンド: **React + TypeScript + Tailwind CSS**(ビルドは Vite)、ルーティングは React Router
- AWS API 呼び出し: **Rust 側で `aws-sdk-dynamodb`**。フロントは Tauri コマンドを `invoke()` するのみ
  - 理由: WebView からの直接 fetch はエミュレータ側の CORS 対応に依存するため。Rust 側で呼べば
    どのエミュレータでも確実に動く
- 接続プロファイル永続化: `tauri-plugin-store`(アプリ設定ディレクトリの JSON)

## アーキテクチャ

```
React UI (features/dynamodb/, features/connections/)
  │ invoke('dynamodb_list_tables', { connectionId, ... })
  ▼
Tauri (Rust)  src-tauri/src/commands/dynamodb.rs
  │ aws-sdk-dynamodb (endpoint_url = プロファイルのURL)
  ▼
エミュレータ (localhost:4566 / :8000 / 任意URL)
```

### モジュール分割(サービス追加を見越した構造)

- Rust: `commands/<service>.rs` 単位。共通の接続解決(`ConnectionProfile` → SDK Config 生成)は
  `connections.rs` に集約
- フロント: `features/<service>/` 単位(routes / components / api ラッパー)。
  ホームのサービスグリッドは宣言的なサービス定義リストから生成し、サービス追加 =
  定義 1 件 + feature モジュール 1 つの追加で済むようにする

### データモデル

```ts
type ConnectionProfile = {
  id: string;          // uuid
  name: string;        // 表示名 (例: "localstack-main")
  endpointUrl: string; // 例: "http://localhost:4566"
  region: string;      // 既定: "ap-northeast-1"
  accessKeyId: string; // 既定: "dummy"
  secretAccessKey: string; // 既定: "dummy"
  color?: string;      // ヘッダー識別色(接続の取り違え防止)
};
```

エミュレータの「種類」は持たない。エンドポイント URL さえあれば何でも登録できる。

### 自動検出

接続管理画面の「スキャン」ボタンで、localhost の代表ポート(4566, 8000 ほか)へ
`ListTables` を短いタイムアウトで投げ、応答があったものを接続候補として提案する。
検出はあくまで候補提示であり、登録はユーザーが確定する。

## 画面構成(AWS コンソール風)

1. **ホーム**: サービスロゴのグリッド。DynamoDB のみ有効、他はグレーアウト(coming soon)。
   ヘッダーに接続セレクタ(プロファイル切替)とリージョン表示
2. **接続管理**: プロファイル一覧・追加・編集・削除、自動検出
3. **DynamoDB**:
   - テーブル一覧(名前・PK/SK・アイテム数)
   - テーブル詳細: 「概要」(スキーマ・GSI/LSI・キャパシティ)タブ /
     「項目の探索」(Scan/Query 切替、属性フィルタ、ページネーション)タブ
   - アイテム作成・編集(JSON エディタ、DynamoDB JSON ⇔ 通常 JSON 切替)・削除(確認付き)
   - テーブル作成ダイアログ(テーブル名、PK/SK の名前と型、GSI 定義)・テーブル削除(名前入力確認)

## エラーハンドリング

- Rust コマンドは `Result<T, AppError>` を返す。`AppError` は SDK エラーを
  「接続不可」「認証エラー」「リソースなし」「バリデーション」等に分類し、
  フロントで人間向けメッセージのバナー/トーストとして表示
- 接続不可はテーブル一覧画面で全面バナー + 再試行ボタン

## テスト方針

- TDD で進める(テスト先行)
- Rust: 接続解決・コマンド層は DynamoDB Local(Docker)に対する統合テスト
- フロント: Vitest + Testing Library(コンポーネント/フックの単体テスト)
- 完了報告前に `cargo clippy` / `cargo test` / `tsc --noEmit` / `vitest run` を必ずローカル実行

## 承認済みの意思決定

| 決定 | 選択 | 理由 |
|---|---|---|
| アプリ形態 | Tauri デスクトップアプリ | 軽量・高速起動・macOS ネイティブ感 |
| フロント | React + TS + Tailwind | エコシステム最大、コンソール風 UI 部品が豊富 |
| API 呼び出し | Rust 側 aws-sdk-rust | CORS 非依存でどのエミュレータでも確実に動作 |
| 接続管理 | 手動登録 + 自動検出の併用 | 柔軟性と手軽さの両立 |
