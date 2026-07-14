# SQS / SNS / S3 / RDS コンソール拡充 設計書(R36〜R50)

日付: 2026-07-14
ステータス: ユーザー承認済み(マルチパート含む)
前提: PR #12(R22〜R35)で追加された 4 サービスの画面・サイドバーを AWS コンソール準拠に拡充する。
要件 ID は R36〜R50(続番)。エミュレータ対応は 2026-07-14 の追加 API 実機調査に基づく(下表)。

## 0. 追加 API 実機調査サマリ(localstack:3 / floci / ministack)

- **3 種全対応**: SQS tag/list/untag-queue-tags、SNS list-subscriptions(横断)/ get・set-topic-attributes(DisplayName 往復)/ list-tags-for-resource、S3 versioning(put/get/list-object-versions/versionId 指定 GET)/ bucket tagging / CORS / policy / copy-object / マルチパート一式。
- **部分対応**: SQS list-dead-letter-source-queues(ministack ❌ InvalidAction)。S3 versionId 指定 delete(ministack は version-id を無視し delete marker を積むバグ)。SNS tag-resource(floci はタグ付与は成功するがレスポンス XML 不正で SDK がエラー)。RDS ライフサイクル(create/describe/delete-db-snapshot・restore・stop/start/reboot・modify は **ministack のみ**。floci は describe 系+パラメータグループ CRUD のみ。localstack community は RDS 全 API ❌)。RDS describe-db-engine-versions(ministack のみ)。
- **全滅**: RDS describe-events(3 種とも)→ イベント画面は作らない。

## 1. 要件

### SQS(R36〜R38)

- **R36 SQS ダッシュボード**: `/sqs` 直下(DynamoDB ダッシュボードと同型)。SummaryCards でキュー数 /
  総可視メッセージ数 / 総処理中メッセージ数 / FIFO キュー数。キュー一覧テーブル(名前クリックで詳細へ)+
  「キューを作成」クイックアクション(/sqs/queues に作成モーダルを開いて遷移)。サイドバーは
  「ダッシュボード / キュー」の 2 項目(group 0)。
- **R37 キュータグタブ**: キュー詳細に「タグ」タブ追加。ListQueueTags 表示、行追加で TagQueue、
  行削除で UntagQueue。編集後は再取得。
- **R38 デッドレタータブ**: キュー詳細に「デッドレター」タブ追加。上段: 自キューの RedrivePolicy
  (deadLetterTargetArn / maxReceiveCount)を表示、未設定なら「設定されていません」。下段: このキューを
  DLQ として使うソースキュー一覧(ListDeadLetterSourceQueues)。同 API 非対応エミュレータ(ministack)では
  ソースキュー節に `dlq-sources-unsupported` の案内文(バナーではなくテキスト)を表示し、タブ自体は残す。

### SNS(R39〜R42)

- **R39 SNS ダッシュボード**: `/sns` 直下。SummaryCards でトピック数 / サブスクリプション総数 /
  FIFO トピック数。トピック一覧テーブル + 「トピックを作成」クイックアクション。サイドバーは
  「ダッシュボード / トピック / サブスクリプション」の 3 項目。
- **R40 横断サブスクリプション一覧**: `/sns/subscriptions`。ListSubscriptions(全トピック横断)を表で表示
  (トピック名 / プロトコル / エンドポイント / ARN)。行選択 → 解除(確認付き、`PendingConfirmation` は解除不可注記)。
  トピック名クリックでトピック詳細へ。
- **R41 トピック属性タブ**: トピック詳細に「属性」タブ。GetTopicAttributes の主要属性
  (DisplayName / TopicArn / Owner / SubscriptionsConfirmed 等)を表示し、DisplayName のみ編集可能
  (SetTopicAttributes → 再取得)。
- **R42 トピックタグタブ**: トピック詳細に「タグ」タブ。ListTagsForResource 表示、TagResource で追加、
  UntagResource で削除。**floci 対策**: tag_resource が Err でも直後に list_tags_for_resource で
  当該タグが付与済みなら成功扱いにする(Rust 側でリカバリ)。

### S3(R43〜R46)

- **R43 バケット詳細のタブ化 + プロパティ**: BucketBrowser を「オブジェクト / プロパティ」タブ構成に。
  プロパティタブ: バージョニング(状態表示 + 有効化/停止トグル、PutBucketVersioning)、タグ
  (Get/PutBucketTagging、行編集)、CORS(Get/PutBucketCors、JSON エディタ)、バケットポリシー
  (Get/PutBucketPolicy、JSON エディタ)。未設定の Get はエラーでなく「未設定」表示
  (NoSuchTagSet / NoSuchCORSConfiguration / NoSuchBucketPolicy は正常系)。
- **R44 バージョン表示**: オブジェクトタブに「バージョンを表示」トグル。ON で ListObjectVersions を
  delimiter なし・現在プレフィックス配下で表示(キー / versionId 短縮 / IsLatest / delete marker /
  サイズ / 更新日時)。バージョン行から versionId 指定 GET(ダウンロード)可能。
  **バージョン指定の削除は提供しない**(ministack が versionId を無視して delete marker を積むバグのため。
  通常の削除(delete marker 追加)は既存どおり)。
- **R45 コピー & フォルダ作成**: オブジェクト選択 → 「コピー」で同一バケット内の別キーへ CopyObject
  (宛先キー入力モーダル)。「フォルダの作成」で `<prefix>/` の 0 バイトオブジェクトを put(AWS コンソール同様)。
- **R46 マルチパートアップロード**: put_object を拡張し、8MB 超のファイルは Rust 側で
  CreateMultipartUpload → UploadPart(8MB チャンク)→ CompleteMultipartUpload。失敗時は AbortMultipartUpload。
  フロントの 100MB 上限を撤廃(上限なし。ただし base64 IPC を避けるため、アップロードはファイルパス方式に変更:
  `<input type="file">` からは File を一時ファイルに書けないため、`@tauri-apps/plugin-dialog` の open() で
  ファイル選択し、Rust 側でパスから読み込む方式に切り替える。E2E シームとして
  `window.__E2E_UPLOAD_PATH`(設定時は open() を開かずそのパスを使う)を追加)。
  既存の `object-upload-input`(base64 経由)は廃止し、E2E も新シームに移行する。

### RDS(R47〜R50)

- **R47 RDS ダッシュボード**: `/rds` 直下。SummaryCards でインスタンス数 / available 数 / スナップショット数
  (スナップショット API 非対応時は "-")。インスタンス一覧テーブル + 「データベースの作成」クイックアクション。
  サイドバーは「ダッシュボード / データベース / スナップショット / パラメータグループ」の 4 項目。
- **R48 インスタンス操作**: データベース一覧の行選択 → アクション(停止 / 起動 / 再起動 / 変更 / 削除)。
  変更モーダルは allocated_storage と instance_class の変更(ModifyDBInstance、ApplyImmediately=true)。
  操作 API 非対応環境(floci)では操作実行時のエラーを通常 ErrorBanner で表示(R35 と同方針)。
  localstack は既存 R34 の `rds-unsupported` バナーのまま。
- **R49 スナップショット**: `/rds/snapshots`。一覧(DescribeDBSnapshots: ID / インスタンス / 状態 / 作成日時)、
  作成(インスタンス選択 + スナップショット ID)、復元(新インスタンス ID 入力 → RestoreDBInstanceFromDBSnapshot)、
  削除(確認付き)。ページロードの describe が非対応エラーなら `snapshots-unsupported` バナー
  (backups R21 と同方式)。
- **R50 パラメータグループ**: `/rds/parameter-groups`。一覧(DescribeDBParameterGroups)、作成
  (名前 / ファミリー / 説明、CreateDBParameterGroup)、行クリックで DescribeDBParameters のパラメータ表
  (名前 / 値 / 説明、先頭 100 件 + 続き読み込み)。describe 非対応(localstack)は
  `parameter-groups-unsupported` バナー。削除(DeleteDBParameterGroup)は default グループ以外で提供
  ※調査で delete は未検証のため、失敗時は ErrorBanner 素通しで許容。

### 共通

- 各サービスのダッシュボードは DynamoDB DashboardPage の構成(SummaryCards + 一覧 + クイックアクション)を踏襲。
- basePath 直下ルートは redirect からダッシュボードに変更(SQS/SNS/RDS)。S3 はバケット一覧のまま
  (実 AWS コンソールも S3 はダッシュボードを持たないため)。
- 新規タブ・ページも既存の共通プリミティブと `useProfileScopedFetch` を使用。UI 文言は日本語。
- E2E: R36〜R50 を SPEC-COVERAGE に追加し 100% 維持。RDS 系は capability 分岐
  (ministack=フル / floci=describe+PG / localstack=バナー)。S3 バージョン系・マルチパートは 3 エミュ共通。
  SQS DLQ ソース一覧は localstack/floci で検証、ministack は unsupported 文言を検証。

## 2. アーキテクチャ(差分)

- Rust: 既存 `commands/{sqs,sns,s3,rds}.rs` にコマンド追加(新 module なし)。
  - sqs: `sqs_list_queue_tags` / `sqs_tag_queue` / `sqs_untag_queue` / `sqs_list_dlq_sources`
  - sns: `sns_get_topic_attributes` / `sns_set_display_name` / `sns_list_all_subscriptions` /
    `sns_list_topic_tags` / `sns_tag_topic`(floci リカバリ内蔵)/ `sns_untag_topic`
  - s3: `s3_get_bucket_properties`(versioning+tagging+cors+policy を 1 コマンドで集約取得)/
    `s3_set_versioning` / `s3_put_bucket_tagging` / `s3_put_bucket_cors` / `s3_put_bucket_policy` /
    `s3_list_object_versions` / `s3_download_object_version` / `s3_copy_object` / `s3_create_folder` /
    `s3_upload_file`(パス方式、8MB 超は multipart)
  - rds: `rds_stop_instance` / `rds_start_instance` / `rds_reboot_instance` / `rds_modify_instance` /
    `rds_list_snapshots` / `rds_create_snapshot` / `rds_restore_snapshot` / `rds_delete_snapshot` /
    `rds_list_parameter_groups` / `rds_create_parameter_group` / `rds_delete_parameter_group` /
    `rds_list_parameters`
- TS: 各 `api/<service>.ts` にラッパー・型を追加(camelCase ミラー、両側同時変更)。
- ページ: `features/sqs/DashboardPage.tsx`、`features/sns/{DashboardPage,SubscriptionsPage}.tsx`、
  `features/rds/{DashboardPage,SnapshotsPage,ParameterGroupsPage}.tsx` を新設。既存詳細ページにタブ追加。
  各 `service.tsx` の nav / routes を拡充。
- 非対応判定は既存 `isUnsupportedOperation` を使用(ministack の SQS InvalidAction
  「is not valid for this endpoint」にマッチするよう正規表現に `is not valid` を追加)。

## 3. スコープ外

- RDS イベント(全エミュレータ非対応)、describe-db-engine-versions 画面(ministack のみで価値薄)。
- S3 バージョン指定削除(ministack バグ)、Block Public Access / ACL / ライフサイクルルール(未調査)。
- SNS の SQS 以外のプロトコル、モバイル/SMS 系。EC2 / EKS。
