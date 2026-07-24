# Top20 残り 15 サービス(16 ID)フルコンソール化 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** spec `docs/superpowers/specs/2026-07-22-top20-services-design.md`(R51〜R98)に基づき、
lambda / api-gateway / cognito / eventbridge / secrets-manager / elasticache / cloudformation /
ecs / ecr / cloudwatch / step-functions / opensearch / athena / msk / ssm / route53 の 16 サービスを
フル機能で追加し、4 エミュレータ(localstack:3 / floci / ministack / kumo)で E2E green にする。

**Architecture:** T0 で共有スキャフォールディング(依存一括追加・ハーネス変更)を統合ブランチに
先行コミット。T1〜T16 を **16 並列の git worktree + Opus サブエージェント**でサービス単位に実装
(各タスクは probe → Rust コマンド → TS API → ページ → registry 配線 → unit テスト → E2E spec まで
自己完結)。統合(Fable)が cherry-pick で束ね、T17 で 4 エミュレータ E2E・ドキュメント同期・PR。

**Tech Stack:** Tauri 2 / React 19 + TS / aws-sdk-rust v1 系 16 クレート / Vitest / WebdriverIO
(Tauri embedded)/ PR #23 の capability ゲート基盤(`e2e/helpers/capabilities.ts`)。

## Global Constraints

- UI 文言は日本語、識別子・コメントは英語。ライトテーマのみ(`docs/design/ui-mock.html` 準拠)。
- ワイヤ契約: Rust struct は serde `rename_all = "camelCase"`、コマンドは
  `#[tauri::command(rename_all = "camelCase")]`。TS ミラーと必ず両側同時変更。
  新サービスのワイヤ型は各 `src/api/<id>.ts` 内で export(`types.ts` には追記しない)。
- 共通 UI プリミティブ(`src/components/ui/`、`useProfileScopedFetch`、`src/lib/format.ts`、
  `src/lib/unsupported.ts`)を必ず使用。生 Tailwind の再発明禁止。
- エラーは既存 `AppError`(`map_sdk_err`)のみ。新エラー型追加禁止。
- クライアント生成は `aws_sdk_<x>::Client::new(&make_sdk_config(&profile))`。connections.rs 編集不要。
- チェックブロック(全タスク完了条件):
  `npx tsc --noEmit && npx vitest run && (cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test)` green。
- コミットは Conventional Commits(`feat(lambda): ...`)。頻繁にコミット。
- **ローカルポート規律**: 4566(kumo 以外)/ 8000 / 4610 / 4620〜4622 は使用禁止(開発者・統合者が使用中)。
  各エージェントは自分の **ポートブロック 47X0〜47X3**(X = タスク番号、T1 なら 4710〜4713)で
  自前コンテナ(名前 `nlsd-t<N>-<emulator>`)を起動・破棄する。
- **E2E アプリスイート実行はグローバル直列**(§実行アーキテクチャの mkdir ロック)。
- **迷ったら実装せず質問**: 不明点・仕様の曖昧さ・プローブ結果が spec と食い違う場合は、
  進めずに final report に「QUESTION:」ブロックで質問を書いて終了する。Fable(main)が回答して再派遣する。

---

## 実行アーキテクチャ(コントローラ = Fable 向け)

1. **前提**: PR #23(kumo capability ゲート)がマージ済みであること。未マージなら
   `feature/kumo-emulator-capability-gates` を基点にし、マージ後 rebase。
2. **T0**(直列、統合ブランチ `feature/top20-services` 上): 共有スキャフォールディング。
3. **T1〜T16**(**全並列**、各 worktree、T0 コミット起点、モデルは Opus 指定):
   各タスクは共有配線ファイル(`commands/mod.rs` / `lib.rs` generate_handler /
   `api/client.ts` / `services/registry.ts` / `e2e/helpers/aws.ts` / `e2e/helpers/capabilities.ts` /
   `e2e/SPEC-COVERAGE.md`)に「自サービスの行」だけを追加する。統合時の競合は全て
   union(両方残す)で機械的に解消できる。
4. **worktree 運用**: `git worktree add ../nlsd-t<N> feature/top20-services -b task/<id>`。
   各 worktree で `npm ci` を実行。Rust は worktree ごとの既定 target dir(ディスク消費は許容)。
5. **E2E ロック**: アプリ E2E(`npm run e2e`)は
   `until mkdir /tmp/nlsd-e2e-lock 2>/dev/null; do sleep 30; done` で取得 →
   実行 → `rmdir /tmp/nlsd-e2e-lock`。エミュレータは `scripts/emulator.sh`(EMU_PORT=4650)を
   ロック保持中のみ使用。**kumo の E2E はローカルで 4566 が空かないため T17(統合)まで実施しない**。
6. **統合**: T1→…→T16 の順に cherry-pick、都度チェックブロック。T17 で全体 E2E → PR → CI → merge。

---

### Task 0: 共有スキャフォールディング(統合ブランチ直列)

**Files:**
- Modify: `src-tauri/Cargo.toml`(16 クレート追加)
- Modify: `package.json` + `package-lock.json`(devDependencies に 17 の `@aws-sdk/client-*`)
- Modify: `scripts/emulator.sh`(localstack / floci に docker.sock マウント)
- Modify: `src/services/registry.ts`(`cloudwatch-logs` の comingSoon 行を削除)
- Create: `scripts/probe-services.sh`(サービス操作プローブ)
- Add: `docs/superpowers/specs/2026-07-22-top20-services-design.md`(本 spec、未コミットならここで)

**Interfaces:**
- Produces: Cargo deps `aws-sdk-{lambda,apigateway,cognitoidentityprovider,eventbridge,secretsmanager,elasticache,cloudformation,ecs,ecr,cloudwatchlogs,cloudwatch,sfn,opensearch,athena,kafka,ssm,route53} = "1"`。
- Produces: npm devDeps `@aws-sdk/client-{lambda,api-gateway,cognito-identity-provider,eventbridge,secrets-manager,elasticache,cloudformation,ecs,ecr,cloudwatch-logs,cloudwatch,sfn,opensearch,athena,kafka,ssm,route-53}`。
- Produces: `scripts/emulator.sh` の localstack/floci `docker run` に
  `-v /var/run/docker.sock:/var/run/docker.sock` が付く(ministack/kumo は付けない)。

- [ ] **Step 1**: Cargo.toml に 17 依存(上記 16 + `aws-sdk-cloudwatch`)を追加し `(cd src-tauri && cargo build)` 確認。
- [ ] **Step 2**: `npm install -D` で 17 クライアントを追加(lockfile 更新込み)。
- [ ] **Step 3**: emulator.sh の `start_docker` を emulator 名で分岐させ socket マウント追加。
  `scripts/emulator.sh start localstack && scripts/emulator.sh wait localstack`(EMU_PORT=4649)で起動確認後 stop。
- [ ] **Step 4**: registry.ts から `comingSoon("cloudwatch-logs", ...)` 行を削除(`cloudwatch` に統合)。
  Home.test.tsx が件数をアサートしていれば更新。
- [ ] **Step 5**: 本設計セッションの probe.sh(scratchpad)を `scripts/probe-services.sh` として整備:
  `probe-services.sh <endpoint> [service]` で §2.2 の全操作を叩き OK/FAIL を出す。
- [ ] **Step 6**: チェックブロック green → `git commit -m "chore: scaffold top20 service deps, emulator docker.sock and probe script"`

---

## T1〜T16 共通要件(全サービスタスクに適用)

各タスクの実装者は着手時に必ず以下を Read して慣習を写す:
`src/features/sqs/`(全ファイル)/ `src/api/sqs.ts` / `src-tauri/src/commands/sqs.rs` /
`src/services/registry.ts` / `e2e/specs/sqs.e2e.ts` / `e2e/helpers/capabilities.ts` /
spec の自サービス節(§3.x)と §2(capability マトリクス)・§4(E2E 原則)。

1. **プローブ(最初のステップ、コード前)**: 自分のポートブロックで 4 エミュレータ
   (localstack:3 / floci / ministack / kumo イメージ)を起動し、`scripts/probe-services.sh` +
   必要な追加 aws CLI 呼び出しで**自タスクの全予定操作**を実測。結果表(操作 × 4 エミュレータ)を
   コミットメッセージ or レポートに残し、capability ゲート設計を確定する。
   spec §2 と矛盾したら QUESTION で停止。kumo は 4566 でしか SQS URL 系が正しくないが、
   SQS 非依存サービスのプローブは任意ポートでよい。
2. **Rust(TDD)**: `src-tauri/src/commands/<id>.rs` 新設。wire 型の serde camelCase roundtrip
   単体テストを先に書く → コア `async fn`(`&Client` を取る、テスト可能)→ 薄い
   `#[tauri::command]` ラッパ(`client_for(&profile)`)。`commands/mod.rs` に `pub mod <id>;`、
   `lib.rs` の `generate_handler!` に自コマンド追記。integration テストは `#[ignore]` +
   `EMU_ENDPOINT`(sqs.rs の置き場所・命名に合わせる)。
3. **TS API**: `src/api/<id>.ts`(invoke ラッパ + ワイヤ型 export、コマンドと 1:1 camelCase)。
   `api/client.ts` の合成に 1 行追加。
4. **ページ**: `src/features/<id>/service.tsx` + ページ群。spec §3.x のナビ・ルート・
   機能を逐語で実装。ダッシュボードは `SummaryCards` + 一覧 + クイックアクション(sqs 型)。
   作成 `Modal`+`ModalFooter`、削除 `ConfirmDangerModal`、一覧 `DataTable`、
   取得 `useProfileScopedFetch`、未接続 `ConnectionRequired`、非対応 `<id>-unsupported`
   バナー(rds の DashboardPage を手本に `isUnsupportedOperation` 分岐)。
   testid 規約: ナビ `nav-<slug>`、一覧行 `<id>-row`、作成ボタン `<id>-create`、
   確認入力 `<id>-delete-input` / `<id>-delete-confirm`(既存サービスの命名パターンに合わせ、
   E2E spec と同じ名前を使う)。
5. **registry**: `services/registry.ts` の自サービス comingSoon 行を enabled 定義に差し替え。
6. **unit テスト**: 各ページに vitest(api モック / 一覧描画 / 作成 / 削除確認 /
   エラーバナー / unsupported バナー分岐 / 未接続ガード)。手本: `features/sqs/*.test.tsx`、
   `features/rds/DashboardPage.test.tsx`(unsupported 分岐)。
7. **E2E**: `e2e/specs/<id>.e2e.ts` に自 R-id 全部を実装。原則(spec §4):
   SDK seed → UI 操作 → SDK 裏取り。capability 分岐は `gate(this, "R◯◯", {...})` +
   対称テスト + `after` の `expectCovered`。新 capability は `capabilities.ts` の
   `CapabilityId` union と `PROBES` に追加。SDK ファクトリを `e2e/helpers/aws.ts` に追加。
   `e2e/SPEC-COVERAGE.md` に自 R-id 行を追加。
8. **完了条件**: チェックブロック green + integration テスト(ministack、自ポートブロック)green +
   **E2E をローカル 2 エミュレータで green**(ministack + 「自サービスに非対応分岐が存在する
   エミュレータ」1 種。E2E ロックと EMU_PORT=4650 を使用)。kumo E2E は T17 に委譲。
9. **報告**: プローブ結果表 / 確定した capability ゲート / 追加した testid / R-id とテストの対応 /
   QUESTION(あれば)を final report に必ず含める。

---

### Task 1: Lambda(spec §3.1、R51〜R55)

**Files:**
- Create: `src-tauri/src/commands/lambda.rs`, `src/api/lambda.ts`,
  `src/features/lambda/`(service.tsx / DashboardPage / FunctionsPage / FunctionDetailPage /
  LayersPage / CreateFunctionModal + tests), `e2e/specs/lambda.e2e.ts`
- Modify: 共通配線 7 ファイル(自行のみ)

**Interfaces(Produces):**
- Rust: `lambda_list_functions` `lambda_get_function(name)` `lambda_create_function(req)`
  `lambda_update_function_code(name, zip_path)` `lambda_update_function_config(name, req)`
  `lambda_delete_function(name)` `lambda_invoke(name, payload) -> InvokeResult{statusCode, payload, functionError?, logTail?}`
  `lambda_list_layers` `lambda_publish_layer_version(req)` `lambda_delete_layer_version(name, version)`
- zip は **パス方式**: フロントは tauri-plugin-dialog で選択(E2E は `window.__E2E_UPLOAD_PATH`
  シーム — s3 の実装を Read して同じ仕組みを使う)、Rust が `std::fs::read` する。
- ロールは `arn:aws:iam::000000000000:role/nlsd-dummy` を Rust 側で自動設定(UI 入力なし)。
- Invoke は `LogType::Tail` を指定し `log_result` を base64 デコードして `logTail` に。

**E2E 対応(capability):** `lambda.invoke`(localstack は docker.sock マウントで ○ /
kumo ×)。R54 は supported 側(invoke 成功 + ペイロードエコー + ログ表示)と
unsupported 側(kumo: invoke 実行 → ErrorBanner)の対称。R51〜R53 / R55 は無条件。
E2E 用 zip fixture は spec probe と同じ `def handler(event, context): return {"ok": True, "echo": event}`
を suite の before で一時生成する。

- [ ] Step 1: プローブ(共通要件 1。レイヤー系 API は 4 エミュレータで未実測 → ここで確定)
- [ ] Step 2〜: 共通要件 2〜7 を R51→R55 の順で TDD 実装(R-id ごとにコミット)
- [ ] 最終: 共通要件 8(2 エミュレータ E2E: ministack + localstack)+ 9

### Task 2: API Gateway(spec §3.2、R56〜R59)

**Files:** Create: `commands/apigateway.rs`, `api/apigateway.ts`,
`features/api-gateway/`(service.tsx / DashboardPage / ApisPage / ApiDetailPage(リソース・
ステージタブ)/ ApiKeysPage / CreateApiModal + tests), `e2e/specs/api-gateway.e2e.ts`

**Interfaces(Produces):**
- Rust: `apigw_list_apis` `apigw_create_api(name, description?)` `apigw_delete_api(id)`
  `apigw_get_resources(api_id) -> Vec<ApiResource{id, path, parentId?, methods: Vec<String>}>`
  `apigw_create_resource(api_id, parent_id, path_part)`
  `apigw_put_method(api_id, resource_id, http_method, integration: MethodIntegration{kind: "mock"|"lambdaProxy", lambdaArn?})`
  `apigw_create_deployment(api_id, stage_name)` `apigw_list_stages(api_id)`
  `apigw_list_api_keys` `apigw_create_api_key(name)` `apigw_delete_api_key(id)`
- リソースツリーはフラット配列 + parentId(UI 側でインデント描画)。
- MOCK 統合は `RequestTemplates {"application/json": "{\"statusCode\": 200}"}` を設定。

**E2E:** invoke URL 表示(R58)は参考表示 — プローブで URL 形式が検証できたエミュレータのみ
アサート、それ以外は表示自体を省略可(spec §3.2 準拠)。API キー(R59)は
プローブ結果に応じ `apigateway.apiKeys` ゲート + 対称テスト。localstack:3 は REST v1 対応なので
全 R-id が 4 エミュレータで動く想定(プローブで確定)。
2 エミュレータ E2E: ministack + floci。

- [ ] Step 1: プローブ(特に API キー / ステージ / invoke URL 形式)
- [ ] Step 2〜: R56→R59 を TDD 実装 → 共通要件 8・9

### Task 3: Cognito(spec §3.3、R60〜R62)

**Files:** Create: `commands/cognito.rs`, `api/cognito.ts`,
`features/cognito/`(service.tsx / DashboardPage / UserPoolsPage / UserPoolDetailPage
(ユーザー・アプリクライアント・グループのタブ)/ CreateUserPoolModal / CreateUserModal + tests),
`e2e/specs/cognito.e2e.ts`

**Interfaces(Produces):**
- Rust: `cognito_list_user_pools` `cognito_create_user_pool(name)` `cognito_delete_user_pool(id)`
  `cognito_get_user_pool(id)` `cognito_list_users(pool_id)`
  `cognito_admin_create_user(pool_id, username, email?, temp_password?)`
  `cognito_admin_set_user_password(pool_id, username, password, permanent)`
  `cognito_admin_enable_user(pool_id, username)` `cognito_admin_disable_user(pool_id, username)`
  `cognito_admin_delete_user(pool_id, username)`
  `cognito_list_user_pool_clients(pool_id)` `cognito_create_user_pool_client(pool_id, name)`
  `cognito_delete_user_pool_client(pool_id, client_id)`
  `cognito_list_groups(pool_id)` `cognito_create_group(pool_id, name, description?)`
  `cognito_delete_group(pool_id, name)`

**E2E(capability):** `cognito.userPools`(localstack:3 × = Pro)。R60 は supported 側 CRUD と
unsupported 側 `cognito-unsupported` バナーの対称。R61/R62 は `cognito.userPools` ゲート +
`expectCoveredIf`。2 エミュレータ E2E: ministack + **localstack(unsupported 分岐)**。

- [ ] Step 1: プローブ(アプリクライアント / グループ / kumo の各 admin 操作)
- [ ] Step 2〜: R60→R62 を TDD 実装 → 共通要件 8・9

### Task 4: EventBridge(spec §3.4、R63〜R65)

**Files:** Create: `commands/eventbridge.rs`, `api/eventbridge.ts`,
`features/eventbridge/`(service.tsx / DashboardPage / BusesPage / RulesPage(バス選択 +
ターゲット管理)/ PutEventsModal / CreateRuleModal + tests), `e2e/specs/eventbridge.e2e.ts`

**Interfaces(Produces):**
- Rust: `events_list_buses` `events_create_bus(name)` `events_delete_bus(name)`
  `events_list_rules(bus)` `events_put_rule(req{name, bus, scheduleExpression?, eventPattern?, description?, enabled})`
  `events_delete_rule(name, bus)` `events_enable_rule(name, bus)` `events_disable_rule(name, bus)`
  `events_list_targets(rule, bus)` `events_put_target(rule, bus, target_id, arn)`
  `events_remove_target(rule, bus, target_id)`
  `events_put_events(bus, source, detail_type, detail) -> PutEventsResult{failedCount, eventIds}`

**E2E:** R65 は実配信テスト: SDK で SQS キュー作成(+ポリシー)→ UI でルール
(イベントパターン `{"source":["nlsd.e2e"]}`)+ SQS ターゲット → UI からイベント送信 →
SDK receive で detail 一致を検証。SNS R28 と同じ最大 3 回リトライ方式。
ターゲット実配信が非対応のエミュレータがプローブで見つかったら `eventbridge.delivery`
ゲート + 対称テスト(送信自体は成功しエラーにならないことを検証)。
2 エミュレータ E2E: ministack + floci。

- [ ] Step 1: プローブ(**PutEvents → SQS ターゲット実配信**を 4 エミュレータで実測)
- [ ] Step 2〜: R63→R65 を TDD 実装 → 共通要件 8・9

### Task 5: Secrets Manager(spec §3.5、R66〜R67)

**Files:** Create: `commands/secretsmanager.rs`, `api/secretsmanager.ts`,
`features/secrets-manager/`(service.tsx / SecretsPage / SecretDetailPage /
CreateSecretModal + tests), `e2e/specs/secrets-manager.e2e.ts`

**Interfaces(Produces):**
- Rust: `secrets_list` `secrets_create(name, secret_string, description?)`
  `secrets_describe(id)` `secrets_get_value(id) -> SecretValue{secretString, versionId, createdDate?}`
  `secrets_put_value(id, secret_string)` `secrets_list_versions(id)`
  `secrets_delete(id, force: bool, recovery_days: Option<i64>)`
  `secrets_tag(id, key, value)` `secrets_untag(id, key)`
- 単独ナビ(S3 型、ダッシュボード無し)。値は既定伏せ字(`●●●`)+ 表示トグル
  testid `secret-value-toggle`。

**E2E:** 4 エミュレータ全対応想定(プローブで確定)。削除の即時/猶予 UI は
猶予非対応エミュレータがあれば force 固定にフォールバック(プローブで判断、
QUESTION 不要のレンジ)。2 エミュレータ E2E: ministack + kumo は不可なので floci。

- [ ] Step 1: プローブ(削除猶予 / バージョンステージ / タグ)
- [ ] Step 2〜: R66→R67 を TDD 実装 → 共通要件 8・9

### Task 6: ElastiCache(spec §3.6、R68〜R70)

**Files:** Create: `commands/elasticache.rs`, `api/elasticache.ts`,
`features/elasticache/`(service.tsx / DashboardPage / CachesPage / CreateCacheModal + tests),
`e2e/specs/elasticache.e2e.ts`

**Interfaces(Produces):**
- Rust: `elasticache_list_caches -> Vec<CacheSummary{id, kind: "replicationGroup"|"cacheCluster", engine, status, nodeType?, numNodes, endpoint?}>`
  (DescribeReplicationGroups + DescribeCacheClusters をマージ。cluster が RG 所属なら RG 側に集約)
  `elasticache_create_cache(req{id, engine: "redis"|"valkey"|"memcached", nodeType, numNodes})`
  — redis/valkey → CreateReplicationGroup、memcached → CreateCacheCluster(floci 実測仕様)
  `elasticache_delete_cache(id, kind)` `elasticache_get_cache(id, kind)`

**E2E(capability):** `elasticache.describe`(localstack:3 × = Pro)。R70 が unsupported 対称。
R69 の作成は engine=redis で実施し、エンドポイント表示をアサート。
2 エミュレータ E2E: ministack + **localstack(unsupported 分岐)**。

- [ ] Step 1: プローブ(valkey 対応 / エンドポイント返却形 / kumo の RG 系)
- [ ] Step 2〜: R68→R70 を TDD 実装 → 共通要件 8・9

### Task 7: CloudFormation(spec §3.7、R71〜R74)

**Files:** Create: `commands/cloudformation.rs`, `api/cloudformation.ts`,
`features/cloudformation/`(service.tsx / DashboardPage / StacksPage / StackDetailPage
(リソース/出力/パラメータ/イベント/テンプレートのタブ)/ CreateStackModal + tests),
`e2e/specs/cloudformation.e2e.ts`

**Interfaces(Produces):**
- Rust: `cfn_list_stacks` `cfn_create_stack(name, template_body, parameters: Vec<CfnParameter{key, value}>)`
  `cfn_update_stack(name, template_body, parameters)` `cfn_delete_stack(name)`
  `cfn_get_stack(name) -> StackDetail{name, status, statusReason?, createdAt?, outputs, parameters}`
  `cfn_list_resources(name)` `cfn_list_events(name)` `cfn_get_template(name) -> String`
  `cfn_list_exports`
- 作成モーダル: テンプレート textarea(JSON/YAML そのまま送る)+ パラメータ key/value 動的行。

**E2E:** R72 はテンプレート(SNS トピック 1 個)投入 → CREATE_COMPLETE 待ち(ポーリング、
rds の available 待ちを手本)→ SDK(SNS ListTopics)で実在検証。R73 の kumo
ListStackResources 非 XML 問題は **SDK(JS/Rust)で再実測**し、壊れているなら
`cloudformation.resources` capability でリソースタブをゲート + 対称テスト。
R74 は UpdateStack(トピック名変更)→ SDK 検証 → 削除 → トピック消滅検証。
2 エミュレータ E2E: ministack + kumo が不可のため floci(kumo 分岐は T17)。

- [ ] Step 1: プローブ(kumo resources を SDK で / UpdateStack / ListExports)
- [ ] Step 2〜: R71→R74 を TDD 実装 → 共通要件 8・9

### Task 8: ECS(spec §3.8、R75〜R77)

**Files:** Create: `commands/ecs.rs`, `api/ecs.ts`,
`features/ecs/`(service.tsx / DashboardPage / ClustersPage / ClusterDetailPage(サービス・
タスクのタブ)/ TaskDefinitionsPage / RegisterTaskDefModal / CreateServiceModal + tests),
`e2e/specs/ecs.e2e.ts`

**Interfaces(Produces):**
- Rust: `ecs_list_clusters` `ecs_create_cluster(name)` `ecs_delete_cluster(name)`
  `ecs_list_task_definitions` `ecs_register_task_definition(family, container_defs_json)`
  `ecs_describe_task_definition(arn)` `ecs_deregister_task_definition(arn)`
  `ecs_list_services(cluster)` `ecs_create_service(cluster, name, task_def, desired)`
  `ecs_update_service(cluster, name, desired)` `ecs_delete_service(cluster, name)`
  `ecs_list_tasks(cluster)` `ecs_run_task(cluster, task_def)` `ecs_stop_task(cluster, task_arn)`
- containerDefinitions は JSON textarea で受け、Rust で `serde_json` パース →
  SDK 型へ変換(最低 name/image/memory/essential をサポート。それ以外のキーは無視で可、
  無視した場合は UI に注記)。

**E2E(capability):** `ecs.clusters`(localstack:3 × = Pro)。R75 の unsupported 対称 =
`ecs-unsupported` バナー。R77 の RunTask は実コンテナが起動する floci/ministack では
軽量イメージ(`public.ecr.aws/docker/library/busybox:stable` 等プローブで通るもの)を使い、
テスト終了時に必ず StopTask + クラスター削除。kumo はコントロールプレーンのみの想定
(プローブで確定し、タスクが RUNNING にならないなら一覧表示のみアサート)。
2 エミュレータ E2E: ministack + **localstack(unsupported 分岐)**。

- [ ] Step 1: プローブ(service/run-task/stop-task を floci/ministack/kumo で)
- [ ] Step 2〜: R75→R77 を TDD 実装 → 共通要件 8・9

### Task 9: ECR(spec §3.9、R78〜R79)

**Files:** Create: `commands/ecr.rs`, `api/ecr.ts`,
`features/ecr/`(service.tsx / RepositoriesPage / RepositoryDetailPage / CreateRepositoryModal
+ tests), `e2e/specs/ecr.e2e.ts`

**Interfaces(Produces):**
- Rust: `ecr_list_repositories` `ecr_create_repository(name)`
  `ecr_delete_repository(name, force)` `ecr_list_images(name)`
- 単独ナビ(S3 型)。URI コピーは `navigator.clipboard`(既存にコピー UI があれば手本に、
  なければ testid `ecr-copy-uri` のボタンで document.execCommand フォールバック不要、
  Tauri の clipboard 挙動をプローブ)。

**E2E(capability):** `ecr.repositories`(localstack ×)+ `ecr.create`(floci は
docker.sock マウント時のみ ○ — T0 でマウント済みなので実測で確定)。
R78 supported 側 CRUD / unsupported 側バナー。R79 はイメージ 0 件の空表アサート
(push は本計画のスコープ外)。2 エミュレータ E2E: ministack + localstack。

- [ ] Step 1: プローブ(socket マウント済み floci の create / list-images)
- [ ] Step 2〜: R78→R79 を TDD 実装 → 共通要件 8・9

### Task 10: CloudWatch(spec §3.10、R80〜R83)— 横断①含む

**Files:** Create: `commands/cloudwatch.rs`(Logs)、必要なら `commands/cloudwatch_query.rs`
(Metrics/Alarms 旧 Query プロトコル)、`api/cloudwatch.ts`,
`features/cloudwatch/`(service.tsx / DashboardPage / LogGroupsPage / LogGroupDetailPage /
MetricsPage / AlarmsPage / CreateAlarmModal + tests), `e2e/specs/cloudwatch.e2e.ts`
- Modify(必要時): `src-tauri/Cargo.toml` に `reqwest`(default-features=false)+ `quick-xml`

**Interfaces(Produces):**
- Rust Logs: `cw_list_log_groups` `cw_create_log_group(name)` `cw_delete_log_group(name)`
  `cw_list_log_streams(group)` `cw_get_log_events(group, stream) -> Vec<LogEvent{timestamp, message}>`
  `cw_filter_log_events(group, pattern)`
- Rust Metrics/Alarms: `cw_list_metrics(namespace?) -> Vec<MetricSummary{namespace, name, dimensions}>`
  `cw_get_metric_statistics(req{namespace, metricName, dimensions, periodSec, stat, startIso, endIso}) -> Vec<Datapoint{timestamp, value}>`
  `cw_describe_alarms` `cw_put_metric_alarm(req{name, namespace, metricName, stat, periodSec, threshold, comparison})`
  `cw_delete_alarms(names)`
- **最初の判定ステップ(spec §2.1-1)**: 最新 `aws-sdk-cloudwatch` で localstack:3
  (socket 不要)に ListMetrics → 成功すれば SDK 実装、CBOR 起因で失敗すれば
  `cloudwatch_query.rs` に旧 Query プロトコル(form POST + quick-xml パース)実装。
  判定結果を report に明記。

**E2E(capability):** `cloudwatch.metrics` / `cloudwatch.alarms`(kumo ×)。プローブは
生 Query HTTP(capabilities.ts の rdsQuery を一般化して `awsQuery(service, action, params)`
ヘルパに昇格させてよい — その場合 rds プローブも同ヘルパに乗せ替え、挙動不変を確認)。
R80/R81 無条件(4 種対応)。R82/R83 は対称テスト付き。
2 エミュレータ E2E: ministack + **localstack(Query 実装の実機確認)**。

- [ ] Step 1: プローブ + SDK/Query 判定
- [ ] Step 2〜: R80→R83 を TDD 実装 → 共通要件 8・9

### Task 11: Step Functions(spec §3.11、R84〜R86)

**Files:** Create: `commands/stepfunctions.rs`, `api/stepfunctions.ts`,
`features/step-functions/`(service.tsx / DashboardPage / StateMachinesPage /
StateMachineDetailPage(実行・定義タブ)/ ExecutionDetailPage / CreateStateMachineModal +
tests), `e2e/specs/step-functions.e2e.ts`

**Interfaces(Produces):**
- Rust: `sfn_list_state_machines` `sfn_create_state_machine(name, definition) `
  `sfn_update_state_machine(arn, definition)` `sfn_delete_state_machine(arn)`
  `sfn_describe_state_machine(arn)` `sfn_start_execution(arn, input) -> ExecutionRef{executionArn}`
  `sfn_list_executions(arn)` `sfn_describe_execution(execution_arn) -> ExecutionDetail{status, input?, output?, startedAt?, stoppedAt?}`
  `sfn_get_execution_history(execution_arn) -> Vec<HistoryEvent{id, eventType, timestamp}>`
- ロールは dummy ARN 自動(Lambda と同じ)。

**E2E:** ASL は `{"StartAt":"P","States":{"P":{"Type":"Pass","End":true}}}` を使用。
R85 は入力 `{"hello":"world"}` → 実行詳細で出力に同 JSON が出ることをアサート
(Pass の伝播)。実行完了はポーリング待ち。4 エミュレータ対応想定(プローブで確定、
穴があれば `sfn.executions` ゲート + 対称)。2 エミュレータ E2E: ministack + floci。

- [ ] Step 1: プローブ(execution history / update を 4 種で)
- [ ] Step 2〜: R84→R86 を TDD 実装 → 共通要件 8・9

### Task 12: OpenSearch(spec §3.12、R87〜R88)

**Files:** Create: `commands/opensearch.rs`, `api/opensearch.ts`,
`features/opensearch/`(service.tsx / DashboardPage / DomainsPage / CreateDomainModal + tests),
`e2e/specs/opensearch.e2e.ts`

**Interfaces(Produces):**
- Rust: `opensearch_list_domains` `opensearch_create_domain(name)`
  `opensearch_delete_domain(name)` `opensearch_get_domain(name) -> DomainDetail{name, endpoint?, engineVersion?, processing, created}`

**E2E(capability):** `opensearch.domains`(kumo ×)+ `opensearch.create`
(floci は socket マウントで ○ 想定 — 実測)。R87 supported CRUD、
R88 = kumo バナー対称 + describe○/create× 中間ケース(RDS R35 型)。
2 エミュレータ E2E: ministack + localstack。

- [ ] Step 1: プローブ(socket 付き floci の create、作成完了までの時間)
- [ ] Step 2〜: R87→R88 を TDD 実装 → 共通要件 8・9

### Task 13: Athena(spec §3.13、R89〜R91)

**Files:** Create: `commands/athena.rs`, `api/athena.ts`,
`features/athena/`(service.tsx / QueryEditorPage / SavedQueriesPage / WorkgroupsPage + tests),
`e2e/specs/athena.e2e.ts`

**Interfaces(Produces):**
- Rust: `athena_start_query(query, workgroup?) -> QueryRef{executionId}`
  `athena_get_query_execution(execution_id) -> QueryStatus{state, reason?}`
  `athena_get_query_results(execution_id) -> QueryResults{columns: Vec<String>, rows: Vec<Vec<String>>}`
  `athena_list_workgroups` `athena_create_workgroup(name, description?)` `athena_delete_workgroup(name)`
  `athena_list_named_queries` `athena_create_named_query(name, query, database?)`
  `athena_delete_named_query(id)`
- エディタは PartiqlPage を手本にした非同期版: 実行 → 「実行中...」表示 →
  ステータスポーリング(500ms 間隔・上限 30s)→ 結果テーブル。
  OutputLocation は `s3://nlsd-athena-results/` を既定送出(プローブで要否確認)。

**E2E(capability):** `athena.query`(localstack:3 × = Pro)/ `athena.workgroups`(kumo ×)。
R89 supported = `SELECT 1` 実行で結果表に行が出る(ministack のモック結果でも表は出る —
値のアサートはエミュレータ非依存の「行が 1 行以上」レベルに留める)、
unsupported = `athena-unsupported` バナー。R90/R91 は各ゲート + 対称。
2 エミュレータ E2E: ministack + **localstack(unsupported 分岐)**。

- [ ] Step 1: プローブ(OutputLocation 要否 / NamedQuery / kumo query の実挙動)
- [ ] Step 2〜: R89→R91 を TDD 実装 → 共通要件 8・9

### Task 14: MSK(spec §3.14、R92〜R93)

**Files:** Create: `commands/msk.rs`, `api/msk.ts`,
`features/msk/`(service.tsx / DashboardPage / ClustersPage / CreateClusterModal + tests),
`e2e/specs/msk.e2e.ts`

**Interfaces(Produces):**
- Rust: `msk_list_clusters` `msk_create_cluster(name, num_brokers)`(BrokerNodeGroupInfo は
  プローブで通った最小構成をハードコード: instance_type `kafka.t3.small`、
  client_subnets `["subnet-1"]` 等 — 実測値に合わせる)
  `msk_delete_cluster(arn)` `msk_describe_cluster(arn)`
  `msk_get_bootstrap_brokers(arn) -> BootstrapBrokers{plaintext?, tls?}`

**E2E(capability):** `kafka.clusters`(localstack:3 / kumo ×)+ 必要なら
`kafka.create`(ministack は list のみ実証済み — プローブで確定)。
R92 supported = 作成 → ACTIVE 待ち → ブローカー文字列表示 → 削除、
R93 = unsupported バナー対称。2 エミュレータ E2E: **floci(フル)+ localstack(バナー)**。

- [ ] Step 1: プローブ(**CreateCluster 最小構成を floci/ministack で確定** — 最重要)
- [ ] Step 2〜: R92→R93 を TDD 実装 → 共通要件 8・9

### Task 15: Systems Manager(spec §3.15、R94〜R95)

**Files:** Create: `commands/ssm.rs`, `api/ssm.ts`,
`features/ssm/`(service.tsx / ParametersPage / ParameterDetailPage / CreateParameterModal +
tests), `e2e/specs/ssm.e2e.ts`

**Interfaces(Produces):**
- Rust: `ssm_list_parameters(prefix?) -> Vec<ParameterSummary{name, type, version, lastModified?}>`
  `ssm_get_parameter(name, with_decryption) -> ParameterValue{name, type, value, version}`
  `ssm_put_parameter(req{name, value, type: "String"|"StringList"|"SecureString", overwrite, description?})`
  `ssm_delete_parameter(name)` `ssm_get_parameter_history(name)`
- 単独ナビ(S3 型)。SecureString は既定伏せ字 + トグル(testid `ssm-value-toggle`)。
  prefix フィルタは DescribeParameters の ParameterFilters(Key=Name, Option=BeginsWith)。

**E2E:** 4 エミュレータ全対応(実測済み)。R94 CRUD + prefix フィルタ、
R95 = SecureString トグル + 上書き → バージョン履歴に v1/v2 が並ぶ。
2 エミュレータ E2E: ministack + floci。

- [ ] Step 1: プローブ(history / BeginsWith フィルタ / kumo SecureString 復号)
- [ ] Step 2〜: R94→R95 を TDD 実装 → 共通要件 8・9

### Task 16: Route 53(spec §3.16、R96〜R98)

**Files:** Create: `commands/route53.rs`, `api/route53.ts`,
`features/route53/`(service.tsx / DashboardPage / HostedZonesPage / HostedZoneDetailPage
(レコード CRUD)/ HealthChecksPage / CreateZoneModal / RecordModal + tests),
`e2e/specs/route53.e2e.ts`

**Interfaces(Produces):**
- Rust: `route53_list_hosted_zones` `route53_create_hosted_zone(name)`
  `route53_delete_hosted_zone(id)` `route53_list_record_sets(zone_id)`
  `route53_change_record_set(zone_id, action: "CREATE"|"UPSERT"|"DELETE", record: RecordSet{name, recordType, ttl, values: Vec<String>})`
  `route53_list_health_checks` `route53_create_health_check(req{target, port, checkType: "HTTP"|"TCP", resourcePath?})`
  `route53_delete_health_check(id)`

**E2E:** R96/R97 は 4 エミュレータ対応(zone/record 実測済み)。R98 ヘルスチェックは
未実測 → プローブで確定し、非対応エミュレータがあれば `route53.healthChecks` ゲート +
対称テスト。2 エミュレータ E2E: ministack + floci。

- [ ] Step 1: プローブ(ヘルスチェック / UPSERT/DELETE / kumo のレコードタイプ網羅)
- [ ] Step 2〜: R96→R98 を TDD 実装 → 共通要件 8・9

---

### Task 17: 統合・全体 E2E・ドキュメント同期・PR(コントローラ = Fable)

**Files:**
- Modify: `e2e/SPEC-COVERAGE.md`(R51〜R98 の統合整合 + capability 脚注)
- Modify: `AGENTS.md` / `README.md`(対応サービス一覧の更新)
- Modify: `docs/superpowers/specs/2026-07-22-top20-services-design.md`
  (実装で確定した capability / 仕様差分を反映)

- [ ] Step 1: T1〜T16 を番号順に統合ブランチへ cherry-pick。共有 7 ファイルの競合は union 解消。
  各統合後にチェックブロック実行。
- [ ] Step 2: `npm run e2e:build` → フル E2E を localstack:3 / floci / ministack(EMU_PORT=4650)
  で実行し green 確認。
- [ ] Step 3: kumo フル E2E: ローカル 4566 は開発者のコンテナが使用中のため、
  **ユーザーに 4566 の一時解放を確認**してから実行(不可なら CI の kumo ジョブで検証)。
- [ ] Step 4: SPEC-COVERAGE 全行(R1〜R98)にテスト対応があることを確認。
  AGENTS.md / README のサービス一覧・説明を更新。
- [ ] Step 5: セルフレビュー(spec との突合・testid 一貫性・wire 契約両側確認)→
  PR 作成(develop 向け、US/タスク ID として本 spec を明記)→ CI green → merge。

## 自己レビュー結果(計画作成時)

- spec §3 の全 16 サービス・R51〜R98 の全 R-id にタスクが対応(T1〜T16)。
- 横断①(CW Query)= T10、横断②(docker.sock)= T0、横断③(zip パスシーム)= T1、
  kumo の癖 = PR #23 基盤に委譲。§2.2 の未実測項目は全て該当タスクの Step 1 に割当済み。
- 型・コマンド名は spec §3 と一致(apigw_* / cfn_* / sfn_* 等のプレフィックス統一)。
