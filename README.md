# neo-localstack-desktop

[![CI](https://github.com/kta/aws-local-client/actions/workflows/ci.yml/badge.svg)](https://github.com/kta/aws-local-client/actions/workflows/ci.yml)
[![E2E](https://github.com/kta/aws-local-client/actions/workflows/e2e.yml/badge.svg)](https://github.com/kta/aws-local-client/actions/workflows/e2e.yml)
[![Build](https://github.com/kta/aws-local-client/actions/workflows/build.yml/badge.svg)](https://github.com/kta/aws-local-client/actions/workflows/build.yml)

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

## ツールチェーン

- フロントエンド: TypeScript 7(Go ネイティブ)/ Vite 8 / React 19 / Tailwind 4、バックエンド: Tauri 2.11(Rust)+ aws-sdk-dynamodb。
- 依存は latest 追従を方針とし、npm は `npm outdated`、Rust は `cargo update` + `cargo tree -d` で定期的に最新化する。
- MSRV は固定せず(ローカル Rust 1.96 / CI stable で両立)、更新時は全チェック(型・lint・テスト)を green にしてから確定する。

## 開発

```bash
npm install
npm run tauri dev
```

## テスト

### 単体テスト・型チェック

```bash
npx tsc --noEmit               # フロント型チェック
npx vitest run                 # フロント単体テスト
npm run e2e:typecheck          # E2E コード(e2e/)の型チェック
cd src-tauri && cargo test     # Rust 単体テスト
```

### Rust 統合テスト(要 Docker)

```bash
docker run -d --name ddb-local -p 8000:8000 amazon/dynamodb-local
cd src-tauri && cargo test -- --ignored

# 別のエミュレータ(例: LocalStack)に対して実行する場合は
# DDB_ENDPOINT でエンドポイントを上書きする
docker run -d --name localstack -p 4566:4566 localstack/localstack:3
cd src-tauri && DDB_ENDPOINT=http://localhost:4566 cargo test -- --ignored
```

統合テストの接続先は環境変数 `DDB_ENDPOINT`(既定: `http://localhost:8000`)で切り替えられる。

### E2E テスト(実バイナリ + 実エミュレータ)

E2E は実アプリのデバッグビルドを WebdriverIO の Tauri 埋め込みドライバで起動し、実際のエミュレータに
対して UI を操作する。テスト対象のエミュレータは環境変数 `E2E_ENDPOINT`(既定 `http://localhost:4566`)で
切り替え、同一スイートを LocalStack / floci / ministack の 3 種に対して実行する。

エミュレータのライフサイクルは `scripts/emulator.sh` が管理する。`EMU_PORT` を指定すると、開発者自身が
すでに 4566 を使っている場合でも別ポートで並走できる(コンテナ内部は常に 4566 を待ち受け、ホスト側の
公開ポートだけが変わる)。

```bash
# 1) デバッグビルド(実バイナリ生成。frontend dist も含めてビルドされる)
npm run e2e:build

# 2) エミュレータを起動して ready を待つ(例: 4567 番で LocalStack)
EMU_PORT=4567 scripts/emulator.sh start localstack
EMU_PORT=4567 scripts/emulator.sh wait  localstack

# 3) 対象エンドポイントを指定して E2E を実行
E2E_ENDPOINT=http://localhost:4567 npm run e2e

# 4) 後片付け
EMU_PORT=4567 scripts/emulator.sh stop localstack
```

`start` / `wait` / `stop` に渡すエミュレータ名と起動方式は以下のとおり。docker 版はコンテナ、
`ministack-pip` は PyPI からインストールしてバックグラウンドプロセスとして起動する
(Linux コンテナが使えない macOS / Windows CI 用)。

| エミュレータ名 | 起動方式 | 使用イメージ / パッケージ |
| --- | --- | --- |
| `localstack` | docker | `localstack/localstack:3` |
| `floci` | docker | `floci/floci:latest` |
| `ministack` | docker | `ministackorg/ministack` |
| `ministack-pip` | pip(mac/win CI 用) | PyPI `ministack` |

E2E は仕様要件 **R1〜R50 を 100% カバー**する。要件 ID と検証テストの対応(トレーサビリティ)は
[`e2e/SPEC-COVERAGE.md`](e2e/SPEC-COVERAGE.md) にまとめており、全 50 行に最低 1 テストが対応している。
仕様を変更した場合はこの表も同じ変更で更新する。

## CI(GitHub Actions)

ワークフローは 3 本に分かれている。

- **`ci.yml`(CI)**: PR および main / develop への push で発火するユニットチェック。
  ubuntu 上で `tsc --noEmit` / `vitest run` / `npm run build`(フロント)と、
  `cargo fmt --check` / `cargo clippy -- -D warnings` / `cargo test` / `cargo test -- --ignored`
  (Rust、dynamodb-local サービスコンテナに対する統合テスト)を実行する。
- **`e2e.yml`(E2E)**: main / develop への push と手動実行(`workflow_dispatch`)で発火。
   - `e2e-linux`: ubuntu 上で `localstack` / `floci` / `ministack` の 3 エミュレータをマトリクスで起動し、
    `xvfb-run` で全スイートを実行(エミュレータ互換性の検証。ネットワークプロトコルの話なので OS 非依存)。
  - `e2e-macos` / `e2e-windows`: pip 版 ministack を起動し、同一スイートを実行(OS 互換性の検証)。
  - いずれも `npm run e2e:build` で実バイナリを生成してから実行する。
- **`build.yml`(Build)**: main / develop への push と手動実行で発火。
  - `desktop`: `tauri-apps/tauri-action` で macOS(`--target universal-apple-darwin`、universal)と Windows の
    **未署名**バンドルをビルドし、artifact としてアップロードする。
  - `web`: `npm run build`(Web dist)を artifact 化し、モックバックエンド(`@tauri-apps/api/mocks`)を用いた
    描画 smoke テストを実行する。

### Web ビルドの「動作確認」の定義

Web ビルドは Tauri バックエンドを持たないため実 API を呼び出せない。よって Web の「動作確認」は
**`vite build` の成功 + `@tauri-apps/api/mocks` を用いたモックバックエンドでの描画 smoke** と定義する。
実 API(実エミュレータへの接続)の検証は Tauri デスクトップアプリ上の E2E でのみ行う。
