# E2E 仕様トレーサビリティ表(SPEC-COVERAGE)

Phase 1 スペック + UI 改訂 + Phase 3(ダッシュボード / PartiQL / バックアップ)+
Phase 2(SQS / SNS / S3 / RDS)+ サービスコンソール拡充(R36〜)から抽出した要件 ID
(R1〜R38)と、それを検証する E2E テストの対応表。
**全 38 行に最低 1 テストが対応していること**が完了条件。仕様要件を変更した場合は
`docs/superpowers/specs/` と本表を同じ変更で更新すること。

テストは実バイナリ(`npm run e2e:build`)を WebdriverIO の Tauri 埋め込みドライバで起動し、
`E2E_ENDPOINT`(既定 `http://localhost:4566`)のエミュレータに対して実行する。同一スイートを
LocalStack / floci / ministack の 3 種に対して実行して緑を確認している(結果はタスクレポート参照)。

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
| R19 | PartiQL: テンプレート選択で `SELECT * FROM "<table>"` 挿入・SELECT で行描画・INSERT→SELECT で投入項目が出る(書込経路)・不正ステートメントでエラーバナー | partiql.e2e.ts#R19: template selector fills SELECT * FROM "<table>" / R19: runs a SELECT and renders the seeded rows / R19: INSERT then SELECT shows the inserted item (write path) / R19: an invalid statement shows the error banner |
| R20 | バックアップ(対応エミュレータ): UI で作成→行表示→新テーブルへ復元(SDK で存在+投入項目を検証)→確認付き削除で行消滅 | backups.e2e.ts#R20: creates a backup, restores it to a new table, then deletes it [^backup] |
| R21 | バックアップ非対応エミュレータ: `backups-unsupported` バナー表示 + 作成ボタン非表示 | backups.e2e.ts#R21: shows the unsupported banner and hides the create button [^backup] |
| R22 | SQS キュー一覧(SDK で 2 キュー seed → 名前・種別・メッセージ数概算の表示) | sqs.e2e.ts#R22: lists SDK-seeded queues with their (approximate) message count |
| R23 | SQS キュー作成(UI 作成 → SDK で属性検証)・属性編集(設定タブ → SDK 検証)・削除(名前入力確認) | sqs.e2e.ts#R23: UI create -> SDK verify attrs, UI edit -> SDK verify, UI delete |
| R24 | SQS メッセージ送信(UI 送信 + 属性 → SDK receive で本文・属性一致) | sqs.e2e.ts#R24: UI send -> SDK receive matches body and attribute |
| R25 | SQS メッセージ受信/削除/パージ(SDK send seed → UI ポーリング表示 → UI 削除 → SDK で消滅確認 → UI パージ → SDK で空確認) | sqs.e2e.ts#R25: UI poll shows seeded messages, UI delete one, UI purge empties it |
| R26 | SNS トピック作成/一覧/削除(名前入力確認、SDK で検証) | sns.e2e.ts#R26: UI creates, lists and deletes a topic |
| R27 | SNS SQS サブスクリプション追加(UI 追加 → 一覧表示 → SDK 検証)・解除(名前入力確認) | sns.e2e.ts#R27: UI adds an SQS subscription, shows it, then unsubscribes |
| R28 | SNS メッセージ発行(UI publish → SDK で SQS receive、envelope.Message 一致) | sns.e2e.ts#R28: UI publish is delivered to the subscribed SQS queue |
| R29 | S3 バケット作成/一覧/非空削除エラー/空削除 | s3.e2e.ts#R29: UI creates a bucket; non-empty delete errors, empty delete succeeds |
| R30 | S3 プレフィックスナビゲーション(SDK で `a/b.txt`,`a/c/d.txt`,`e.txt` seed → フォルダ移動・パンくず・`?prefix=`) | s3.e2e.ts#R30: navigates prefixes, breadcrumbs and ?prefix= |
| R31 | S3 オブジェクトのアップロード(file input → SDK GetObject 検証)/ダウンロード(`__E2E_SAVE_PATH` → ディスク内容検証) | s3.e2e.ts#R31: uploads via the file input and downloads to disk |
| R32 | S3 オブジェクト詳細パネル(メタデータ表示)・選択削除 | s3.e2e.ts#R32: shows object metadata and deletes it via selection |
| R33 | RDS(create 対応エミュレータ): UI 作成 → 一覧に `available` 表示 → UI 削除 | rds.e2e.ts#R33: UI creates an instance that becomes available, then deletes it [^rds] |
| R34 | RDS(describe 非対応エミュレータ): `rds-unsupported` バナー表示 + 作成ボタン非表示 | rds.e2e.ts#R34: shows the unsupported banner and hides the create action [^rds] |
| R35 | RDS(describe 可・create 不可エミュレータ): 一覧表示 + UI 作成でエラーバナー | rds.e2e.ts#R35: lists instances and surfaces an error when a create is rejected [^rds] |
| R36 | SQS ダッシュボード(`/sqs` 直下): SummaryCards(キュー数 / 可視 / 処理中 / FIFO)+ キュー一覧・「キューを作成」クイックアクションで作成モーダルを開いて遷移 | sqs.e2e.ts#R36: dashboard summarises seeded queues and quick action opens the create modal |
| R37 | SQS キュータグタブ: ListQueueTags 表示・行追加で TagQueue・行削除で UntagQueue | sqs.e2e.ts#R37: tags tab lists, adds and removes a queue tag |
| R38 | SQS デッドレタータブ: 自キューの RedrivePolicy 表示 + ソースキュー一覧(非対応エミュレータでは `dlq-sources-unsupported` 案内文) | sqs.e2e.ts#R38: dead-letter tab shows the redrive policy and source queues (or an unsupported notice) |

[^backup]: R20 / R21 は接続先エミュレータの能力に応じて自動分岐する(`backups.e2e.ts` の `before` で
AWS SDK の ListBackups により実機プローブ)。対応(ministack)なら R20 フローが走り R21 は自己スキップ、
非対応(localstack:3 / floci / dynamodb-local)なら R21 が走り R20 は自己スキップする。
どちらの分岐も実アサーションを持ち、同一スイートが全エミュレータで green になる。

[^rds]: R33 / R34 / R35 は接続先エミュレータの RDS 対応度に応じて自動分岐する(`rds.e2e.ts`
の `before` で AWS SDK の DescribeDBInstances / CreateDBInstance を実機プローブ)。
describe + create 可(ministack)なら R33 が走り、describe 非対応(localstack:3)なら R34、
describe 可・create 不可(floci の docker.sock 非マウント既定起動)なら R35 が走る。
走らない分岐は自己スキップする(`backups.e2e.ts` の分岐方式を踏襲)。
**2026-07-14 の検証では ministack が R33 分岐、localstack:3 が R34 分岐、floci が R35 分岐で
それぞれ green**(各エミュレータで他 2 分岐はスキップ)。

[^gsi]: GSI 固有テスト(R5「with a GSI」/ R8「against a GSI」/ R15 のインデックス名アサート)。
**2026-07-13 の検証では LocalStack / floci / ministack の 3 種すべてが GSI をサポートし、全テストが green**
(スキップ 0)。エミュレータが GSI 非対応の場合に備え、環境変数 `E2E_NO_GSI=1` を指定すると
これらのアサートをスキップできる安全弁を用意している(既定では有効)。詳細はタスク P2-4 レポート参照。
