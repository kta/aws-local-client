# neo-localstack-desktop

ローカル AWS エミュレータ(LocalStack / floci / ministack / dynamodb-local など)向けの
AWS コンソール風デスクトップクライアント。Phase 1 は DynamoDB に対応。

接続先はエンドポイント URL で指定するため、DynamoDB 互換のローカルエミュレータであれば
LocalStack・floci・ministack・amazon/dynamodb-local のいずれでも同じように利用できる。

## 機能

- 複数エミュレータの接続プロファイル管理(手動登録 + localhost ポートスキャンによる自動検出)
- テーブル一覧・スキーマ表示(PK/SK・GSI/LSI)
- アイテムの Scan / Query(フィルタ・ページネーション)
- アイテムの作成・編集・削除(通常 JSON ⇔ DynamoDB JSON 切替エディタ)
- テーブルの作成(PK/SK/GSI)・削除

## 画面構成

- **接続管理**(`/connections`、初期画面): 接続プロファイルの一覧・追加・編集・削除。
  localhost の自動検出、および各プロファイルの「この接続を使う」でアクティブ接続を切り替える。
- **ホーム**(`/`): AWS サービスのグリッド。DynamoDB を選択して各機能へ遷移する。
- **DynamoDB**(`/dynamodb`): サイドバー付き。「テーブル」「項目を探索」から各画面へアクセスする。
- **テーブル詳細**(`/dynamodb/tables/:tableName`): 「概要」「インデックス」タブでスキーマや GSI/LSI を確認する。
- **項目を探索**(`/dynamodb/explore`): クエリ / スキャンの実行、アイテムの作成・編集・削除、
  ページネーションを行う。

UI は承認済みモック(`docs/design/ui-mock.html`)に準拠している。

## 開発

```bash
npm install
npm run tauri dev
```

## テスト

```bash
npx tsc --noEmit               # 型チェック
npx vitest run                 # フロント単体テスト
cd src-tauri && cargo test     # Rust 単体テスト

# DynamoDB 統合テスト(要 Docker)
docker run -d --name ddb-local -p 8000:8000 amazon/dynamodb-local
cd src-tauri && cargo test -- --ignored

# 別のエミュレータ(例: LocalStack)に対して実行する場合は
# DDB_ENDPOINT でエンドポイントを上書きする
docker run -d --name localstack -p 4566:4566 localstack/localstack:3
cd src-tauri && DDB_ENDPOINT=http://localhost:4566 cargo test -- --ignored
```

統合テストの接続先は環境変数 `DDB_ENDPOINT`(既定: `http://localhost:8000`)で切り替えられる。
