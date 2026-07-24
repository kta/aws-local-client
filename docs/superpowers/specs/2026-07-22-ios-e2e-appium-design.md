# iOS 対応 + Appium/XCUITest による iOS E2E 設計

- 日付: 2026-07-22
- ステータス: 承認済み(実装済み)
- 関連: `2026-07-22-kumo-emulator-capability-gates-design.md`(同一 PR)

## 背景

E2E ワークフローは push(main/develop)と手動実行のみで PR では動いていなかった。
また iOS ターゲットが存在せず、iOS 上での動作検証手段がなかった。要件:

1. PR 作成時に E2E(デスクトップ + iOS)が CI で実行されること
2. 既存のスペックトレーサブルな E2E スイート(R1〜R50)を iOS でも実行すること

## 設計

### 1. PR トリガ(`.github/workflows/e2e.yml`)

`pull_request` トリガと per-ref concurrency(新 push で旧ランをキャンセル)を追加。
デスクトップ E2E(Linux 4 エミュレータ / macOS / Windows)が PR で回る。

### 2. iOS ターゲット(`src-tauri/gen/apple`、コミット対象)

- `tauri ios init` で Xcode プロジェクトを生成(`gen/apple/build` 等は .gitignore 済み)。
- **wdio プラグインはデスクトップ限定に変更**: 公開版 tauri-plugin-wdio(-webdriver) は
  `ios_path("ios")` を宣言しながら iOS ソースを同梱しておらず(upstream リポジトリにも
  存在しない)、モバイルビルドがコンパイル不能。
  - `Cargo.toml`: `[target.'cfg(not(any(target_os = "ios", target_os = "android")))'.dependencies]` へ移動
  - `lib.rs`: プラグイン登録を同条件で cfg ゲート
  - `capabilities/`: `wdio:default` / `wdio-webdriver:default` を `platforms:
    ["macOS","windows","linux"]` の `wdio-desktop.json` に分離
- ビルドコマンド: `npm run e2e:ios:build`
  (`VITE_E2E=1 tauri ios build --debug --target aarch64-sim --config src-tauri/tauri.e2e.conf.json`)

### 2.5. iOS 上の AWS SDK ハング修正(`src-tauri/src/connections.rs`)

iOS シミュレータでは、すべての AWS SDK リクエストが無限ハングした(1.5s の
connect timeout すら発火しない)。アプリ内からプローブして切り分けた結果:
生 `reqwest` の GET はホストへ ~10ms で到達し、`tokio::time::sleep` も正常に
発火する一方、SDK 経路だけがハングした → ランタイムでもネットワークでもなく
**SDK のコネクタ**が原因。

根本原因は、SDK 既定の HTTPS コネクタが rustls クライアント構築時に
`rustls_native_certs::load_native_certs()` でプラットフォームの信頼ストアを
読み込み、この呼び出しが iOS シミュレータでハングすること。

修正: `make_sdk_config` で全 SDK クライアントに**プレーン HTTP クライアント**
(`aws_smithy_http_client::Builder::new().build_http()`)を注入する。信頼ストアを
一切触らないため iOS で即接続でき、ローカル AWS エミュレータは常に `http://` なので
デスクトップでも完全に正しい(修正後、シミュレータで SDK が ~12ms で接続することを
確認)。プロセス全体で共有し、多数のサービス別クライアント間でコネクションプールを
再利用する。

### 3. iOS E2E ハーネス(`e2e/wdio.ios.conf.ts`)

デスクトップの埋め込み WebDriver が使えないため、**Appium + XCUITest ドライバの
webview コンテキスト**で WKWebView を W3C セッションとして駆動する。スペックは
testid + `browser.execute` しか使わないため、**spec ファイルは 1 行も変えずに共用**できる。

- 依存はすべて npm devDependencies(appium / appium-xcuitest-driver /
  @wdio/appium-service)で hermetic。
- `appium:autoWebview: true` で最初から webview コンテキストに入る。
- デバイスは `IOS_DEVICE` で指定、既定は利用可能な iPad を優先(デスクトップ風 UI の
  ため広い画面が安全)、なければ iPhone。名前は UDID をアンカーに正規表現で解決
  (機種名自体に括弧を含むため)。
- シミュレータは `onPrepare` で `simctl bootstatus -b` により事前ブート、
  WebDriverAgent は事前ビルド(`appium driver run xcuitest build-wda`)する。
  どちらもセッション作成の HTTP タイムアウト(undici headers timeout ≒ 5 分)内に
  収めるための必須手順。
- **リセットは既定(アプリ再インストール)**: セッション毎にアプリコンテナが消え、
  接続プロファイルがゼロから始まる(デスクトップ側の connections.json 削除と等価)。
  `fullReset` はシミュレータ自体をシャットダウン+消去するため使わない(遅い上に
  ローカルでは開発者のシミュレータを巻き込む)。
- シミュレータはホストとネットワークスタックを共有するため、アプリ内の
  `localhost:<port>` はホストのエミュレータへそのまま届く。

### 4. CI(`e2e-ios` ジョブ)

macos-latest / pip 版 ministack(Docker 不可のため他の非 Linux ジョブと同じ)/
rustup target `aarch64-apple-ios-sim` / iOS E2E ビルド → WDA 事前ビルド → スイート実行。
失敗時は `e2e/logs-ios` とスクリーンショットをアーティファクトに保存。

## 検証

- ローカル(iPad Pro 13-inch (M5) シミュレータ、ministack)でフルスイート green を確認。
- capability ゲート(kumo 設計)により、iOS ジョブの分岐は接続先エミュレータ
  (CI では ministack)と同一プロファイルになる。
