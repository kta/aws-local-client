# Phase 2: E2E(仕様100%)+ マルチプラットフォーム CI + AGENTS.md + 依存最新化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** LocalStack / floci / ministack を実際に起動して仕様の全要件を検証する E2E スイートを整備し、GitHub Actions で macOS / Windows アプリビルド・Web ビルド・E2E を main / develop への push で回す。AGENTS.md / CLAUDE.md を ECC ベストプラクティスで整備し、依存を最新化する。

**Architecture:** E2E は WebdriverIO + Tauri embedded WebDriver(2026 年に macOS 対応が追加された `driverProvider: 'embedded'` 方式)で、実バイナリを起動して UI を操作する。エミュレータは環境変数 `E2E_ENDPOINT` で切り替え、同一スイートを 3 エミュレータに対して実行する。仕様要件は R1〜R14 の ID を振り、`e2e/SPEC-COVERAGE.md` のトレーサビリティ表で 100% を担保する。

**Tech Stack(確認済み最新、2026-07-13):** TypeScript 7.0.2(Go ネイティブ)/ Vite 8.1.4 / React 19.2.7 / Vitest 4.1.10 / Tailwind 4.3.2 / @tauri-apps 2.11.x / tauri crate 2.11.5 / aws-sdk-dynamodb 1.117.0 / WebdriverIO latest + tauri service(embedded)

## Global Constraints

- 応答・ドキュメントの日本語/コード識別子の英語、Conventional Commits は Phase 1 と同じ
- 全チェック green: `tsc --noEmit` / `vitest run` / `cargo fmt --check` / `cargo clippy -- -D warnings` / `cargo test`(+ `-- --ignored`)
- **E2E は仕様ベースでカバレッジ 100%**: `e2e/SPEC-COVERAGE.md` の要件表の全行に最低 1 テストが対応し、表に載らない仕様要件を残さない
- エミュレータのエンドポイントは E2E スイートに対し `E2E_ENDPOINT`(既定 `http://localhost:4566`)で注入
- LocalStack はトークン不要の community タグに固定(検証済み: `localstack/localstack:3`。4.4.0 が使えるなら 4.4.0 を優先し、CI で検証して決定)
- floci: `floci/floci:latest`(port 4566)、ministack: `ministackorg/ministack`(port 4566)
- ワークフロー分割: `ci.yml`(既存、PR 用ユニットチェック)/ `e2e.yml` / `build.yml`(後者 2 つは `push: [main, develop]` トリガー + `workflow_dispatch`)
- macOS ランナーと Windows ランナーでは Linux コンテナが動かないため、**エミュレータ互換性(3種)の検証は ubuntu で実施**し、**OS 互換性(mac/win)の検証は pip/ネイティブ起動できるエミュレータ 1 種**で同一スイートを実行する(判断根拠: エミュレータ互換性はネットワークプロトコルの話で OS 非依存)
- Web ビルドは Tauri バックエンドなしでは実 API を呼べないため、Web の「動作確認」= `vite build` 成功 + `@tauri-apps/api/mocks` を用いたモックバックエンドでの UI フロー smoke E2E(この定義を README に明記)

## 仕様要件 ID(E2E トレーサビリティの分母)

Phase 1 スペック + UI 改訂から抽出。E2E スイートはこの全 ID をカバーする:

- **R1** 接続プロファイルの手動登録(既定値: 4566/ap-northeast-1/dummy)・編集・削除
- **R2** 自動検出(スキャンボタン → 検出結果から追加)
- **R3** 接続切替(「この接続を使う」→ ホーム遷移、ヘッダーのセレクタ切替、接続色の反映)
- **R4** テーブル一覧(名前・ステータス・PK/SK・インデックス数の表示)
- **R5** テーブル作成(PK のみ / PK+SK / GSI 付き)
- **R6** テーブル削除(名前入力確認、一覧からの選択削除)
- **R7** Scan(フィルタなし / 属性フィルタ =・contains)
- **R8** Query(PK 指定、SK begins_with / =、GSI 指定)
- **R9** ページネーション(50件超で次へ/前へ、ページ番号)
- **R10** アイテム作成(通常 JSON エディタ)
- **R11** アイテム編集(通常 JSON ⇔ DynamoDB JSON トグル、保存)
- **R12** アイテム削除(PK リンク→編集モーダル経由ではなく、チェック選択→アクション→削除、確認付き)
- **R13** エラーハンドリング(到達不能エンドポイントで接続エラーバナー + 再試行)
- **R14** 初期画面が接続管理であること、プロファイル 0 件時に他画面へ行けないこと
- **R15** テーブル詳細: 概要タブ(PK/SK/容量モード/ステータス/項目数)・インデックスタブ(GSI/LSI)
- **R16** 「テーブルの項目を探索」ボタン → explore 画面へ ?table= 付き遷移

## File Structure

```
e2e/
├── wdio.conf.ts              # WebdriverIO 設定(embedded driver、E2E_ENDPOINT 注入)
├── SPEC-COVERAGE.md          # R1..R16 ⇄ テストのトレーサビリティ表(100%)
├── helpers/
│   ├── emulator.ts           # AWS SDK(js v3 or CLI)でのシード/クリーンアップ
│   └── app.ts                # 画面操作ヘルパ(接続登録、テーブル作成等の共通フロー)
└── specs/
    ├── connections.e2e.ts    # R1, R2, R3, R13, R14
    ├── tables.e2e.ts         # R4, R5, R6, R15, R16
    └── items.e2e.ts          # R7, R8, R9, R10, R11, R12
scripts/
└── emulator.sh               # start|stop|wait <localstack|floci|ministack> (docker) / <ministack-pip>
.github/workflows/
├── ci.yml                    # 既存(PR: unit)+ push main/develop
├── e2e.yml                   # push main/develop: ubuntu×3エミュレータ + macos/windows×1
└── build.yml                 # push main/develop: tauri-action (mac universal / windows) + web dist + web smoke
AGENTS.md                     # 正典(ECC 構成)
CLAUDE.md                     # @AGENTS.md + Claude 固有事項のみ
docs/superpowers/plans/2026-07-13-phase2-e2e-ci-docs.md  # 本計画
```

---

### Task P2-1: 依存最新化の確定(Rust 側 + 明文化)

**Files:** Modify: `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `README.md`

npm 側は確認済みで既に全て最新(TS 7.0.2 Go ネイティブ含む)。本タスクは:

- [ ] `cargo update` を実行し、`cargo tree -d`(重複)を確認。tauri 2.11.5 / aws-sdk-dynamodb 1.117.0 に更新されることを確認
- [ ] `rust-version = "1.96"` 等の MSRV は設定しない(ローカル 1.96.1 / CI stable 1.97 で両立)
- [ ] README に「ツールチェーン」節を追加: TS 7(Go ネイティブ)/ Vite 8 / React 19 / Tauri 2.11 と、更新方針(latest 追従)を 3 行で記載
- [ ] 全チェック green を確認(`tsc --noEmit && vitest run && cargo fmt --check && cargo clippy -- -D warnings && cargo test && cargo test -- --ignored`)
- [ ] Commit: `chore: update rust dependencies and document toolchain`

### Task P2-2: AGENTS.md + CLAUDE.md(ECC ベストプラクティス)

**Files:** Create: `AGENTS.md`, `CLAUDE.md`

- [ ] `AGENTS.md`(正典、150 行以下、ECC 構成): Project Overview / Setup & Commands(コピペ可能なコマンドブロック: install, dev, 全チェック, E2E, エミュレータ起動)/ Architecture(ディレクトリマップ 1 行ずつ: src/features・src/api は Rust コマンドの薄いラッパ、src-tauri/src/ddb.rs がコア等)/ Conventions(Conventional Commits、日本語 UI 文言・英語識別子、serde camelCase 契約、DynamoDB JSON ロスレス原則)/ Do & Don't(push は明示依頼時のみ、シークレットをコミットしない、テスト green 前に「完了」と言わない、ワイヤ契約を片側だけ変えない)/ Testing(unit / integration(DDB_ENDPOINT)/ E2E(E2E_ENDPOINT・SPEC-COVERAGE 100% 維持ルール: 仕様変更時は表も更新))
- [ ] `CLAUDE.md`: `@AGENTS.md` インポート + Claude Code 固有(3-5 行: 破壊的操作の事前確認、完了報告前の lint/typecheck/test 実行 — グローバル設定と重複しない範囲)
- [ ] Commit: `docs: add AGENTS.md and CLAUDE.md following best practices`

### Task P2-3: E2E 基盤スパイク(WebdriverIO embedded + 最初の 1 本)

**Files:** Create: `e2e/wdio.conf.ts`, `e2e/specs/smoke.e2e.ts`, `scripts/emulator.sh`; Modify: `package.json`(scripts: `e2e`, devDeps)

最リスクタスク。embedded WebDriver(`tauri-plugin-wdio-webdriver` / WebdriverIO tauri service `driverProvider: 'embedded'`)の実働を確認する:

- [ ] WebdriverIO + tauri service を導入し、`npm run tauri build -- --debug` したバイナリを起動して「接続管理画面が表示され、タイトル/見出しが取れる」smoke テストを macOS ローカルで green にする
- [ ] `scripts/emulator.sh start|stop|wait localstack|floci|ministack`(docker)と `ministack-pip`(pip 起動、mac/win CI 用)を実装。wait はヘルスチェック(`/_localstack/health` or `ListTables`)
- [ ] smoke テストで「エミュレータ登録 → テーブル 0 件表示」まで到達(E2E_ENDPOINT 注入の仕組み確立: アプリはユーザー操作で接続登録するため、E2E ヘルパが接続登録フローを UI 操作で実行する)
- [ ] **もし embedded driver が macOS で実用にならない場合**: 即 BLOCKED 報告(フォールバック判断はコントローラ: Linux/Windows は tauri-driver、macOS は `@tauri-apps/api/mocks` + Playwright のモック E2E に切替え、その旨を SPEC-COVERAGE と README に明記)
- [ ] Commit: `test: add e2e infrastructure with webdriverio embedded driver`

### Task P2-4: E2E 仕様 100% スイート + トレーサビリティ表

**Files:** Create: `e2e/specs/connections.e2e.ts`, `e2e/specs/tables.e2e.ts`, `e2e/specs/items.e2e.ts`, `e2e/helpers/{emulator,app}.ts`, `e2e/SPEC-COVERAGE.md`

- [ ] R1〜R16 の全要件をテスト化(上記 File Structure のマッピング)。各テストの describe/it 名に要件 ID を含める(例: `it("R5: creates table with GSI", ...)`)
- [ ] `SPEC-COVERAGE.md`: 表(要件 ID / 仕様文 / テストファイル#テスト名)。**全 16 行が埋まっていることが完了条件**
- [ ] R9 用データシード(51 件以上)等は `helpers/emulator.ts` で AWS SDK JS v3(devDependency)により直接投入(UI 経由で 51 件作らない)
- [ ] R13 は到達不能ポート(例 http://localhost:59999)のプロファイルで検証
- [ ] ローカルで 3 エミュレータ全てに対して green を確認: `E2E_EMULATOR=localstack|floci|ministack npm run e2e`(ministack の GSI/ページネーションはここで実証 — 失敗するなら該当エミュレータの制約として SPEC-COVERAGE に脚注し、コントローラへ報告)
- [ ] Commit: `test: add spec-complete e2e suite with traceability matrix`

### Task P2-5: GitHub Actions — e2e.yml + build.yml

**Files:** Create: `.github/workflows/e2e.yml`, `.github/workflows/build.yml`; Modify: `.github/workflows/ci.yml`(push: main, develop を追加)

- [ ] `e2e.yml`(on: push[main, develop], workflow_dispatch):
  - job `e2e-linux`: matrix emulator=[localstack, floci, ministack]、docker 起動 + `xvfb-run` で E2E 全スイート
  - job `e2e-macos`: ministack(pip)起動 + E2E 全スイート(macos-latest)
  - job `e2e-windows`: ministack(pip)起動 + E2E 全スイート(windows-latest、tauri-driver or embedded)
  - いずれも `npm run tauri build -- --debug` でバイナリ生成後に実行
- [ ] `build.yml`(on: push[main, develop], workflow_dispatch):
  - job `desktop`: `tauri-apps/tauri-action` matrix(macos-latest `--target universal-apple-darwin` / windows-latest)未署名ビルド、成果物を actions artifact にアップロード
  - job `web`: `npm run build` + dist を artifact 化 + `@tauri-apps/api/mocks` を使った描画 smoke(vitest ベースで可: 接続管理画面がレンダリングされること)
- [ ] LocalStack タグは 4.4.0 → 失敗時 :3 の順で試し、動いた方に固定(コミットに理由を記載)
- [ ] Commit: `ci: add e2e and multi-platform build workflows for main and develop`

### Task P2-6: develop ブランチ整備 + README 更新 + 最終検証

- [ ] `develop` ブランチを main から作成して push
- [ ] README: E2E の実行方法(ローカル 3 エミュレータ)、CI バッジ、Web ビルドの「動作確認」の定義、プラットフォーム×エミュレータのマトリクス表を追記
- [ ] 全チェック + E2E(ローカル、3 エミュレータ)を一括再実行して green を確認
- [ ] Commit: `docs: update readme with e2e and ci matrix`

## 実行フロー

Phase 2 は `feature/phase2-e2e-ci-docs` ブランチで実施(PR #1 マージ後の main から分岐)→ PR → CI(既存 ci.yml + 新 e2e.yml は push 後に発火)→ green でユーザー確認の上 develop / main へ。
