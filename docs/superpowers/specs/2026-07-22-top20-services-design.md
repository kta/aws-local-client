# Top20 残り 15 サービスのフルコンソール化 設計

- 日付: 2026-07-22
- ステータス: 承認済み(設計 = Fable、実装 = Opus サブエージェント × git worktree 並列)
- 依存: **PR #23**(kumo capability ゲート、`feature/kumo-emulator-capability-gates`)。
  本設計は PR #23 の `e2e/helpers/capabilities.ts`(`gate()` / AND ゲート則 / 対称性ルール /
  カバレッジガード)と 4 エミュレータハーネスの上に成立する。統合ブランチは
  PR #23 マージ後の `develop` を基点にする(未マージなら PR ブランチを基点にし、
  マージ後に rebase)。
- 関連: `2026-07-14-shared-components-and-service-extensibility-design.md` §3.6(サービス追加手順)、
  `2026-07-22-kumo-emulator-capability-gates-design.md`(ゲート 3 原則)

## 1. スコープ

利用ランキング Top20 のうち未対応の 15 サービス(レジストリ ID では 16 個)を
**フル機能**(既存 SQS/SNS/RDS 級 = ダッシュボード + 主リソース CRUD + 詳細タブ +
実行/送信系)で追加し、**localstack:3 / floci / ministack / kumo の 4 エミュレータ**で
E2E green にする。

対象(レジストリ ID): `lambda` `api-gateway` `cognito` `eventbridge` `secrets-manager`
`elasticache` `cloudformation` `ecs` `ecr` `cloudwatch` `step-functions` `opensearch`
`athena` `msk` `ssm` `route53`

- `cloudwatch-logs` の coming-soon エントリは `cloudwatch` に統合して**削除**する。
- 対象 16 ID を coming-soon から enabled へ昇格。アイコンは全 ID 取得済み(icons.ts 変更不要)。
- マージ形態: 統合ブランチ `feature/top20-services` → **一括 1 PR**。

## 2. 実測 capability マトリクス(2026-07-22、probe.sh による)

プローブ方法: AWS CLI v2 + 生 HTTP。docker.sock **非**マウントのコンテナに対する実測。
○=動作、×=非対応(unsupported 系エラー)、△=部分/条件付き。

| 操作ファミリ | localstack:3 | floci | ministack | kumo |
| --- | --- | --- | --- | --- |
| Lambda list/create/delete | ○ | ○ | ○ | ○ |
| Lambda invoke | ×(docker.sock 必須。マウント時 ○) | ○ | ○ | ×(no runtime handler) |
| API Gateway v1(REST) | ○ | ○ | ○ | ○ |
| Cognito user pools | ×(Pro) | ○ | ○ | ○ |
| EventBridge(bus/rule) | ○ | ○ | ○ | ○ |
| Secrets Manager | ○ | ○ | ○ | ○ |
| ElastiCache | ×(Pro) | △(redis は CreateReplicationGroup 経由。CreateCacheCluster は memcached のみ) | ○ | ○ |
| CloudFormation(create/list/resources) | ○ | ○ | ○ | △(ListStackResources が非 XML 応答 → 実装時に SDK で再検証) |
| ECS | ×(Pro) | ○ | ○ | ○ |
| ECR | ×(Pro) | △(create は docker.sock 必須) | ○ | ○ |
| CloudWatch Logs | ○ | ○ | ○ | ○ |
| CloudWatch Metrics/Alarms | △(**旧 Query プロトコルなら○**、新 SDK の CBOR は 500) | ○ | ○ | × |
| Step Functions(create/exec) | ○ | ○ | ○ | ○ |
| OpenSearch domain | ○ | △(create は docker.sock 必須) | ○ | × |
| Athena | ×(Pro) | ○(DuckDB 実 SQL) | ○(結果はモック) | △(query ○ / workgroups ×) |
| MSK | ×(Pro) | ○(Redpanda) | △(list のみ実証、create 未実測) | × |
| SSM Parameter Store | ○ | ○ | ○ | ○ |
| Route 53(zone/record) | ○ | ○ | ○ | ○ |

### 2.1 横断の技術的発見と対応(案 A: 最大実動、オーナー承認済み)

1. **CloudWatch Metrics/Alarms のプロトコル問題**: 新しい AWS SDK/CLI は CloudWatch を
   smithy-rpc-v2-cbor で叩き、localstack:3 は `Operation detection failed` の 500 を返す。
   旧 Query プロトコル(`Action=ListMetrics&Version=2010-08-01` の form POST)なら
   localstack:3 でも動作することを実測確認済み。
   → **実装手順**: まず最新 `aws-sdk-cloudwatch` を localstack:3 に対して実測。
   Query を話すなら SDK をそのまま使う。CBOR なら `commands/cloudwatch_query.rs` に
   旧 Query プロトコルの薄い HTTP クライアント(`reqwest` + `quick-xml`)を実装する
   (E2E の `capabilities.ts` の `rdsQuery` と同じ発想)。E2E 側プローブも同様に
   生 HTTP(`monitoring` サービス、`api/monitoring` UA トークン)で書く。
2. **docker.sock マウント**: `scripts/emulator.sh` の **localstack / floci** の
   `docker run` に `-v /var/run/docker.sock:/var/run/docker.sock` を追加
   → localstack:3 の Lambda invoke、floci の ECR create / OpenSearch create が実動する。
   ministack / kumo は不要(in-process 実行)。CI(ubuntu ランナー)でも有効。
   capability ゲートは安全網としてそのまま維持する(socket が無い環境でも green)。
3. **zip / ファイルアップロード**: Lambda 関数・レイヤーの zip は S3 で確立済みの
   **パス方式**(tauri-plugin-dialog + `window.__E2E_UPLOAD_PATH` シーム、Rust が
   パスからバイト列を読む)を踏襲する。base64 経路は作らない。
4. **kumo の既知の癖**(PR #23 の設計より): アクション名の多義性解決に UA の
   `api/<service>` トークンが必要(SDK は自動送出)/ Query プロトコル系エラーを
   JSON で返す(error.rs の生ボディ付与で対応済み)/ QueueUrl 系はポート 4566 固定。

### 2.2 未実測項目(各サービス実装の冒頭で必ずプローブする)

API Gateway の API キー・ステージ/デプロイ、Cognito のアプリクライアント/グループ、
EventBridge の PutEvents→SQS ターゲット実配信、Secrets の削除猶予/復元、
CFN の UpdateStack/ListExports、ECS の service/run-task、ECR list-images、
CW Logs の FilterLogEvents、SFN の GetExecutionHistory、Athena の NamedQuery、
MSK の CreateCluster(最小パラメータ)、Route 53 のヘルスチェック。
**手順**: 本設計の probe.sh 方式(scratchpad に残置)で 4 エミュレータに実測 →
結果を capability ID / ゲートに反映してからテストを書く。憶測でゲートを書かない。

## 3. サービス別仕様(サイドバー / 機能 / R-id)

サイドバー構成は 2025-2026 年の実 AWS コンソール(日本語)の調査に基づく。
日本語ラベルは AWS 日本語コンソールの実表記に合わせる。
R-id は R51〜R98(48 個)。各 R-id の仕様文は `e2e/SPEC-COVERAGE.md` に同文で追記する。

共通規約(全サービス):
- `features/<id>/service.tsx` で ServiceDefinition 自己申告(nav testid は `nav-<slug>`)。
- ダッシュボードは `SummaryCards` + 主リソース一覧 + クイックアクション(既存 SQS 型)。
- 削除は `ConfirmDangerModal`(名前タイプ一致)。一覧は `DataTable`、取得は
  `useProfileScopedFetch`。エラーは `ErrorBanner`、非対応は `<id>-unsupported` バナー
  (amber、既存 RDS 文体)+ 作成系アクション非表示。
- SecureString / シークレット値は既定で伏せ字、明示トグルで表示。

### 3.1 Lambda `/lambda`(R51–R55)

ナビ: ダッシュボード `/lambda` / 関数 `/lambda/functions` / レイヤー `/lambda/layers`

- R51: ダッシュボード(関数数 / レイヤー数 / 合計コードサイズのサマリ + 関数一覧 +
  「関数を作成」クイックアクション)
- R52: 関数一覧(名前/ランタイム/ハンドラ/更新日時)・作成(名前・ランタイム
  python/nodejs 系・ハンドラ・zip パスシーム。ロールは dummy ARN 自動設定)・
  削除(名前確認)。SDK 検証付き
- R53: 関数詳細タブ「概要」(ランタイム/ハンドラ/メモリ/タイムアウト/環境変数)・
  「設定」編集(メモリ・タイムアウト・環境変数 → SDK 検証)・「コード」zip 再アップロード
  (UpdateFunctionCode → CodeSha256 変化を SDK 検証)
- R54: 「テスト」タブ: JSON ペイロード入力 → Invoke(LogType=Tail)→ ステータス
  コード・レスポンスペイロード・末尾ログ(base64 デコード)表示。
  cap `lambda.invoke` でゲート。非対応側(kumo)は invoke 実行でエラーバナーの対称テスト
- R55: レイヤー一覧・公開(zip パスシーム + 互換ランタイム)・バージョン削除(確認付き)

Rust `commands/lambda.rs`(SDK: aws-sdk-lambda):
`lambda_list_functions` `lambda_get_function` `lambda_create_function`
`lambda_update_function_code` `lambda_update_function_config` `lambda_delete_function`
`lambda_invoke` `lambda_list_layers` `lambda_publish_layer_version` `lambda_delete_layer_version`

### 3.2 API Gateway `/api-gateway`(R56–R59)

ナビ: ダッシュボード `/api-gateway` / API `/api-gateway/apis` / API キー `/api-gateway/api-keys`

- R56: ダッシュボード(API 数 / API キー数)+ API 一覧・作成(名前・説明)・削除(名前確認)
- R57: API 詳細「リソース」タブ: リソースツリー表示(パス階層)・リソース作成
  (親選択 + pathPart)・メソッド作成(GET/POST/… × 統合タイプ MOCK / AWS_PROXY(Lambda ARN
  指定))→ SDK 検証
- R58: 「ステージ」タブ: デプロイ作成(ステージ名)→ ステージ一覧表示。
  invoke URL は `<endpoint>/restapis/<apiId>/<stage>/_user_request_<path>` 形式の
  参考表示(実測でエミュレータ毎に検証し、非対応エミュレータでは表示を省略してよい)
- R59: API キー CRUD(一覧・作成・削除)。実装冒頭のプローブで非対応エミュレータが
  あれば cap `apigateway.apiKeys` でゲート + 対称テスト

Rust `commands/apigateway.rs`(SDK: aws-sdk-apigateway):
`apigw_list_apis` `apigw_create_api` `apigw_delete_api` `apigw_get_resources`
`apigw_create_resource` `apigw_put_method` `apigw_create_deployment` `apigw_list_stages`
`apigw_list_api_keys` `apigw_create_api_key` `apigw_delete_api_key`

### 3.3 Cognito `/cognito`(R60–R62)

ナビ: ダッシュボード `/cognito` / ユーザープール `/cognito/user-pools`

- R60: プール一覧・作成(名前)・削除(名前確認)+ ダッシュボード(プール数 / 総ユーザー数)。
  **localstack:3 は Pro 専用** → cap `cognito.userPools` で `cognito-unsupported` バナー
  + 作成非表示の対称テスト
- R61: プール詳細「ユーザー」タブ: AdminCreateUser(ユーザー名・メール・一時パスワード)
  → 一覧(ステータス/有効)→ パスワード設定(permanent)→ 無効化/有効化 → 削除。SDK 検証
- R62: 「アプリクライアント」タブ(作成・一覧・削除、clientId 表示)+
  「グループ」タブ(作成・一覧・削除)

Rust `commands/cognito.rs`(SDK: aws-sdk-cognitoidentityprovider):
`cognito_list_user_pools` `cognito_create_user_pool` `cognito_delete_user_pool`
`cognito_get_user_pool` `cognito_list_users` `cognito_admin_create_user`
`cognito_admin_set_user_password` `cognito_admin_enable_user` `cognito_admin_disable_user`
`cognito_admin_delete_user` `cognito_list_user_pool_clients` `cognito_create_user_pool_client`
`cognito_delete_user_pool_client` `cognito_list_groups` `cognito_create_group` `cognito_delete_group`

### 3.4 EventBridge `/eventbridge`(R63–R65)

ナビ: ダッシュボード `/eventbridge` / イベントバス `/eventbridge/buses` / ルール `/eventbridge/rules`

- R63: バス一覧(default 含む)・作成・削除(名前確認)+ ダッシュボード(バス数 / ルール数)
- R64: ルール一覧(バス選択セレクタ)・作成(名前 + スケジュール式 or イベントパターン
  JSON)・有効/無効トグル・削除・ターゲット追加/削除(SQS キュー ARN)→ SDK 検証
- R65: 「イベントを送信」: バス・source・detail-type・detail(JSON)を入力して
  PutEvents → **ルール(パターン一致)経由で SQS ターゲットに実配信されたことを
  SDK receive で検証**(SNS R28 と同型の実配信テスト。flake 対策のリトライも同型)

Rust `commands/eventbridge.rs`(SDK: aws-sdk-eventbridge):
`events_list_buses` `events_create_bus` `events_delete_bus` `events_list_rules`
`events_put_rule` `events_delete_rule` `events_enable_rule` `events_disable_rule`
`events_list_targets` `events_put_target` `events_remove_target` `events_put_events`

### 3.5 Secrets Manager `/secrets-manager`(R66–R67)

ナビ: シークレット `/secrets-manager/secrets`(単独ナビ・S3 型、ダッシュボード無し)

- R66: 一覧(名前/説明/更新日時)・作成(名前・値・説明)・削除
  (**即時(ForceDelete)/ 猶予日数** の選択 UI。名前確認)。SDK 検証
- R67: 詳細: 値の取得と**伏せ字表示 ⇄ 表示トグル**・値の更新(PutSecretValue →
  新バージョン)・バージョン一覧(VersionId / ステージ)・タグ追加/削除

Rust `commands/secretsmanager.rs`(SDK: aws-sdk-secretsmanager):
`secrets_list` `secrets_create` `secrets_get_value` `secrets_put_value`
`secrets_list_versions` `secrets_delete` `secrets_tag` `secrets_untag` `secrets_describe`

### 3.6 ElastiCache `/elasticache`(R68–R70)

ナビ: ダッシュボード `/elasticache` / キャッシュ `/elasticache/caches`

- R68: ダッシュボード(キャッシュ数 / エンジン別内訳)+ 統合一覧
  (ReplicationGroup + CacheCluster を 1 テーブルに。ID/エンジン/ステータス/ノード数/
  エンドポイント)
- R69: 作成(エンジン redis|valkey|memcached・ノードタイプ・ノード数。
  **redis/valkey → CreateReplicationGroup、memcached → CreateCacheCluster**
  = floci 実測仕様)→ エンドポイント表示 → 削除(名前確認)。SDK 検証
- R70: **localstack:3 は Pro 専用** → cap `elasticache.describe` で
  `elasticache-unsupported` バナー + 作成非表示の対称テスト

Rust `commands/elasticache.rs`(SDK: aws-sdk-elasticache):
`elasticache_list_caches`(2 API をマージした統合 wire 型)`elasticache_create_cache`
`elasticache_delete_cache` `elasticache_get_cache`

### 3.7 CloudFormation `/cloudformation`(R71–R74)

ナビ: ダッシュボード `/cloudformation` / スタック `/cloudformation/stacks`

- R71: ダッシュボード(スタック数 / ステータス内訳)+ スタック一覧(名前/ステータス/作成日時)
- R72: スタック作成(テンプレート JSON/YAML のテキストエリア + パラメータ key/value 行)→
  ステータスが CREATE_COMPLETE になる → **テンプレート内リソース(SNS トピック等)が
  実際に生成されたことを SDK で裏取り**
- R73: スタック詳細タブ: リソース / 出力 / パラメータ / イベント / テンプレート(表示)。
  kumo の ListStackResources 非 XML 応答は実装時に SDK 実測し、必要なら
  cap `cloudformation.resources` でタブ単位ゲート + 対称テスト
- R74: スタック更新(テンプレート変更 → UpdateStack → SDK 検証)+ 削除(名前確認 →
  一覧から消滅 + リソースも削除されたことを SDK 検証)

Rust `commands/cloudformation.rs`(SDK: aws-sdk-cloudformation):
`cfn_list_stacks` `cfn_create_stack` `cfn_update_stack` `cfn_delete_stack` `cfn_get_stack`
`cfn_list_resources` `cfn_list_events` `cfn_get_template` `cfn_list_exports`

### 3.8 ECS `/ecs`(R75–R77)

ナビ: ダッシュボード `/ecs` / クラスター `/ecs/clusters` / タスク定義 `/ecs/task-definitions`

- R75: クラスター一覧(名前/ステータス/サービス数/タスク数)・作成・削除(名前確認)+
  ダッシュボード。**localstack:3 は Pro 専用** → cap `ecs.clusters` で
  `ecs-unsupported` バナー対称テスト
- R76: タスク定義: JSON(containerDefinitions)で登録・ファミリー一覧・リビジョン詳細・
  登録解除。SDK 検証
- R77: クラスター詳細: サービス(作成: タスク定義 + desiredCount、desired 変更、削除)+
  タスク一覧(RunTask 実行 → 一覧表示 → StopTask)。floci/ministack は実コンテナ起動が
  走るため、E2E は軽量イメージ(公式ドキュメントの busybox 等)を使い必ず Stop まで面倒を見る

Rust `commands/ecs.rs`(SDK: aws-sdk-ecs):
`ecs_list_clusters` `ecs_create_cluster` `ecs_delete_cluster` `ecs_list_task_definitions`
`ecs_register_task_definition` `ecs_describe_task_definition` `ecs_deregister_task_definition`
`ecs_list_services` `ecs_create_service` `ecs_update_service` `ecs_delete_service`
`ecs_list_tasks` `ecs_run_task` `ecs_stop_task`

### 3.9 ECR `/ecr`(R78–R79)

ナビ: リポジトリ `/ecr/repositories`(単独ナビ)

- R78: リポジトリ一覧(名前/URI/作成日時)・作成・削除(名前確認、force オプション)。
  URI のコピーアクション。SDK 検証
- R79: リポジトリ詳細: イメージ一覧(タグ/ダイジェスト/サイズ/push 日時。空でも表を表示)。
  cap ゲート: localstack `ecr.repositories` ×(unsupported バナー)、
  floci の create は docker.sock 前提 → `ecr.create` を分離ゲート + 対称テスト

Rust `commands/ecr.rs`(SDK: aws-sdk-ecr):
`ecr_list_repositories` `ecr_create_repository` `ecr_delete_repository` `ecr_list_images`

### 3.10 CloudWatch `/cloudwatch`(R80–R83)

ナビ: ダッシュボード `/cloudwatch` / ロググループ `/cloudwatch/log-groups` /
メトリクス `/cloudwatch/metrics` / アラーム `/cloudwatch/alarms`

- R80: ロググループ一覧(名前/保持期間/サイズ)・作成・削除(名前確認)+
  ダッシュボード(ロググループ数 / アラーム数)
- R81: ロググループ詳細: ストリーム一覧 → ストリーム内イベント閲覧(SDK で seed した
  イベントが UI に出る)+ フィルタパターン検索(FilterLogEvents)
- R82: メトリクス: 名前空間一覧 → メトリクス一覧 → 選択メトリクスの統計テーブル
  (GetMetricStatistics: 期間・統計 Average/Sum/Max)。SDK で PutMetricData した値が
  反映されることを検証。cap `cloudwatch.metrics`(kumo ×)+ 対称テスト
- R83: アラーム: 一覧(名前/状態/メトリクス)・作成(メトリクス・しきい値・比較演算子)・
  削除(確認付き)。cap `cloudwatch.alarms`(kumo ×)+ 対称テスト

Rust: Logs は `commands/cloudwatch.rs`(SDK: aws-sdk-cloudwatchlogs):
`cw_list_log_groups` `cw_create_log_group` `cw_delete_log_group` `cw_list_log_streams`
`cw_get_log_events` `cw_filter_log_events`
Metrics/Alarms は §2.1-1 の判定に従い SDK(aws-sdk-cloudwatch)または
`commands/cloudwatch_query.rs`(旧 Query プロトコル直叩き):
`cw_list_metrics` `cw_get_metric_statistics` `cw_describe_alarms` `cw_put_metric_alarm`
`cw_delete_alarms`

### 3.11 Step Functions `/step-functions`(R84–R86)

ナビ: ダッシュボード `/step-functions` / ステートマシン `/step-functions/state-machines`

- R84: ステートマシン一覧(名前/タイプ/作成日時)・作成(名前 + ASL JSON。ロールは
  dummy ARN 自動)・削除(名前確認)+ ダッシュボード。SDK 検証
- R85: 詳細「実行」タブ: 実行開始(JSON 入力)→ 実行一覧(ステータス)→ 実行詳細
  (ステータス / 入力 / 出力 / イベント履歴テーブル)。Pass ステートの ASL で
  出力 = 入力の伝播を検証
- R86: 「定義」タブ: ASL 表示 + 更新(UpdateStateMachine → SDK 検証)。
  **2026-07-22 実測: UpdateStateMachine は floci(UnsupportedOperation)/ kumo
  (InvalidAction)で非対応** → cap `sfn.updateStateMachine` でゲート + 対称テスト
  (非対応側は `sfn-update-unsupported` 案内文)。list/create/delete/describe と
  実行系(R84/R85)は 4 エミュレータ対応で無条件

Rust `commands/stepfunctions.rs`(SDK: aws-sdk-sfn):
`sfn_list_state_machines` `sfn_create_state_machine` `sfn_update_state_machine`
`sfn_delete_state_machine` `sfn_describe_state_machine` `sfn_start_execution`
`sfn_list_executions` `sfn_describe_execution` `sfn_get_execution_history`

### 3.12 OpenSearch `/opensearch`(R87–R88)

ナビ: ダッシュボード `/opensearch` / ドメイン `/opensearch/domains`

- R87: ドメイン一覧(名前/エンジンバージョン/ステータス)・作成(名前)・削除(名前確認)・
  詳細(エンドポイント URL / ステータス / 作成状況)。SDK 検証
- R88: cap ゲート: kumo `opensearch.domains` ×(unsupported バナー対称テスト)、
  floci の create は docker.sock 前提 → `opensearch.create` 分離ゲート
  (describe ○ / create × の中間ケースは「一覧は出るが作成でエラーバナー」を検証 =
  RDS R35 と同型)

Rust `commands/opensearch.rs`(SDK: aws-sdk-opensearch):
`opensearch_list_domains` `opensearch_create_domain` `opensearch_delete_domain`
`opensearch_get_domain`

### 3.13 Athena `/athena`(R89–R91)

ナビ: クエリエディタ `/athena` / 保存したクエリ `/athena/saved-queries` /
ワークグループ `/athena/workgroups`(エディタ主導 = DynamoDB PartiQL 画面と同型)

- R89: クエリエディタ: ステートメント入力 → 実行(StartQueryExecution →
  ステータスポーリング → GetQueryResults)→ 結果テーブル描画。
  **非同期実行**のため「実行中...」状態表示を持つ(PartiQL と異なる点)。
  cap `athena.query`。localstack:3 は Pro → サービス全体を
  `athena-unsupported` バナー(対称テスト)
- R90: ワークグループ CRUD(一覧・作成・削除)。cap `athena.workgroups`(kumo ×)+ 対称テスト
- R91: 保存したクエリ: NamedQuery の保存(エディタから「保存」)・一覧・呼び出し
  (エディタへ挿入)・削除

Rust `commands/athena.rs`(SDK: aws-sdk-athena):
`athena_start_query` `athena_get_query_execution` `athena_get_query_results`
`athena_list_workgroups` `athena_create_workgroup` `athena_delete_workgroup`
`athena_list_named_queries` `athena_create_named_query` `athena_delete_named_query`

### 3.14 MSK `/msk`(R92–R93)

ナビ: ダッシュボード `/msk` / クラスター `/msk/clusters`

- R92: クラスター一覧(名前/状態/ブローカー数/Kafka バージョン)・作成(名前・
  ブローカー数。BrokerNodeGroupInfo は最小構成を実測して決める)・削除(名前確認)・
  詳細(GetBootstrapBrokers のブローカー文字列表示 + コピー)。
  cap `kafka.clusters`(floci/ministack を実測で確定)
- R93: 非対応(localstack:3 = Pro、kumo)で `msk-unsupported` バナー + 作成非表示の対称テスト

Rust `commands/msk.rs`(SDK: aws-sdk-kafka):
`msk_list_clusters` `msk_create_cluster` `msk_delete_cluster` `msk_describe_cluster`
`msk_get_bootstrap_brokers`

### 3.15 Systems Manager `/ssm`(R94–R95)

ナビ: パラメータストア `/ssm/parameters`(単独ナビ。ノード管理系はローカルで無意味のため対象外)

- R94: パラメータ一覧(名前/タイプ/バージョン。パス prefix フィルタ入力)・作成
  (名前(`/path/形式`)・タイプ String|StringList|SecureString・値)・削除(名前確認)。SDK 検証
- R95: 詳細: 値表示(**SecureString は伏せ字 ⇄ 表示トグル**、WithDecryption)・
  値の更新(Overwrite → バージョン増加)・**バージョン履歴テーブル**(GetParameterHistory)

Rust `commands/ssm.rs`(SDK: aws-sdk-ssm):
`ssm_list_parameters` `ssm_get_parameter` `ssm_put_parameter` `ssm_delete_parameter`
`ssm_get_parameter_history`

### 3.16 Route 53 `/route53`(R96–R98)

ナビ: ダッシュボード `/route53` / ホストゾーン `/route53/hosted-zones` /
ヘルスチェック `/route53/health-checks`

- R96: ホストゾーン一覧(ドメイン名/タイプ/レコード数)・作成(ドメイン名)・削除
  (名前確認)+ ダッシュボード(ゾーン数 / ヘルスチェック数)。SDK 検証
- R97: ゾーン詳細: レコード一覧(NS/SOA 含む)・レコード作成(名前・タイプ
  A/AAAA/CNAME/TXT/MX・TTL・値(複数行))・編集(UPSERT)・削除。SDK 検証
- R98: ヘルスチェック: 一覧・作成(IP/ドメイン・ポート・タイプ HTTP/TCP・パス)・削除
  (確認付き)。実装冒頭プローブで非対応エミュレータがあれば cap `route53.healthChecks`
  でゲート + 対称テスト

Rust `commands/route53.rs`(SDK: aws-sdk-route53):
`route53_list_hosted_zones` `route53_create_hosted_zone` `route53_delete_hosted_zone`
`route53_list_record_sets` `route53_change_record_set`(CREATE|UPSERT|DELETE)
`route53_list_health_checks` `route53_create_health_check` `route53_delete_health_check`

## 4. E2E 設計

- サービス毎に `e2e/specs/<id>.e2e.ts`(15 ファイル、R51–R98)。
- 全テストは既存流儀の**両面検証**: SDK で seed → UI 操作 → SDK で裏取り
  (受信/存在/属性一致)。UI 表示だけで green にしない。
- capability 分岐は PR #23 の 3 原則を必須とする:
  1. **AND ゲート則**(テストが叩く全操作の AND でゲート)
  2. **対称性ルール**(supported 側と unsupported 側は必ず対で書く)
  3. **カバレッジガード**(spec の `after` で `expectCovered` — どのエミュレータでも
     全 R-id が最低 1 テスト実行)
- 新規 capability ID は `capabilities.ts` に追記(プローブは `isUnsupportedError` 一元判定、
  NotFound = 実装あり、その他エラーは throw)。CloudWatch Metrics のプローブは
  生 Query HTTP(§2.1-1)。
- `helpers/aws.ts` にクライアントファクトリを追加。devDependencies に
  `@aws-sdk/client-{lambda, api-gateway, cognito-identity-provider, eventbridge,
  secrets-manager, elasticache, cloudformation, ecs, ecr, cloudwatch-logs, cloudwatch,
  sfn, opensearch, athena, kafka, ssm, route-53}` を追加。
- Windows/行アクションの既知 flake 対策(`clickEnabledT` / リトライクリック / 実配信リトライ)
  を新サービスにも適用する。
- `e2e/SPEC-COVERAGE.md` に R51–R98 の行 + capability 脚注を**同一変更で**追記(規約)。

## 5. 実装体制(Opus × git worktree 並列、統合 = Fable)

### 5.0 準備(統合ブランチ上で先行 1 コミット、競合削減)

- [ ] `feature/top20-services` を作成(基点: PR #23 マージ後の develop)
- [ ] `src-tauri/Cargo.toml` に 16 SDK クレート(+ 必要なら reqwest/quick-xml)を一括追加
- [ ] `package.json` devDependencies に 17 の `@aws-sdk/client-*` を一括追加(`npm i` で lockfile 更新)
- [ ] `scripts/emulator.sh`: localstack/floci に docker.sock マウント追加
- [ ] `src/services/registry.ts` の該当 coming-soon 16 ID に `// wave N` コメントを付す
  (enabled 化は各サービス実装が行う)。`cloudwatch-logs` エントリ削除
- [ ] probe.sh を `scripts/probe-services.sh` として整備(各エージェントの実測プローブ用)

### 5.1 ウェーブ構成(各ウェーブ内は worktree 並列、ウェーブ毎に統合 → 全チェック green)

| Wave | サービス(担当エージェント数) | 補足 |
| --- | --- | --- |
| 1 | Lambda / API Gateway / Secrets Manager / SSM(4) | APIGW の Lambda 統合は同 wave の Lambda を利用 |
| 2 | EventBridge / Step Functions / CloudWatch(3) | CW は横断①(Query プロトコル判定)含む |
| 3 | Cognito / CloudFormation / Route 53(3) | |
| 4 | ECS / ECR / ElastiCache(3) | |
| 5 | Athena / OpenSearch / MSK(3) | |

### 5.2 各サービス実装エージェントの作業手順(テンプレート、Opus 向け)

1. **プローブ**: `scripts/probe-services.sh` で担当サービスの全予定操作を
   4 エミュレータに実測(§2.2 の未実測項目を解消)。結果を capability ゲート表に確定
2. **TDD**: Rust 単体テスト(wire 契約 serde roundtrip / ヘルパ)→ `commands/<id>.rs` 実装 →
   `lib.rs` の `generate_handler!` 追記
3. `src/api/<id>.ts` + `types` 追加(**camelCase wire 契約は両側同時**)
4. `src/features/<id>/`: service.tsx + ページ実装(共通 UI プリミティブ使用、
   ui-mock.html 準拠、日本語 UI コピー)+ colocated vitest
5. `src/services/registry.ts` の自サービス行を enabled 定義へ差し替え
6. `e2e/specs/<id>.e2e.ts` + `capabilities.ts` 追記 + `SPEC-COVERAGE.md` 行追加
7. 完了条件: 全チェックブロック green + 担当サービス E2E を**最低 2 エミュレータ**
   (ministack + もう 1 種、非対応分岐があるサービスは localstack か kumo を含める)で
   ローカル green
8. コミットは Conventional Commits(`feat(lambda): ...`)。共有ファイル
   (registry.ts / lib.rs / client.ts / SPEC-COVERAGE.md)の変更は自サービス行のみに留める

### 5.3 統合とリリース(Fable)

- ウェーブ毎に worktree ブランチを統合ブランチへマージ(共有 5 ファイルの競合は統合者が解消)
- 全ウェーブ統合後: 4 エミュレータ × フル E2E スイートをローカル実行して全 green 確認
- 1 PR(`feature/top20-services` → develop)→ CI green → merge(自律実行可の標準フロー)
- 本設計と `AGENTS.md` の記述(対応サービス)を PR 内で更新

## 6. やらないこと(非目標)

- MSK のトピック管理(Kafka クライアント直結 = rdkafka 等の重依存)
- Cognito ID プール / ホスト UI・OAuth フロー
- EventBridge Scheduler / Pipes / アーカイブ・リプレイ(別 ID として coming-soon のまま)
- CloudWatch のダッシュボード作成機能・X-Ray・Insights 系
- SSM のノード管理(セッションマネージャー等)・Run Command・Documents
- Route 53 ドメイン登録・リゾルバー・トラフィックフロー
- OpenSearch の検索/インデックス UI(本家も OpenSearch Dashboards という別物)
- CFN StackSets / IaC ジェネレーター、ECS Anywhere、Lambda コード署名 / SnapStart
- ConnectionProfile へのエミュレータ種別フィールド追加(endpoint + ランタイム検出モデル維持)
- ダークテーマ / 視覚リデザイン(Light theme only、ui-mock.html 準拠は不変)

## 7. 完了条件

1. `npx tsc --noEmit && npx vitest run && (cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test)` green
2. E2E フルスイート(R1–R98)が **localstack:3 / floci / ministack / kumo の 4 種**で
   ローカル green(カバレッジガードにより全 R-id がどのエミュレータでも最低 1 テスト実行)
3. `e2e/SPEC-COVERAGE.md` 100%(R51–R98 全行にテスト対応)
4. CI(ci.yml / e2e.yml / build.yml)green → merge

## 8. 実装時の確定事項(統合フェーズで確定)

設計から変わった点・実装で確定した事項。統合 E2E(ministack / localstack:3 / floci の
3 種をローカル green、kumo は CI 検証)で判明したエミュレータ差分を含む。

### 8.1 追加した capability(`e2e/helpers/capabilities.ts`)

設計時に想定した以上に、操作単位のゲートを追加した(対称な unsupported 側テスト + カバレッジ付き):

- `apigateway.apiKeys` / `apigateway.apiKeyDelete` — API キーの作成/一覧と削除を分離。
- `cognito.userPools` / `cognito.groups` / `cognito.adminUserState` — プール・グループ・
  ユーザー有効/無効トグルを分離。
- `secretsmanager.tags` — タグ変更 API の有無。
- `sfn.updateStateMachine` — 定義更新の可否。
- `athena.query` / `athena.workgroups` / `athena.namedQueries`。
- `cloudformation.resourceCreation` — CREATE 時にテンプレートのリソースを実プロビジョンするか。
- `cloudformation.resourceReplacement`(新規) — **localstack:3 は UPDATE_COMPLETE に達しても
  置換リソースを再プロビジョンしない**ため、create->update->置換確認まで回すプローブで判定。
- `rds.instances.stopStart`(新規) — **floci は StopDBInstance/StartDBInstance を
  UnsupportedOperation で拒否**する。
- `rds.instances.modifyApplies`(新規) — **floci は ModifyDBInstance を受理するが
  AllocatedStorage を適用しない**(create->modify->反映確認のフルサイクルで判定)。
- `rds.instances.create` プローブはフルスイート負荷下の一過性失敗を誤検知しないようリトライ化。

### 8.2 エミュレータ差分と対処

- **CloudWatch は legacy Query プロトコル**(`Action=...&Version=2010-08-01`、`monitoring` サービス、
  `src-tauri/src/commands/cloudwatch_query.rs`)で実装。モダン SDK の smithy-rpc-v2-cbor を
  localstack:3 が拒否するため。メトリクス/アラームは SDK クライアントを持たせない。
- **リージョンスコープ整合**: 一部エミュレータ(ministack 等)は CloudWatch を
  credential-scope のリージョンで分割保存する。テストの生 Query ヘルパ(`awsQuery`)は
  ハードコードの us-east-1 ではなく **アプリ接続と同じ `E2E_REGION`** を使う必要がある。
- **GetMetricStatistics** はローカルの時計ずれ/現在期間の部分点を strict な EndTime から
  漏らさないよう、アプリ側で EndTime を数分先まで広げて問い合わせる。
- **Secrets Manager**: 削除猶予中(DeletedDate 付き)のシークレットは ListSecrets に残る
  (localstack:3、AWS 準拠)。コンソール一覧では除外して「削除済み」として扱う。
- **Lambda Layers**: localstack:3 は ListLayers を 500 "list index out of range" で返す。
  アプリ側バナー判定と capability プローブの双方で layers-unsupported として扱う。
- **Athena**: クエリ実行は結果出力先バケットが前提。テストは事前に results バケットを用意する。
- **floci CFN は stack Parameters を返さない**ため、R73 は resources/outputs/template のみ
  堅く検証し、parameters/events タブはレンダー確認に留める。
- **MSK(floci = Redpanda)**: クラスタは作成後 ~2s で ACTIVE。一覧はマウント時 1 回フェッチのため、
  E2E は再ナビゲートで状態遷移を観測する。

### 8.3 統合時の共有ファイル方針

- coming-soon 一覧は、実装済みサービス ID を実行時に必ず除外(registry の防御的フィルタ)。
- 無条件テスト(ゲートなし)の R-id は `markCovered` を明示呼び出し。ある capability 下でのみ
  意味を持つファミリは `expectCoveredIf` / `expectCoveredUnless` を使う。
