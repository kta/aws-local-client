# サービスコンソール拡充 実装計画(R36〜R50)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SQS/SNS/S3/RDS の画面・サイドバーを AWS コンソール準拠に拡充する(spec: `docs/superpowers/specs/2026-07-14-service-console-expansion-design.md`)。

**Architecture:** 既存 4 サービスの `commands/<svc>.rs` / `api/<svc>.ts` / `features/<svc>/` への追記が中心。新規 module・新規依存なし(S3 アップロードのパス方式化に既存 `@tauri-apps/plugin-dialog` の open() を使用)。T1〜T4 を worktree 並列(相互依存なし)、統合後 T5 で E2E + docs。

**Tech Stack:** 既存スタックのまま。

## Global Constraints

- 前フェーズと同一: serde camelCase 両側同時変更 / ワイヤ型は `api/<svc>.ts` 内 export / 共通 UI プリミティブ必須 / AppError+map_sdk_err のみ / 日本語 UI / チェックブロック green / integration は `EMU_ENDPOINT`(フォールバック `DDB_ENDPOINT`→`http://localhost:8000`)/ ホストポート 4566・8000 禁止 / Conventional Commits + Co-Authored-By / push 禁止。
- 既存 testid・既存コマンドの改名禁止(E2E 契約)。ただし R46 で `object-upload-input`(base64 方式)は spec により廃止・置換する。
- 既存詳細ページへのタブ追加は DynamoDB TableDetailPage / SQS QueueDetailPage のタブ実装パターンを踏襲。
- ダッシュボードは `src/features/dynamodb/DashboardPage.tsx` を手本(SummaryCards + 一覧 + クイックアクション)。
- 非対応判定は `src/lib/unsupported.ts` の `isUnsupportedOperation`。

## 実行アーキテクチャ(コントローラ向け)

1. T1〜T4 並列(worktree、feature/service-console-expansion の spec コミット起点)。共有配線は
   `lib.rs` generate_handler に自サービス行のみ追加(統合時 union)。`services/registry.ts` は今回編集不要
   (nav/routes は各 service.tsx 内)。`src/lib/unsupported.ts` は T1 のみが編集。
2. 統合(cherry-pick、union 解消)→ チェックブロック + integration(ministack)。
3. T5(E2E + SPEC-COVERAGE R36〜R50 + AGENTS/README R 範囲更新)。開始前に develop の
   fix/e2e-sqs-send-modal-race(clickEnabledT)を feature ブランチへ取り込むこと。
4. 全体レビュー → PR → CI → merge。

---

### Task 1: SQS 拡充(R36〜R38)

**Files:**
- Modify: `src-tauri/src/commands/sqs.rs`(+4 コマンド)、`src-tauri/src/lib.rs`
- Modify: `src/api/sqs.ts`、`src/features/sqs/QueueDetailPage.tsx`(タブ 2 本追加)、`src/features/sqs/service.tsx`
- Modify: `src/lib/unsupported.ts`(正規表現に `is not valid` を追加)+ `src/lib/unsupported.test.ts`
- Create: `src/features/sqs/DashboardPage.tsx` + `DashboardPage.test.tsx`
- Test: `src/features/sqs/QueueDetailPage.test.tsx` に追記、integration_sqs.rs に追記

**Interfaces(Produces):**

```ts
// api/sqs.ts 追加
export interface QueueTag { key: string; value: string; }
export interface DlqSourceInfo { redrivePolicy: string | null; sources: string[]; supported: boolean; }
listQueueTags: (profile, queueUrl) => invoke<QueueTag[]>("sqs_list_queue_tags", ...)
tagQueue: (profile, queueUrl, key, value) => invoke<void>("sqs_tag_queue", ...)
untagQueue: (profile, queueUrl, key) => invoke<void>("sqs_untag_queue", ...)
listDlqSources: (profile, queueUrl) => invoke<DlqSourceInfo>("sqs_list_dlq_sources", ...)
```

- `sqs_list_dlq_sources`: 自キューの RedrivePolicy(GetQueueAttributes)+ ListDeadLetterSourceQueues。
  後者が非対応エラー(`isUnsupportedOperation` 相当のメッセージ、Rust 側では文字列判定)なら
  `supported: false, sources: []` を返す(コマンド自体は Ok)。
- unsupported.ts 正規表現: `/unknown ?operation|not supported|not yet implemented|pro feature|is not valid/i`
  (ministack の `The action ListDeadLetterSourceQueues is not valid for this endpoint` 対応)。

testid 契約: ダッシュボード `sqs-dash-{queues,visible,inflight,fifo}`(SummaryCards)/ `sqs-dash-table` /
`sqs-dash-create`。タブ `tab-tags` / `tab-dlq`。タグ: `tags-table` / `tag-add` / `tag-key-input` /
`tag-value-input` / `tag-save` / `tag-remove-<key>`。DLQ: `dlq-redrive-policy` / `dlq-sources-table` /
`dlq-sources-unsupported`(テキスト)。nav: `nav-sqs-dashboard`(path `/sqs`)。

- [ ] Step 1: Rust 4 コマンド + lib.rs(TDD: RedrivePolicy パース等)→ clippy green
- [ ] Step 2: integration_sqs に tag/untag/list + DLQ ソース(RedrivePolicy 付きソースキュー作成→ 一覧に出る or supported:false)追記
- [ ] Step 3: api/sqs.ts 追加、tsc green
- [ ] Step 4: unsupported.ts 拡張(テスト先行)
- [ ] Step 5: DashboardPage(R36)TDD、service.tsx の nav/routes 更新(`/sqs` → DashboardPage、redirect 削除)
- [ ] Step 6: QueueDetailPage にタグ/DLQ タブ(R37/R38)TDD
- [ ] Step 7: チェックブロック + ministack integration green → コミット

### Task 2: SNS 拡充(R39〜R42)

**Files:**
- Modify: `src-tauri/src/commands/sns.rs`(+6 コマンド)、`lib.rs`、`src/api/sns.ts`、
  `src/features/sns/TopicDetailPage.tsx`(属性/タグ タブ)、`src/features/sns/service.tsx`
- Create: `src/features/sns/DashboardPage.tsx` + test、`src/features/sns/SubscriptionsPage.tsx` + test

**Interfaces:**

```ts
export interface TopicAttributes { topicArn: string; displayName: string; owner: string; subscriptionsConfirmed: number; subscriptionsPending: number; fifo: boolean; }
export interface GlobalSubscription { subscriptionArn: string; topicArn: string; topicName: string; protocol: string; endpoint: string; }
export interface TopicTag { key: string; value: string; }
getTopicAttributes: (profile, topicArn) => invoke<TopicAttributes>("sns_get_topic_attributes", ...)
setDisplayName: (profile, topicArn, displayName) => invoke<void>("sns_set_display_name", ...)
listAllSubscriptions: (profile) => invoke<GlobalSubscription[]>("sns_list_all_subscriptions", ...)
listTopicTags: (profile, topicArn) => invoke<TopicTag[]>("sns_list_topic_tags", ...)
tagTopic: (profile, topicArn, key, value) => invoke<void>("sns_tag_topic", ...)
untagTopic: (profile, topicArn, key) => invoke<void>("sns_untag_topic", ...)
```

- `sns_tag_topic` の floci リカバリ: tag_resource が Err の場合、list_tags_for_resource を呼び
  当該 key/value が存在すれば Ok を返す。存在しなければ元のエラーを返す(spec R42)。
- `PendingConfirmation` の subscriptionArn は解除不可 → SubscriptionsPage で解除ボタン disabled + 注記。

testid 契約: `sns-dash-{topics,subs,fifo}` / `sns-dash-table` / `sns-dash-create` / nav `nav-sns-dashboard`(`/sns`)・
`nav-subscriptions`(`/sns/subscriptions`)。SubscriptionsPage: `subscriptions-table` / `gsub-row-<トピック名>` /
`gsub-remove`。属性タブ: `tab-attrs` / `attr-display-name`(input)/ `attr-save` / `attrs-table`。
タグタブ: `tab-tags` / `tags-table` / `tag-add` / `tag-key-input` / `tag-value-input` / `tag-save` / `tag-remove-<key>`。

- [ ] Step 1〜7: Task 1 と同じ進行(Rust → integration(list-all-subs / attributes 往復 / tag リカバリ)→ TS → Dashboard+SubscriptionsPage TDD → TopicDetailPage タブ TDD → service.tsx → チェック+コミット)

### Task 3: S3 拡充(R43〜R46)

**Files:**
- Modify: `src-tauri/src/commands/s3.rs`(+10 コマンド、`s3_put_object` は残すが UI からは未使用化)、`lib.rs`、
  `src/api/s3.ts`、`src/features/s3/BucketBrowserPage.tsx`(タブ化 + バージョン表示 + コピー + フォルダ + パス方式アップロード)、
  `src/features/s3/service.tsx`(必要なら crumb 調整のみ)
- Test: `BucketBrowserPage.test.tsx` 拡張、integration_s3.rs 拡張

**Interfaces:**

```ts
export interface BucketProperties { versioning: string | null; tags: { key: string; value: string }[]; corsJson: string | null; policyJson: string | null; }
export interface ObjectVersion { key: string; versionId: string; isLatest: boolean; deleteMarker: boolean; size: number | null; lastModified: string | null; }
getBucketProperties: (profile, bucket) => invoke<BucketProperties>("s3_get_bucket_properties", ...)
setVersioning: (profile, bucket, enabled: boolean) => invoke<void>("s3_set_versioning", ...)
putBucketTagging: (profile, bucket, tags: {key,value}[]) => invoke<void>("s3_put_bucket_tagging", ...)
putBucketCors: (profile, bucket, corsJson: string) => invoke<void>("s3_put_bucket_cors", ...)
putBucketPolicy: (profile, bucket, policyJson: string) => invoke<void>("s3_put_bucket_policy", ...)
listObjectVersions: (profile, bucket, prefix) => invoke<ObjectVersion[]>("s3_list_object_versions", ...)
downloadObjectVersion: (profile, bucket, key, versionId, destPath) => invoke<void>("s3_download_object_version", ...)
copyObject: (profile, bucket, sourceKey, destKey) => invoke<void>("s3_copy_object", ...)
createFolder: (profile, bucket, prefix) => invoke<void>("s3_create_folder", ...)
uploadFile: (profile, bucket, key, srcPath) => invoke<void>("s3_upload_file", ...)
```

- `s3_get_bucket_properties`: 4 つの Get を呼び、NoSuchTagSet / NoSuchCORSConfiguration /
  NoSuchBucketPolicy / 未設定 versioning は null/空で返す(エラーにしない)。CORS/Policy は JSON 文字列で往復。
- `s3_upload_file`: `tokio::fs` でパスから読み、8MB 以下は put_object、超は multipart(8MB チャンク、
  失敗時 abort)。Content-Type は拡張子から推定(`mime_guess` は新規依存になるため使わず、既知拡張子の
  小さな match で良い。不明は application/octet-stream)。
- UI アップロード: `open({ multiple: false })`(plugin-dialog)でパス取得。
  `window.__E2E_UPLOAD_PATH` があれば dialog を開かずそれを使う。ファイル名は パスの末尾。
  旧 `<input type="file">` + base64 経路と `object-upload-input` は削除(spec R46)。
- バージョン表示: トグル `versions-toggle`。ON 時は `versions-table`(行 `version-row-<versionId>`、
  DL ボタン `version-download-<versionId>`)。
- プロパティタブ: `tab-props` / `props-versioning-toggle` / `props-versioning-status` / タグ編集
  (`props-tags-table` / `props-tag-add` / `props-tag-key` / `props-tag-value` / `props-tag-save` /
  `props-tag-remove-<key>`)/ CORS `props-cors-editor` + `props-cors-save` / ポリシー `props-policy-editor` +
  `props-policy-save`。オブジェクトタブは既存 testid 維持 + `object-copy` / `copy-dest-input` / `copy-save` /
  `folder-create` / `folder-name-input` / `folder-save` / `object-upload`(ボタンは維持、input は廃止)。

- [ ] Step 1: Rust 10 コマンド(TDD: multipart チャンク境界 8MB ちょうど/±1 のユニット、Content-Type match)→ clippy
- [ ] Step 2: integration_s3 拡張(versioning 往復 + 2 版 list + versionId GET / tagging / cors / policy / copy / folder / 9MB ファイルで multipart upload → head でサイズ一致 → cleanup)
- [ ] Step 3: api/s3.ts、tsc green
- [ ] Step 4: BucketBrowserPage タブ化 + 各機能 TDD(open() は vi.mock、__E2E_UPLOAD_PATH 分岐テスト、バージョントグル、プロパティ各セクション)
- [ ] Step 5: チェックブロック + ministack integration green → コミット

### Task 4: RDS 拡充(R47〜R50)

**Files:**
- Modify: `src-tauri/src/commands/rds.rs`(+12 コマンド)、`lib.rs`、`src/api/rds.ts`、
  `src/features/rds/InstancesPage.tsx`(アクション: 停止/起動/再起動/変更)、`src/features/rds/service.tsx`
- Create: `src/features/rds/DashboardPage.tsx`、`SnapshotsPage.tsx`、`ParameterGroupsPage.tsx`、
  `ModifyInstanceModal.tsx`(+ 各 test)

**Interfaces:**

```ts
export interface DbSnapshot { id: string; instanceId: string; status: string; createdAt: string | null; }
export interface DbParameterGroup { name: string; family: string; description: string; }
export interface DbParameter { name: string; value: string | null; description: string | null; }
stopInstance / startInstance / rebootInstance: (profile, id) => invoke<void>(...)
modifyInstance: (profile, id, req: { instanceClass?: string; allocatedStorage?: number }) => invoke<void>("rds_modify_instance", ...)  // ApplyImmediately=true
listSnapshots: (profile) => invoke<DbSnapshot[]>("rds_list_snapshots", ...)
createSnapshot: (profile, instanceId, snapshotId) => invoke<void>(...)
restoreSnapshot: (profile, snapshotId, newInstanceId) => invoke<void>(...)
deleteSnapshot: (profile, snapshotId) => invoke<void>(...)
listParameterGroups: (profile) => invoke<DbParameterGroup[]>(...)
createParameterGroup: (profile, name, family, description) => invoke<void>(...)
deleteParameterGroup: (profile, name) => invoke<void>(...)
listParameters: (profile, groupName, marker?) => invoke<{ parameters: DbParameter[]; marker: string | null }>("rds_list_parameters", ...)
```

testid 契約: `rds-dash-{instances,available,snapshots}` / `rds-dash-table` / `rds-dash-create` /
nav `nav-rds-dashboard`(`/rds`)・`nav-snapshots`(`/rds/snapshots`)・`nav-parameter-groups`(`/rds/parameter-groups`)。
InstancesPage アクション: `instance-stop` / `instance-start` / `instance-reboot` / `instance-modify`
(モーダル `m-class` / `m-storage` / `m-save`)。SnapshotsPage: `snapshots-table` / `snapshot-row-<id>` /
`snapshots-create`(`snap-instance-select` / `snap-id-input` / `snap-save`)/ `snapshot-restore`
(`restore-id-input` / `restore-save`)/ `snapshots-delete` / `snapshots-unsupported`。
ParameterGroupsPage: `pgroups-table` / `pgroup-row-<name>` / `pgroups-create`(`pg-name` / `pg-family` /
`pg-desc` / `pg-save`)/ `pgroups-delete` / `pg-params-table` / `pg-params-more` / `parameter-groups-unsupported`。

- ダッシュボードのスナップショット数: `rds_list_snapshots` が unsupported エラーなら "-" 表示(カード自体は出す)。
- SnapshotsPage / ParameterGroupsPage の unsupported バナーは BackupsPage 方式(`isUnsupportedOperation`)。
- 操作系(stop/start/…)の失敗は通常 ErrorBanner(R35 と同方針)。

- [ ] Step 1〜6: Task 1 と同じ進行。integration_rds 拡張は ministack で snapshot lifecycle
  (create→list→restore→available→cleanup)、stop/start/reboot、modify(storage 20→30)、
  parameter group(create→list→parameters→delete ※delete 失敗は許容しログ)。unsupported 時 early-return Ok。

### Task 5: E2E + ドキュメント同期(R36〜R50)

**Files:**
- Modify: `e2e/specs/{sqs,sns,s3,rds}.e2e.ts`(R36〜R50 のテスト追記)、`e2e/helpers/app.ts`(追加のみ)、
  `e2e/SPEC-COVERAGE.md`、`AGENTS.md`、`README.md`
- 開始前提: develop の clickEnabledT 修正を feature ブランチに取り込み済みであること(コントローラが実施)。

テスト一覧:
- sqs: R36(SDK seed → ダッシュボードサマリ一致・クイックアクション)/ R37(タグ追加→SDK 検証→削除)/
  R38(RedrivePolicy 付きキューでソース一覧表示 — localstack/floci、ministack では `dlq-sources-unsupported` 表示)
- sns: R39(サマリ)/ R40(横断一覧に SDK seed が出る・解除)/ R41(DisplayName 編集→SDK 検証)/
  R42(タグ追加→SDK 検証→削除)
- s3: R43(バージョニング有効化→SDK 検証、タグ/CORS/ポリシー往復)/ R44(2 版 seed → バージョン表示 →
  旧版ダウンロード内容検証)/ R45(コピー→SDK 検証、フォルダ作成→prefix 行出現)/
  R46(__E2E_UPLOAD_PATH に 9MB 一時ファイル → アップロード → SDK head でサイズ一致)
- rds: R47(サマリ)/ R48(ministack: stop→stopped→start→available→modify 反映。floci: 操作エラーバナー)/
  R49(ministack: snapshot create→restore→削除。他: `snapshots-unsupported`)/
  R50(ministack/floci: PG create→params 表示→削除。localstack: バナー)
- 実行: ministack + localstack:3 + floci の 3 種でスイート全 green(R2 は非標準ポートで fail するのが既知 —
  スキップ方法があれば `--exclude` 等で connections を外して良いが、他スイートは全実行)。

- [ ] Step 1: helpers 追加 → 4 spec 追記 → SPEC-COVERAGE R36〜R50 追記(100%)→ AGENTS/README R 範囲更新
- [ ] Step 2: 3 エミュレータでローカル実行 green → コミット

## Self-Review 済み事項

- R36〜R50 全てにタスクあり。型・コマンド名は spec §2 と一致。T1〜T4 に相互依存なし(SNS キューセレクタ等の新規依存なし)。
- 共有ファイル: lib.rs(union)、unsupported.ts(T1 のみ)。registry.ts / client.ts は今回不変更。
- R46 で `object-upload-input` 廃止に伴い、既存 R31 の E2E アップロード経路修正が必要 — T5 のスコープに含める
  (SPEC-COVERAGE の R31 行も新シームに合わせて更新)。
