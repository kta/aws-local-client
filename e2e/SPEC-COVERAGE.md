# E2E 仕様トレーサビリティ表(SPEC-COVERAGE)

Phase 1 スペック + UI 改訂 + Phase 3(ダッシュボード / PartiQL / バックアップ)+
Phase 2(SQS / SNS / S3 / RDS)+ サービスコンソール拡充(R36〜R50)+ Top20 サービス拡充
(R51〜R98、本タスクは Cognito R60〜R62)から抽出した要件 ID と、
それを検証する E2E テストの対応表。
**全行に最低 1 テストが対応していること**が完了条件。仕様要件を変更した場合は
`docs/superpowers/specs/` と本表を同じ変更で更新すること。

テストは実バイナリ(`npm run e2e:build`)を WebdriverIO の Tauri 埋め込みドライバで起動し、
`E2E_ENDPOINT`(既定 `http://localhost:4566`)のエミュレータに対して実行する。同一スイートを
LocalStack / floci / ministack / kumo の 4 種に対して実行して緑を確認している。

エミュレータごとの API 対応差は **capability ゲート**(`e2e/helpers/capabilities.ts`)で吸収する:
分岐するテストは自分が叩く操作の対応可否を実機プローブで宣言的に判定し(`gate()`)、
supported 側(実フロー検証)と unsupported 側(バナー / エラー UI 検証)が対で存在する。
各 spec の `after` のカバレッジガードが「その要件ファミリのテストが最低 1 本実行されたこと」を
アサートするため、どの capability の組み合わせでも要件が無検証のまま green になることはない。
詳細設計: `docs/superpowers/specs/2026-07-22-kumo-emulator-capability-gates-design.md`。

| 要件ID | 仕様文(1行) | テスト(ファイル#テスト名) |
| --- | --- | --- |
| R1 | 接続プロファイルの手動登録(既定 4566/ap-northeast-1/dummy)・編集・削除 | connections.e2e.ts#R1: registers a connection using the default field values / R1: edits an existing connection's name / R1: deletes a connection (with confirmation) |
| R2 | 自動検出(スキャンボタン → 検出結果から追加) | connections.e2e.ts#R2: detects the running emulator via スキャン and adds it |
| R3 | 接続切替(「この接続を使う」→ ホーム遷移、ヘッダーのセレクタ切替、接続色の反映) | connections.e2e.ts#R3: switches connection via use-button and header selector, reflecting color |
| R4 | テーブル一覧(名前・ステータス・PK/SK・インデックス数の表示) | tables.e2e.ts#R4: lists tables with name, status, keys and index count |
| R5 | テーブル作成(PK のみ / PK+SK / GSI 付き) | tables.e2e.ts#R5: creates a table with a partition key only / R5: creates a table with partition and sort keys / R5: creates a table with a GSI [^gsi] |
| R6 | テーブル削除(名前入力確認、一覧からの選択削除) | tables.e2e.ts#R6: deletes a table from the list (name confirmation) / R6: deletes a table from its detail page (name confirmation modal) |
| R7 | Scan(フィルタなし / 属性フィルタ =・contains) | items.e2e.ts#R7: scans a table with no filter / R7: scans with an attribute filter (=) / R7: scans with an attribute filter (contains) |
| R8 | Query(PK 指定、SK begins_with / =、GSI 指定) | items.e2e.ts#R8: queries by partition key / R8: queries with sort key begins_with / R8: queries with sort key = / R8: queries against a GSI [^gsi] |
| R9 | ページネーション(50件超で次へ/前へ、ページ番号) | items.e2e.ts#R9: paginates forward and back across 50+ items |
| R10 | アイテム作成(通常 JSON エディタ) | items.e2e.ts#R10: creates an item with the plain JSON editor |
| R11 | アイテム編集(通常 JSON ⇔ DynamoDB JSON トグル、保存) | items.e2e.ts#R11: edits an item and toggles plain <-> DynamoDB JSON |
| R12 | アイテム削除(チェック選択→アクション→削除、確認付き) | items.e2e.ts#R12: deletes an item via selection and the actions menu |
| R13 | エラーハンドリング(到達不能エンドポイントで接続エラーバナー + 再試行) | connections.e2e.ts#R13: shows an error banner with retry for an unreachable endpoint |
| R14 | 初期画面が接続管理、プロファイル 0 件時に他画面へ行けない | connections.e2e.ts#R14: boots into 接続管理 and blocks navigation while zero profiles exist |
| R15 | テーブル詳細: 概要タブ(PK/SK/容量モード/ステータス/項目数)・インデックスタブ(GSI/LSI) | tables.e2e.ts#R15: shows the overview tab (PK/SK, capacity, status, item count) / R15: shows the indexes tab with GSI/LSI sections |
| R16 | 「テーブルの項目を探索」ボタン → explore 画面へ ?table= 付き遷移 | tables.e2e.ts#R16: opens the item explorer with ?table= for the table |
| R17 | ヘッダーのリージョンセレクタでアクティブ接続のリージョン変更(永続化 + テーブル一覧の再取得) | connections.e2e.ts#R17: changes region from the header, persists it, and refetches tables |
| R18 | ダッシュボード: サマリ(テーブル数 / 合計アイテム数)が SDK 投入状態と一致・行クリックで詳細へ・「テーブルを作成」で /dynamodb/tables に作成モーダルを開いて遷移・サイドバー nav-dashboard で到達 | dashboard.e2e.ts#R18: shows a summary matching the SDK-seeded state / R18: navigates to table detail when a row is clicked / R18: 'テーブルを作成' quick action opens the create modal on the tables page / R18: sidebar nav-dashboard reaches the dashboard |
| R19 | PartiQL: テンプレート選択で `SELECT * FROM "<table>"` 挿入・SELECT で行描画・INSERT→SELECT で投入項目が出る(書込経路)・不正ステートメントでエラーバナー・ExecuteStatement 非対応エミュレータでは SELECT 実行でエラーバナー | partiql.e2e.ts#R19: template selector fills SELECT * FROM "<table>" / R19: runs a SELECT and renders the seeded rows / R19: INSERT then SELECT shows the inserted item (write path) / R19: an invalid statement shows the error banner / R19: a SELECT on a PartiQL-less emulator shows the error banner [^cap] |
| R20 | バックアップ(対応エミュレータ): UI で作成→行表示→新テーブルへ復元(SDK で存在+投入項目を検証)→確認付き削除で行消滅 | backups.e2e.ts#R20: creates a backup, restores it to a new table, then deletes it [^cap] |
| R21 | バックアップ非対応エミュレータ: `backups-unsupported` バナー表示 + 作成ボタン非表示 | backups.e2e.ts#R21: shows the unsupported banner and hides the create button [^cap] |
| R22 | SQS キュー一覧(SDK で 2 キュー seed → 名前・種別・メッセージ数概算の表示) | sqs.e2e.ts#R22: lists SDK-seeded queues with their (approximate) message count |
| R23 | SQS キュー作成(UI 作成 → SDK で属性検証)・属性編集(設定タブ → SDK 検証)・削除(名前入力確認) | sqs.e2e.ts#R23: UI create -> SDK verify attrs, UI edit -> SDK verify, UI delete |
| R24 | SQS メッセージ送信(UI 送信 + 属性 → SDK receive で本文・属性一致) | sqs.e2e.ts#R24: UI send -> SDK receive matches body and attribute |
| R25 | SQS メッセージ受信/削除/パージ(SDK send seed → UI ポーリング表示 → UI 削除 → SDK で消滅確認 → UI パージ → SDK で空確認) | sqs.e2e.ts#R25: UI poll shows seeded messages, UI delete one, UI purge empties it |
| R26 | SNS トピック作成/一覧/削除(名前入力確認、SDK で検証) | sns.e2e.ts#R26: UI creates, lists and deletes a topic |
| R27 | SNS SQS サブスクリプション追加(UI 追加 → 一覧表示 → SDK 検証)・解除(名前入力確認) | sns.e2e.ts#R27: UI adds an SQS subscription, shows it, then unsubscribes |
| R28 | SNS メッセージ発行(UI publish → SDK で SQS receive、envelope.Message 一致) | sns.e2e.ts#R28: UI publish is delivered to the subscribed SQS queue |
| R29 | S3 バケット作成/一覧/非空削除エラー/空削除 | s3.e2e.ts#R29: UI creates a bucket; non-empty delete errors, empty delete succeeds |
| R30 | S3 プレフィックスナビゲーション(SDK で `a/b.txt`,`a/c/d.txt`,`e.txt` seed → フォルダ移動・パンくず・`?prefix=`) | s3.e2e.ts#R30: navigates prefixes, breadcrumbs and ?prefix= |
| R31 | S3 オブジェクトのアップロード(パスシーム `__E2E_UPLOAD_PATH` → SDK GetObject 検証)/ダウンロード(`__E2E_SAVE_PATH` → ディスク内容検証) | s3.e2e.ts#R31/R46: uploads via the path seam (multipart-capable) and downloads to disk |
| R32 | S3 オブジェクト詳細パネル(メタデータ表示)・選択削除 | s3.e2e.ts#R32: shows object metadata and deletes it via selection |
| R33 | RDS(create 対応エミュレータ): UI 作成 → 一覧に `available` 表示 → UI 削除 | rds.e2e.ts#R33: UI creates an instance that becomes available, then deletes it [^cap] |
| R34 | RDS(describe 非対応エミュレータ): `rds-unsupported` バナー表示 + 作成ボタン非表示 | rds.e2e.ts#R34: shows the unsupported banner and hides the create action [^cap] |
| R35 | RDS(describe 可・create 不可エミュレータ): 一覧表示 + UI 作成でエラーバナー | rds.e2e.ts#R35: lists instances and surfaces an error when a create is rejected [^cap] |
| R36 | SQS ダッシュボード(`/sqs` 直下): SummaryCards(キュー数 / 可視 / 処理中 / FIFO)+ キュー一覧・「キューを作成」クイックアクションで作成モーダルを開いて遷移 | sqs.e2e.ts#R36: dashboard summarises seeded queues and quick action opens the create modal |
| R37 | SQS キュータグタブ: ListQueueTags 表示・行追加で TagQueue・行削除で UntagQueue | sqs.e2e.ts#R37: tags tab lists, adds and removes a queue tag |
| R38 | SQS デッドレタータブ: 自キューの RedrivePolicy 表示 + ソースキュー一覧(非対応エミュレータでは `dlq-sources-unsupported` 案内文) | sqs.e2e.ts#R38: dead-letter tab shows the redrive policy and source queues / R38: dead-letter tab shows the unsupported notice for source queues [^cap] |
| R39 | SNS ダッシュボード(`/sns` 直下): SummaryCards(トピック数 / サブスクリプション総数 / FIFO トピック数)+ トピック一覧・「トピックを作成」クイックアクションで作成モーダルを開いて遷移 | sns.e2e.ts#R39: dashboard summarises seeded topics and quick action opens the create modal |
| R40 | SNS 横断サブスクリプション一覧(`/sns/subscriptions`): ListSubscriptions を表で表示・行選択で解除(確認付き、`PendingConfirmation` は解除不可) | sns.e2e.ts#R40: cross-topic list shows a seeded subscription and can unsubscribe it |
| R41 | SNS トピック属性タブ: GetTopicAttributes 主要属性表示・DisplayName のみ編集可(SetTopicAttributes → 再取得) | sns.e2e.ts#R41: edits a topic's DisplayName and the SDK reflects it |
| R42 | SNS トピックタグタブ: ListTagsForResource 表示・TagResource で追加(floci は Rust 側リカバリ)・UntagResource で削除。タグが永続化されないエミュレータではタブが機能を維持 | sns.e2e.ts#R42: adds a topic tag (SDK verified), then removes it / R42: tags tab stays functional when tags do not persist [^cap] |
| R43 | S3 バケット詳細のタブ化 + プロパティ(バージョニングトグル・タグ編集・CORS/ポリシー JSON 保存。タグ API 非対応エミュレータでは保存時エラーバナー) | s3.e2e.ts#R43: properties tab toggles versioning and saves CORS/policy / R43: saves bucket tags (SDK verified) / R43: surfaces an error banner when bucket tagging is unsupported [^cap] |
| R44 | S3 バージョン表示トグル(ListObjectVersions を現在プレフィックスで一覧、versionId 指定 DL) | s3.e2e.ts#R44: versions view lists object versions for the current prefix |
| R45 | S3 オブジェクトのコピー(別キーへ CopyObject)・フォルダ作成(`<prefix>/` 0 バイト put。フォルダキーが保持されないエミュレータでは機能維持のみ検証) | s3.e2e.ts#R45: copies an object / R45: creates a folder / R45: folder creation stays functional when folder keys do not persist [^cap] |
| R46 | S3 マルチパート対応パス方式アップロード(8MB 超は Rust で multipart、旧 base64 経路廃止) | s3.e2e.ts#R31/R46: uploads via the path seam (multipart-capable) and downloads to disk |
| R47 | RDS ダッシュボード: インスタンス数 / available 数 / スナップショット数のサマリカード + 「データベースを作成」クイックアクション。describe 非対応なら rds-unsupported バナー | rds.e2e.ts#R47: shows summary cards on a describe-capable emulator / R47: shows the rds-unsupported banner on an unsupported emulator [^cap] |
| R48 | RDS インスタンス操作: 行アクションで停止 / 起動 / 再起動 / 変更(ApplyImmediately、storage 20→30 を SDK 検証)。操作 API 非対応環境では操作失敗を通常 ErrorBanner で表示 | rds.e2e.ts#R48: stops, starts and modifies an instance / R48: reboots an instance without an error / R48: surfaces an error banner when reboot is unsupported / R48: surfaces an error banner when an operation is rejected (read-only) [^cap] |
| R49 | RDS スナップショット: UI 作成 → 復元(新インスタンスを SDK 検証)→ 確認付き削除で行消滅。describe 非対応なら snapshots-unsupported バナー。describe 可・ライフサイクル不可なら一覧が通常描画 | rds.e2e.ts#R49: creates, restores and deletes a snapshot / R49: renders the snapshot list on a describe-capable emulator without the full lifecycle / R49: shows the snapshots-unsupported banner on an unsupported emulator [^cap] |
| R50 | RDS パラメータグループ: UI 作成 → 一覧 → 行クリックでパラメータ表示。describe 非対応なら parameter-groups-unsupported バナー | rds.e2e.ts#R50: creates a group, lists it and shows its parameters / R50: shows the parameter-groups-unsupported banner on an unsupported emulator [^cap] |
| R51 | Lambda ダッシュボード: 関数数 / レイヤー数 / 合計コードサイズのサマリ + 関数一覧 + 「関数を作成」クイックアクション | lambda.e2e.ts#R51: dashboard summarises functions and the create quick action opens the modal |
| R52 | Lambda 関数一覧(名前/ランタイム/ハンドラ/更新日時)・作成(zip パスシーム、ロールは dummy ARN 自動)・削除(名前確認)。SDK 検証 | lambda.e2e.ts#R52: lists a seeded function, UI-creates one (SDK verify) and deletes it |
| R53 | Lambda 関数詳細: 概要タブ・設定編集(メモリ/タイムアウト/環境変数 → SDK 検証)・コード再アップロード(UpdateFunctionCode → CodeSha256 変化を SDK 検証) | lambda.e2e.ts#R53: detail overview, config edit (SDK verify) and code re-upload (sha changes) |
| R54 | Lambda テストタブ: JSON ペイロード → Invoke(LogType=Tail)→ ステータス / ペイロード / 末尾ログ表示。lambda.invoke 非対応(kumo)は invoke 実行でエラーバナー | lambda.e2e.ts#R54: test tab invokes the function and shows status, payload and logs / R54: shows an error banner when invoke is unsupported [^cap] |
| R55 | Lambda レイヤー: 一覧・公開(zip パスシーム + 互換ランタイム)・バージョン削除(名前確認)。lambda.layers 非対応(kumo)は lambda-layers-unsupported バナー | lambda.e2e.ts#R55: publishes a layer via the UI (SDK verify) and deletes it / R55: shows the unsupported banner when the layers API is unavailable [^cap] |
| R56 | API Gateway ダッシュボード(API 数 / API キー数)+ API 一覧・作成(名前・説明)・削除(名前確認)。SDK 検証 | api-gateway.e2e.ts#R56: lists a seeded API, dashboard summarises, UI create + delete round-trip |
| R57 | API 詳細「リソース」タブ: リソースツリー表示・リソース作成(親選択 + pathPart)・メソッド作成(HTTP メソッド × 統合タイプ MOCK / Lambda プロキシ)→ SDK GetMethod 検証 | api-gateway.e2e.ts#R57: UI create a resource + a MOCK GET method, SDK verifies both |
| R58 | API 詳細「ステージ」タブ: デプロイ作成(ステージ名)→ ステージ一覧 + 参考用の呼び出し URL 表示 → SDK GetStages 検証 | api-gateway.e2e.ts#R58: UI creates a deployment/stage; stages tab + SDK confirm it |
| R59 | API キー CRUD(一覧・作成・削除、SDK 検証)。作成/一覧のみ対応で削除非対応のエミュレータでは一覧が通常描画(削除は非実行)。API キー完全非対応エミュレータでは `api-gateway-unsupported` バナー + 作成非表示 | api-gateway.e2e.ts#R59: API-key CRUD round-trips through the UI (supported) / R59: API-key create + list work where delete is unsupported (partial) / R59: API-key page shows the unsupported notice (unsupported) [^cap] |
| R60 | Cognito ユーザープール: UI 作成 → SDK 検証 → 名前確認削除 + ダッシュボード(プール数 / 総ユーザー数)。localstack:3 は Pro 専用 → cognito-unsupported バナー + 作成非表示の対称テスト | cognito.e2e.ts#R60: UI creates a pool that the SDK sees, then deletes it / R60: shows the cognito-unsupported banner and hides create [^cap] |
| R61 | Cognito プール詳細「ユーザー」タブ: AdminCreateUser(ユーザー名・メール)→ 一覧(ステータス/有効)→ SDK 検証 → 削除。パスワード設定(permanent)・無効化/有効化は adminUserState 対応時のみ(非対応は set-password でエラーバナーの対称テスト) | cognito.e2e.ts#R61: creates a user via the UI, lists it, then deletes it / R61: sets a password and toggles enable/disable / R61: surfaces an error banner when set-password is unsupported [^cap] |
| R62 | Cognito プール詳細「アプリクライアント」タブ(作成・一覧・clientId 表示・削除)+「グループ」タブ(作成・一覧・削除)。グループ非対応(kumo)は cognito-groups-unsupported 案内文の対称テスト | cognito.e2e.ts#R62: app clients tab creates, lists and deletes a client / R62: groups tab creates and lists a group / R62: groups tab shows the unsupported notice when groups are unsupported [^cap] |
| R63 | EventBridge イベントバス一覧(default 含む)・作成・削除(名前確認)+ ダッシュボード(バス数 / ルール数)・「イベントバスを作成」クイックアクション | eventbridge.e2e.ts#R63: UI creates, lists and deletes an event bus / R63: dashboard summarises buses and the quick action opens the create modal |
| R64 | EventBridge ルール(バス選択セレクタ)一覧・作成(イベントパターン JSON)・有効/無効トグル・削除・ターゲット追加/削除(SQS キュー ARN)→ SDK 検証 | eventbridge.e2e.ts#R64: UI creates a rule, toggles it, and manages an SQS target |
| R65 | EventBridge「イベントを送信」(PutEvents)がパターン一致ルール経由で SQS ターゲットに実配信され、SDK receive で detail 一致を検証(4 エミュレータ全対応 = 無条件、SNS R28 と同型のリトライ) | eventbridge.e2e.ts#R65: UI PutEvents is delivered through a matching rule to the SQS target |
| R66 | Secrets Manager シークレット: 一覧(名前/説明/更新日時)・UI 作成(SDK 検証)・削除(即時 ForceDelete / 猶予日数の選択 + 名前確認、SDK で削除予定を検証) | secrets-manager.e2e.ts#R66: lists a seeded secret, UI-creates one (SDK verify), UI-deletes (recovery) |
| R67 | Secrets Manager 詳細: 値の伏せ字 ⇄ 表示トグル・新バージョン保存(PutSecretValue → SDK 検証 + バージョン一覧に 2 件)・タグ追加/削除(`secretsmanager.tags` ゲート、非対応エミュレータはタグ追加でエラーバナー) | secrets-manager.e2e.ts#R67: value is masked by default and the toggle reveals it / R67: UI put creates a new version (SDK verify) and the versions table shows two / R67: tags tab lists, adds and removes a tag / R67: tag add shows the error banner on emulators without tag support [^cap] |
| R68 | ElastiCache ダッシュボード: キャッシュ数 / エンジン別内訳(redis/valkey/memcached)のサマリカード + ReplicationGroup と CacheCluster を統合した一覧(ID/エンジン/ステータス/ノード数/エンドポイント)。describe 非対応なら elasticache-unsupported バナー | elasticache.e2e.ts#R68: shows summary cards and the SDK-seeded cache in the merged list / R68: shows the elasticache-unsupported banner on an unsupported emulator [^cap] |
| R69 | ElastiCache 作成: エンジン選択(redis/valkey → CreateReplicationGroup、memcached → CreateCacheCluster)・ノードタイプ・ノード数 → エンドポイント表示 → ID 入力確認削除。SDK 検証付き | elasticache.e2e.ts#R69: UI creates a redis cache, shows its endpoint, then deletes it [^cap] |
| R70 | ElastiCache 非対応エミュレータ(localstack:3 = Pro 専用): elasticache-unsupported バナー表示 + 作成ボタン非表示。describe 対応側は一覧が通常描画 | elasticache.e2e.ts#R70: shows the unsupported banner and hides the create action / R70: renders the caches list on a describe-capable emulator [^cap] |
| R71 | CloudFormation ダッシュボード(スタック数 / 完了 / 失敗 / エクスポート数のサマリ + 「スタックを作成」)+ スタック一覧(名前/ステータス/作成日時) | cloudformation.e2e.ts#R71: dashboard summarises stacks and the list shows a seeded stack |
| R72 | スタック作成(テンプレート textarea + パラメータ行)→ CREATE_COMPLETE → テンプレート内 SNS トピックが実際に生成されたことを SDK で裏取り。リソース非生成エミュレータ(kumo)では作成が機能維持(エラーなし・一覧掲載) | cloudformation.e2e.ts#R72: UI creates a stack whose SNS topic is really provisioned / R72: stack creation stays functional where resources are not provisioned [^cap] |
| R73 | スタック詳細タブ(リソース/出力/パラメータ/イベント/テンプレート): リソース(DescribeStackResources)・出力・テンプレートは全エミュレータで裏取り、パラメータ/イベントは描画確認のみ(floci はパラメータ非返却) | cloudformation.e2e.ts#R73: detail tabs show resources, outputs, template, parameters and events |
| R74 | スタック更新(テンプレート変更 → UpdateStack → SDK でトピック検証)+ 削除(名前確認 → 一覧から消滅 + トピック消滅を SDK 検証)。リソース非生成エミュレータでは更新/削除が機能維持 | cloudformation.e2e.ts#R74: UI updates the template then deletes the stack (resource verified) / R74: update and delete stay functional where resources are not provisioned [^cap] |

[^cap]: capability ゲートによる自動分岐(`e2e/helpers/capabilities.ts`)。各テストは自分が叩く
操作の対応可否を実機プローブで判定し(supported 側は「叩く全操作の AND」でゲート)、条件を
満たさない側は自己スキップする。カバレッジガードにより、どのエミュレータでも各要件ファミリの
テストが最低 1 本は実行される。**2026-07-22 実測の capability マトリクス**:

    | capability | localstack:3 | floci | ministack | kumo |
    | --- | --- | --- | --- | --- |
    | dynamodb.partiql (R19) | ○ | ○ | ○ | × |
    | dynamodb.backups (R20/R21) | × | × | ○ | × |
    | rds.instances.describe (R33〜R35/R47/R48) | × | ○ | ○ | ○ |
    | rds.instances.create (R33/R48/R49) | × | × | ○ | ○ |
    | rds.instances.reboot (R48) | × | ○ | ○ | × |
    | rds.snapshots.describe (R49) | × | ○ | ○ | × |
    | rds.snapshots.restore (R49) | × | × | ○ | × |
    | rds.parameterGroups.describe (R50) | × | ○ | ○ | × |
    | elasticache.describe (R68〜R70) | ×(Pro) | ○ | ○ | ○ |
    | sqs.dlqSources (R38) | ○ | ○ | × | × |
    | sns.topicTags (R42) | ○ | ○ | ○ | ×(成功応答だが未保存) |
    | s3.bucketTagging (R43) | ○ | ○ | ○ | × |
    | s3.folderKeys (R45) | △(非決定的に剥離) | ○ | ○ | ×(末尾スラッシュ剥離) |
    | lambda.invoke (R54) | ○(docker.sock マウント、Active 待ち後) | ○ | ○ | ×(no runtime handler) |
    | lambda.layers (R55) | ○ | ○ | ○ | ×(ListLayers が NoSuchBucket/404) |
    | apigateway.apiKeys (R59, 作成/一覧) | ○ | ○ | ○ | ×(S3 へ誤ルーティング) |
    | apigateway.apiKeyDelete (R59, 削除) | ○ | ×(delete を S3 へ誤ルーティング) | ○ | × |
    | cognito.userPools (R60〜R62) | ×(Pro) | ○ | ○ | ○ |
    | cognito.groups (R62) | × | ○ | ○ | ×(InvalidAction) |
    | cognito.adminUserState (R61) | × | ○ | ○ | ×(InvalidAction) |
    | secretsmanager.tags (R67) | ○ | ○ | ○ | ×(TagResource/UntagResource が InvalidAction) |
    | cloudformation.resourceCreation (R72/R74) | ○ | ○ | ○ | ×(制御プレーンのみ・リソース未生成) |

    これにより各エミュレータで実行される分岐は:
    R60 = ministack・floci・kumo が UI 作成/削除、localstack が cognito-unsupported バナー。
    R61 = ministack・floci がユーザー作成/削除 + パスワード設定 + 有効/無効切替、
    kumo がユーザー作成/削除 + set-password エラーバナー(adminUserState 非対応)、
    localstack は R60 で takeover 検証済みのため対象外(expectCoveredIf が userPools 対応時のみ要求)。
    R62 = ministack・floci がアプリクライアント CRUD + グループ CRUD、
    kumo がアプリクライアント CRUD + cognito-groups-unsupported 案内文(groups 非対応)、
    localstack は対象外。
    R33 系 = ministack・kumo が R33、localstack が R34、floci が R35。
    R48 = ministack が stop/start/modify + reboot 成功、kumo が stop/start/modify +
    reboot エラーバナー、floci が read-only エラーバナー(localstack は R34 で takeover
    検証済みのため対象外 — カバレッジガードも describe 対応時のみ R48 を要求する)。
    R49 = ministack がフルライフサイクル、floci が一覧描画(中間ケース)、
    localstack・kumo が unsupported バナー。
    R50 = ministack・floci が CRUD(delete は spec R50 により失敗許容 = best-effort)、
    localstack・kumo がバナー。R19 の SELECT 行描画は kumo のみスキップし、代わりに
    エラーバナー検証が走る。R20/R21・R38・R43 のタグ節も同様に対で分岐する。
    R59 = localstack・floci・ministack が API キー CRUD、kumo が
    `api-gateway-unsupported` バナー(kumo は API キー呼び出しを S3 へ誤ルーティングする)。
    R56〜R58 は 4 エミュレータ無条件(REST v1 は全対応)。
    R72/R74 = localstack:3・floci・ministack が実リソース裏取り(supported)、
    kumo が「機能維持(エラーなし)」側(unsupported)。R71・R73 は無条件
    (R73 のリソース/出力/テンプレートは DescribeStackResources で全 4 種対応)。

[^gsi]: GSI 固有テスト(R5「with a GSI」/ R8「against a GSI」/ R15 のインデックス名アサート)。
**2026-07-13 の検証では LocalStack / floci / ministack の 3 種すべてが GSI をサポートし、全テストが green**
(スキップ 0)。エミュレータが GSI 非対応の場合に備え、環境変数 `E2E_NO_GSI=1` を指定すると
これらのアサートをスキップできる安全弁を用意している(既定では有効)。詳細はタスク P2-4 レポート参照。

## R-id 対象外の UI 仕様

Home サービスグリッド(ロゴ+名前のみ / 有効サービス先頭 / floci 対応全サービス掲載 /
公式アイコン / 検索ボックス)とリージョン一覧拡充は
`docs/superpowers/specs/2026-07-14-home-service-grid-design.md` の確定仕様だが、
R-id は採番しない。回帰ガードは smoke.e2e.ts(Home 経由遷移)+ `src/pages/Home.test.tsx`
(検索・enabled 先頭ソート)+ connections.e2e.ts#R17(リージョン切替)が担う。
