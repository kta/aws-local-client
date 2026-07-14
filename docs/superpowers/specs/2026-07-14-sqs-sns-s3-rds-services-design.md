# SQS / SNS / S3 / RDS サービス追加 設計書

日付: 2026-07-14
ステータス: 承認待ち
前提: サービスレジストリ機構(`2026-07-14-shared-components-and-service-extensibility-design.md` §3)に基づき、
4 サービスを ServiceDefinition として追加する。要件 ID は R22〜R35(既存 R1〜R21 の続番)。

## 0. エミュレータ対応調査(2026-07-14 実機検証)

localstack/localstack:3・floci/floci・ministackorg/ministack に対し aws CLI で全操作を実行して確認。

| サービス | localstack:3 | floci | ministack |
|---|---|---|---|
| SQS(create/list/send/receive/attrs/purge/delete) | ✅ | ✅ | ✅ |
| SNS(topic/subscribe/publish/unsubscribe、SNS→SQS 実配信) | ✅ | ✅ | ✅ |
| S3(bucket/put/list/get/head/delete) | ✅ | ✅ | ✅(CRC64NVME 拒否・CRC32 は可。Rust SDK 既定は CRC32 のため影響なし) |
| RDS | ❌ Pro 限定(`API for service 'rds' not yet implemented or pro feature`) | ⚠️ `/var/run/docker.sock` マウント時のみ create 可(実 MySQL コンテナ起動)。既定では describe のみ成功、create はソケットエラー | ✅ モック実装(即 available、Endpoint は localhost:3306 固定) |

- SNS→SQS 配信は 3 エミュレータすべてで envelope(`{"Type":"Notification",...}`)受信を確認済み。
- Rust SDK: `aws-sdk-sqs` / `aws-sdk-sns` / `aws-sdk-s3` / `aws-sdk-rds` すべて v1 系列で存在。
  `aws-sdk-dynamodb = "1"` と同じメジャー系列指定で追加する。
- `connections.rs` の `make_sdk_config` は共有 `SdkConfig` を返すため、
  `aws_sdk_sqs::Client::new(&make_sdk_config(profile))` 等がそのまま書ける(変更不要)。
- FIFO(SQS/SNS)の対応可否は未検証。UI では FIFO 作成を提供するが、E2E は Standard のみ必須とし、
  FIFO は Rust integration テスト(対応エミュレータ)でカバーする。

## 1. 要件

### SQS(R22〜R25)

- **R22 キュー一覧**: 名前・種別(Standard/FIFO)・概算メッセージ数(可視/不可視)を表示。行クリックで詳細へ。
- **R23 キュー作成/削除/属性編集**: 作成モーダル(名前、FIFO チェック、可視性タイムアウト、
  メッセージ保持期間、配信遅延、RedrivePolicy JSON 任意)。削除は `ConfirmDangerModal`(名前入力確認)。
  詳細画面の「設定」タブで属性編集(SetQueueAttributes)。
- **R24 メッセージ送信**: 詳細画面からモーダルで本文・遅延秒・メッセージ属性(名前/型/値の行追加)を指定して送信。
  FIFO キューの場合は MessageGroupId / MessageDeduplicationId 入力を表示。
- **R25 メッセージ受信/削除/パージ**: 「メッセージをポーリング」ボタンで ReceiveMessage
  (max 10、可視性タイムアウトは受信用に 30 秒)。受信メッセージを表(MessageId・本文プレビュー・送信時刻)で表示、
  行展開で本文全文と属性。選択削除(DeleteMessage)と全パージ(PurgeQueue、確認モーダル付き)。

### SNS(R26〜R28)

- **R26 トピック一覧/作成/削除**: 名前・種別(Standard/FIFO)表示。作成モーダル(名前、FIFO チェック)。
  削除は名前入力確認。
- **R27 サブスクリプション管理**: トピック詳細で一覧(プロトコル・エンドポイント・フィルタポリシー)。
  「SQS キューをサブスクライブ」— 既存キューのセレクタ(sqs API でキュー一覧+ARN 解決)+
  フィルタポリシー JSON(任意)+ Raw message delivery チェック。解除(Unsubscribe、確認付き)。
- **R28 メッセージ発行**: トピック詳細から件名(任意)・本文・メッセージ属性を指定して Publish。
  FIFO トピックは MessageGroupId 入力を表示。発行後、サブスクライブ済み SQS キューで受信できること(E2E で実配信検証)。

### S3(R29〜R32)

- **R29 バケット一覧/作成/削除**: 名前・作成日時表示。作成モーダル(名前のみ。リージョンは接続プロファイル準拠)。
  削除は名前入力確認。バケットが空でない場合はエミュレータのエラーをそのままエラーバナー表示(強制削除はしない)。
- **R30 オブジェクトブラウザ**: バケット詳細は delimiter="/" のプレフィックス階層ナビ。
  フォルダ行(CommonPrefixes)クリックで下位へ、パンくずで上位へ戻る。現在プレフィックスは `?prefix=` に保持。
  オブジェクト行は キー(相対名)・サイズ・最終更新。ページネーション(ContinuationToken)。
- **R31 アップロード/ダウンロード**: アップロードは `<input type="file">` → ArrayBuffer → base64 →
  `s3_put_object`(Content-Type はファイルから引き継ぎ)。100MB 超は UI で拒否(base64 IPC の実用上限)。
  ダウンロードは `tauri-plugin-dialog` の save() で保存先を選び、Rust 側 `s3_download_object` が
  GetObject→ファイル書き込みまで行う(バイト列を IPC に載せない)。
  E2E シーム: `window.__E2E_SAVE_PATH` が設定されていれば dialog を開かずそのパスへ保存する。
- **R32 オブジェクト詳細/削除**: 行選択 → 詳細パネル(サイズ・Content-Type・ETag・最終更新・ユーザーメタデータ)。
  選択削除(複数選択可、確認モーダル付き。内部は DeleteObject の逐次呼び出し)。

### RDS(R33〜R35)

- **R33 インスタンス一覧/作成/削除**(対応エミュレータ): 識別子・エンジン・ステータス・クラス・エンドポイントを表示。
  作成モーダル(識別子、エンジン=mysql/postgres セレクタ、インスタンスクラス既定 db.t3.micro、
  マスターユーザー名/パスワード、割り当てストレージ既定 20GB)。削除は識別子入力確認
  (SkipFinalSnapshot=true 固定)。
- **R34 非対応フォールバック**: DescribeDBInstances が非対応エラー
  (`not yet implemented` / `pro feature` / `not supported` / `unknown operation` を大文字小文字無視で含む)の場合、
  backups(R21)と同方式の案内バナー `rds-unsupported` を表示し、作成ボタンを隠す。
  対応エミュレータ(ministack、floci+docker.sock)の案内も文中に記載。
- **R35 作成失敗時のエラーバナー**: describe は成功するが create が失敗する環境(floci 既定起動)では、
  一覧は表示しつつ作成エラーを通常のエラーバナーで表示する(非対応バナーにはしない)。

### 共通要件

- 全ページ: 接続未選択時は `ConnectionRequired`。プロファイル切替で状態クリア(`useProfileScopedFetch`)。
  エラーは `ErrorBanner` + 再試行。UI 文言は日本語。ライトテーマのみ。デザインは既存 DynamoDB ページと同トーン。
- Home の商標表記に「Amazon RDS」を追加(グリッド表示サービスと一致させる)。
- EC2 / EKS は coming soon のまま維持。

## 2. アーキテクチャ

サービスレジストリ設計 §3.6 のチェックリストに従い、サービスごとに以下を追加する。
Home / SideNav / Layout / App / error.rs / connections.rs は編集不要(registry.ts と lib.rs のみ 1 行ずつ)。

### 2.1 Rust(src-tauri)

- 依存追加: `aws-sdk-sqs = "1"`, `aws-sdk-sns = "1"`, `aws-sdk-s3 = "1"`, `aws-sdk-rds = "1"`,
  `tauri-plugin-dialog = "2"`(S3 ダウンロード保存ダイアログ。JS 側 `@tauri-apps/plugin-dialog` も追加)。
- `src-tauri/src/commands/{sqs,sns,s3,rds}.rs` を新設。すべて
  `#[tauri::command(rename_all = "camelCase")]`、エラーは既存 `AppError`(`map_sdk_err`)。
- `lib.rs` の `generate_handler!` に追記、`commands/mod.rs` に module 追加。

コマンドとワイヤ型(serde `rename_all = "camelCase"`、TS 側 `src/api/types.ts` にミラー):

```
// sqs.rs
QueueSummary   { queue_url, name, fifo, approximate_messages: i64, approximate_not_visible: i64 }
QueueDetail    { queue_url, name, arn, fifo, approximate_messages, approximate_not_visible,
                 visibility_timeout: i64, retention_period: i64, delay_seconds: i64,
                 max_message_size: i64, redrive_policy: Option<String>, created_at: Option<String> }
QueueAttributesUpdate { visibility_timeout, retention_period, delay_seconds, redrive_policy: Option<String> }
SqsMessage     { message_id, receipt_handle, body, attributes: serde_json::Value, sent_at: Option<String> }

sqs_list_queues(profile) -> Vec<QueueSummary>          // ListQueues + 各キューの GetQueueAttributes(All)
sqs_get_queue(profile, queue_url) -> QueueDetail
sqs_create_queue(profile, req: CreateQueueRequest)     // { name, fifo, visibility_timeout?, retention_period?, delay_seconds?, redrive_policy? }
sqs_delete_queue(profile, queue_url)
sqs_set_queue_attributes(profile, queue_url, req: QueueAttributesUpdate)
sqs_send_message(profile, queue_url, req: SendMessageRequest)  // { body, delay_seconds?, attributes?, group_id?, dedup_id? }
sqs_receive_messages(profile, queue_url) -> Vec<SqsMessage>    // max 10, visibility 30s, wait 1s
sqs_delete_message(profile, queue_url, receipt_handle)
sqs_purge_queue(profile, queue_url)
```

```
// sns.rs
TopicSummary    { topic_arn, name, fifo }
SnsSubscription { subscription_arn, protocol, endpoint, filter_policy: Option<String>, raw_delivery: bool }

sns_list_topics(profile) -> Vec<TopicSummary>
sns_create_topic(profile, name, fifo)
sns_delete_topic(profile, topic_arn)
sns_list_subscriptions(profile, topic_arn) -> Vec<SnsSubscription>
sns_subscribe_sqs(profile, topic_arn, queue_arn, filter_policy: Option<String>, raw_delivery: bool)
sns_unsubscribe(profile, subscription_arn)
sns_publish(profile, topic_arn, req: PublishRequest)   // { message, subject?, attributes?, group_id?, dedup_id? }
```

```
// s3.rs
BucketSummary  { name, created_at: Option<String> }
ObjectPage     { prefixes: Vec<String>, objects: Vec<ObjectSummary>, next_token: Option<String> }
ObjectSummary  { key, size: i64, last_modified: Option<String> }
ObjectDetail   { key, size: i64, content_type: Option<String>, etag: Option<String>,
                 last_modified: Option<String>, metadata: serde_json::Value }

s3_list_buckets(profile) -> Vec<BucketSummary>
s3_create_bucket(profile, name)
s3_delete_bucket(profile, name)
s3_list_objects(profile, bucket, prefix, next_token: Option<String>) -> ObjectPage  // delimiter "/", max 100
s3_head_object(profile, bucket, key) -> ObjectDetail
s3_put_object(profile, bucket, key, body_base64, content_type: Option<String>)
s3_download_object(profile, bucket, key, dest_path)    // GetObject → dest_path へ書き込み
s3_delete_object(profile, bucket, key)
```

```
// rds.rs
DbInstanceSummary { id, engine, status, instance_class, endpoint_address: Option<String>,
                    endpoint_port: Option<i32>, allocated_storage: Option<i32> }

rds_list_instances(profile) -> Vec<DbInstanceSummary>
rds_create_instance(profile, req: CreateDbInstanceRequest)  // { id, engine, instance_class, master_username, master_password, allocated_storage }
rds_delete_instance(profile, id)                            // SkipFinalSnapshot = true
```

### 2.2 フロントエンド(src)

- `src/api/{sqs,sns,s3,rds}.ts` — invoke ラッパー(`api/dynamodb.ts` と同型)。`api/client.ts` の
  `api` オブジェクトに `sqs` / `sns` / `s3` / `rds` として合成。型は `api/types.ts` に追記。
- `src/features/sqs/` — `QueuesPage.tsx`(R22/R23)、`QueueDetailPage.tsx`(R23〜R25、
  タブ: メッセージ / 設定)、`CreateQueueModal.tsx`、`SendMessageModal.tsx`、`service.tsx`。
- `src/features/sns/` — `TopicsPage.tsx`(R26)、`TopicDetailPage.tsx`(R27/R28、
  タブ: サブスクリプション / 発行)、`CreateTopicModal.tsx`、`service.tsx`。
- `src/features/s3/` — `BucketsPage.tsx`(R29)、`BucketBrowserPage.tsx`(R30〜R32、
  `?prefix=` ナビ + 詳細パネル)、`CreateBucketModal.tsx`、`service.tsx`。
- `src/features/rds/` — `InstancesPage.tsx`(R33〜R35)、`CreateInstanceModal.tsx`、`service.tsx`。
- ルート構成(nav は各 service.tsx が自己申告):
  - `/sqs` → `/sqs/queues` redirect、`/sqs/queues`、`/sqs/queues/:name`(nav: キュー)
  - `/sns` → `/sns/topics` redirect、`/sns/topics`、`/sns/topics/:name`(nav: トピック)
  - `/s3` → `/s3/buckets` redirect、`/s3/buckets`、`/s3/buckets/:bucket`(nav: バケット)
  - `/rds` → `/rds/instances` redirect、`/rds/instances`(nav: データベース)
  - 詳細ページの URL パラメータは名前ベース(ARN/URL は詳細ページ側で解決)。パンくずは `crumbLabel` で表示。
- `src/services/registry.ts` — comingSoon の sqs/sns/s3 を実 ServiceDefinition に置き換え、
  rds を新規追加(並び: dynamodb, sqs, sns, s3, rds, ec2(soon), eks(soon))。
- `src/assets/aws/icon-rds.svg` — 既存アイコンと同トーン(単色系・42px 表示)で新規作成。
- `src/pages/Home.tsx` — 商標表記文字列に「Amazon RDS」を追加。
- 共通プリミティブを全面使用: `PageHeader` / `Card` / `DataTable` / `Modal` / `ModalFooter` /
  `ConfirmDangerModal` / `StatusBadge` / `EmptyState` / `ConnectionRequired` / `useProfileScopedFetch` /
  `format.ts`(formatBytes / formatDate)。

### 2.3 エラー処理

- Rust は既存 `AppError` 4 分類をそのまま使用。新規エラー型は追加しない。
- 「非対応エミュレータ」判定はフロント側(BackupsPage の `isUnsupported` と同じ手法)。
  正規表現を `src/lib/unsupported.ts` に共通化し(`/unknown ?operation|not supported|not yet implemented|pro feature/i`)、
  BackupsPage もこれを使うようリファクタする。RDS(R34)で使用。
- S3 アップロードの 100MB 制限はフロントで検証エラー表示(Rust には到達させない)。

## 3. テスト

- **Unit(必須 green)**: 各ページ/モーダルの vitest(既存 DynamoDB ページのテストと同型:
  api モック + 描画/操作/エラー分岐)。Rust は型変換等のロジックがあれば cargo test(SDK 呼び出し薄層はユニット対象外)。
- **Integration(cargo test -- --ignored)**: サービスごとに実エミュレータ検証を追加。
  エンドポイントは新環境変数 `EMU_ENDPOINT`(未設定時は既存 `DDB_ENDPOINT` → 既定 `http://localhost:8000` にフォールバック)。
  SQS: create→send→receive→delete→purge→delete。SNS: topic→SQS subscribe→publish→SQS 受信→cleanup。
  S3: bucket→put→list(prefix)→head→delete。RDS: ministack 系でのみ実行(create→list→delete)。
  FIFO の create/send は SQS/SNS integration に含め、非対応エミュレータのエラーは許容スキップにする。
- **E2E**: `e2e/specs/{sqs,sns,s3,rds}.e2e.ts` を追加し、`SPEC-COVERAGE.md` に R22〜R35 を追記(100% 維持)。
  - SQS/SNS/S3 は 3 エミュレータ共通で全テスト実行(調査で全対応を確認済み)。
  - SNS R28 は実配信検証: UI で publish → SDK で SQS receive → envelope の Message を検証。
  - S3 R31 のアップロードは file input への直接設定を試み、組込み WebDriver で不可なら
    `browser.execute` で File を合成し DataTransfer 経由で change イベントを発火する。ダウンロードは
    `browser.execute` で `window.__E2E_SAVE_PATH` を設定 → ボタン押下 → Node 側 fs で保存内容を検証。
  - RDS は backups と同じ capability-adaptive: `before` で SDK により 3 分岐
    (describe 非対応 → R34 のみ / describe 可 & create 可 → R33 / describe 可 & create 不可 → R35)。
    どの分岐も実アサーションを持ち、全エミュレータで green になる。
- スペック変更につき、本ファイルと `SPEC-COVERAGE.md`、`AGENTS.md`(R 範囲の記述)を同一変更内で更新する。

## 4. 実装体制(参考)

- 1 spec → 1 plan → 1 PR(feature/sqs-sns-s3-rds → develop)。
- 実装は Opus サブエージェント 4 並列(サービスごとに worktree 分離)。
  共有ファイル(Cargo.toml / lib.rs / registry.ts / client.ts / types.ts / Home.tsx / icon-rds.svg /
  unsupported.ts 共通化)は先行タスク T0 で一括変更してから 4 並列を開始し、コンフリクトを避ける。
  統合は cherry-pick、タスクごとのレビュー + 全体レビュー(いずれも Opus)。

## 5. スコープ外(今回やらない)

- S3 バージョニング・presigned URL・マルチパートアップロード(エミュレータ対応未検証のため次フェーズ)。
- SQS の DLQ redrive 実行(ReceiveMessage ベースの再送 UI)。RedrivePolicy の設定のみ対応。
- SNS の SQS 以外のプロトコル(http/email/lambda)サブスクリプション。
- RDS の実接続コンソール(クエリ実行)・パラメータグループ・スナップショット。
- EC2 / EKS(coming soon のまま)。
