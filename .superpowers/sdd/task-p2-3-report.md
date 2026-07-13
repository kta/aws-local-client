# Task P2-3 レポート: E2E 基盤スパイク(WebdriverIO embedded + 最初の 1 本)

## 結論

**成功(GREEN)**。WebdriverIO の Tauri 埋め込み WebDriver(`driverProvider: 'embedded'`)が macOS
(darwin, Apple Silicon)でネイティブに動作することを実機で確認。smoke テスト 3/3 pass。
BLOCKED ではない。フォールバック(tauri-driver / Playwright モック)への切替は不要。

## 使用パッケージ / バージョン(2026-07-13 時点)

### npm(devDependencies)
- `@wdio/cli` `^9.29.1`
- `@wdio/local-runner` `^9.29.1`
- `@wdio/mocha-framework` `^9.29.1`
- `@wdio/spec-reporter` `^9.29.1`
- `@wdio/tauri-service` `^1.2.0`  ← Tauri サービス(embedded provider を含む)
- `@wdio/tauri-plugin` `^1.2.0`  ← フロントエンド側プラグイン(自動化ブリッジ)
- `tsx` `^4.23.1`  ← wdio.conf.ts の TS 実行
- `@aws-sdk/client-dynamodb` `^3.x`  ← P2-4 のシード用に先行導入
- `@types/node` `^26.x`

### npm overrides(重要)
```json
"overrides": { "@wdio/native-utils": "2.5.0" }
```
`@wdio/tauri-service@1.2.0` は依存を `@wdio/native-utils@2.4.0` に固定しているが、
その JS は 2.5.0 で追加された `installMockSyncOverride` を import しており、
2.4.0 のままだと `SyntaxError: does not provide an export named 'installMockSyncOverride'`
でサービス初期化に失敗する。2.5.0 にピン留めして解消(上流のパッケージング不整合)。

### Rust crate(src-tauri/Cargo.toml)
- `tauri-plugin-wdio` `= "1"`(実際は 1.2.0 解決)— WDIO コマンドサーフェス
- `tauri-plugin-wdio-webdriver` `= "1"`(1.2.0)— **埋め込み W3C WebDriver HTTP サーバ**
  (これが macOS で外部 tauri-driver / CrabNebula 不要を実現する本体)

## 埋め込みドライバの仕組み

1. `@wdio/tauri-service`(launcher)がアプリバイナリを `TAURI_WEBDRIVER_PORT`(既定 4445)付きで spawn。
2. アプリ内の `tauri-plugin-wdio-webdriver` がそのポートで W3C WebDriver HTTP サーバを起動。
3. WebdriverIO はそのポートへ直接接続(`browserName: "tauri"` → 実体は WKWebView / `webkit`)。
4. フロントの `@wdio/tauri-plugin` が自動化ブリッジ(window.wdioTauri、invoke 傍受)を登録し、
   WebDriver が **アプリ本体の webview** に attach できるようにする。これを import しないと
   自動化コンテキストが `about:blank` のままになり要素が取れない(下記「ハマりどころ」参照)。

生成バイナリ: `npm run tauri build -- --debug --no-bundle` → `src-tauri/target/debug/app`
(Cargo パッケージ名が `app` のため)。wdio.conf は候補パスから存在するものを自動解決。

## 実装ファイル

- `e2e/wdio.conf.ts` — embedded provider 設定 / バイナリ自動解決 / reset フック / Node26 対策(後述)
- `e2e/specs/smoke.e2e.ts` — smoke 3 ケース
- `e2e/tsconfig.json` — E2E 用型設定(`npm run e2e:typecheck`)
- `scripts/emulator.sh` — start|stop|wait × {localstack, floci, ministack(docker), ministack-pip}
- package.json scripts: `e2e`, `e2e:build`(`VITE_E2E=1 tauri build --debug --no-bundle`), `e2e:typecheck`

### Rust 側(src-tauri)
- `Cargo.toml`: wdio 2 crate 追加
- `src/lib.rs`: **`TAURI_WEBDRIVER_PORT` が設定されている debug 起動時のみ** wdio プラグインを登録。
  さらにその時は `tauri-plugin-log` の登録をスキップ(両者ともグローバル logger を張るため、
  併存すると `attempted to set a logger after the logging system was already initialized` で panic)。
  通常の `tauri dev` は従来どおり `tauri-plugin-log` を使用(非 E2E 動作を壊さないことを実機確認済み)。
- `capabilities/default.json`: `wdio:default`, `wdio-webdriver:default` を追加
- `tauri.conf.json`: `app.withGlobalTauri: true` を追加

### フロントエンド(E2E 専用の分岐)
- `src/main.tsx`: `import.meta.env.VITE_E2E` が真のときだけ `@wdio/tauri-plugin` を動的 import
  してから React を mount(bootstrap 関数、TLA 回避)。通常/本番ビルドには含まれない。
- `src/vite-env.d.ts`: `VITE_E2E` の型宣言

## smoke テスト結果

```
smoke: e2e foundation
  ✓ (a) launches with the 接続管理 screen visible
  ✓ (b) registers a connection via the UI and shows the new row
  ✓ (c) switches to the connection and renders the DynamoDB table list
3 passing
Spec Files: 1 passed, 1 total
```
`E2E_ENDPOINT=http://localhost:8000`(ホストの dynamodb-local)で実行。テーブル 0 件表示まで到達
(`(N)` カウント要素が `^\(\d+\)$` にマッチすることで一覧描画完了を検証)。

## リセット機構(各 run をクリーンに)

- **採用**: wdio `onPrepare` フックで app-config の `connections.json` を削除。
  macOS: `~/Library/Application Support/jp.dev.neolocalstack.desktop/connections.json`
  (win/linux のパスも wdio.conf 内に実装済み)。
- localStorage(`nlsd.activeConnectionId`)は**明示クリア不要**。アプリの `active` は
  「読み込んだ profiles から導出」される設計(state/connections.tsx)のため、profiles が空なら
  active は必ず null になり、起動時は必ず 接続管理 画面に留まる。→ ファイル削除だけで clean start を担保。
  実際に 2 回連続実行して (a) が毎回 接続管理 を検出することで確認済み。

## data-testid 追加(最小限)

安定セレクタとして以下を追加(いずれも表示文言・挙動は不変):
- `src/pages/ConnectionsPage.tsx`: `connections-heading`, `add-connection`, `connection-row`,
  `use-connection`, `save-connection`, フォーム入力に `conn-name` / `conn-endpoint`
  (`field` ヘルパに任意の testId 引数を追加)
- `src/features/dynamodb/TablesPage.tsx`: `tables-heading`, `tables-count`
- `src/pages/Home.tsx`: `home-heading`, `service-<id>`(DynamoDB カード = `service-dynamodb`)

## emulator.sh 検証

- bash 構文チェック OK。
- `wait`: ホストで稼働中の localstack(4566)を ListTables で検出し `ready` を返すことを確認(ヘルスチェック動作確認)。
- `stop`: 自作コンテナ `nlsd-emu-floci` の削除・冪等性・usage エラー(exit 2)を確認。
- **制約**: ホストで既にユーザーの `localstack` コンテナが 4566 を占有していたため、docker `start`
  の実バインドはユーザー資産を止めないよう実施せず(port already allocated を確認するに留めた)。
  `start` のコマンド構成自体は正しい(`docker run -d --name nlsd-emu-<name> -p 4566:4566 <image>`)。
  `ministack-pip` は `pip install ministack` → `python3 -m ministack` で 4566 起動(CI mac/win 用、ローカル未実行)。

## ハマりどころ(重要な発見)

1. **native-utils バージョン不整合**(上記 overrides で解決)。
2. **logger 二重初期化 panic**: wdio プラグインと tauri-plugin-log が競合。
   → `TAURI_WEBDRIVER_PORT` 有無で排他登録。
3. **`about:blank` 問題**: フロントの `@wdio/tauri-plugin` を import しないと自動化コンテキストが
   アプリ本体 webview に attach されず空白ページになる。→ E2E ビルド時のみ import(VITE_E2E)。
4. **Node 26 + undici の `UND_ERR_INVALID_ARG`**: 本環境は Node v26.5.0。WebdriverIO の
   HTTP 層が手動で `Content-Length` ヘッダを設定するが、Node26 の組込 undici が
   "invalid content-length header" として拒否 → セッション作成不能。
   → wdio.conf の `transformRequest` で `Content-Length` を削除(undici に再計算させる)。
   これは埋め込みドライバ本体の問題ではなく Node/undici の互換問題。恒久的には
   Node 22/24 LTS の使用が望ましい(CI では LTS 固定推奨)。

## 全チェック結果(green)

- `tsc --noEmit`(root): OK
- `npm run e2e:typecheck`: OK
- `vitest run`: 18 passed
- `cargo fmt --check`: OK
- `cargo clippy --all-targets -- -D warnings`: OK(warning なし)
- `cargo test`: 17 unit + doctest OK
- `cargo test -- --ignored`(DDB_ENDPOINT=http://localhost:8000): integration 2 passed
- 通常起動(env なし)で panic しないこと: 確認済み

## 懸念 / 申し送り

- **Node バージョン**: v26.5.0 は WDIO 9 の想定より新しく undici 互換問題を誘発。`transformRequest`
  で回避済みだが、CI/他メンバー環境では Node 22 or 24 LTS を推奨(.nvmrc / CI setup-node で固定)。
- **overrides の追従**: `@wdio/tauri-service` が native-utils 依存を修正したら override を撤去可。
- **本番ビルドへの wdio 混入回避**: Rust 側はランタイム env、フロントは VITE_E2E で分岐済み。ただし
  `capabilities/default.json` の `wdio*` permission と Cargo の wdio crate は release にもリンクされる
  (登録は debug+env 時のみ)。バイナリサイズ/表面積を厳密に絞るなら Cargo feature 化を将来検討。
- **P2-4 への布石**: `browser.tauri.execute` / `browser.tauri.mock` はフロントプラグイン import 済みなので
  そのまま使用可能。R13(到達不能エンドポイント)や R9(51 件シード)は `@aws-sdk/client-dynamodb`
  (導入済み)で helpers から直接投入する想定。
