# SQS / SNS / S3 / RDS サービス追加 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** サービスレジストリ機構に SQS / SNS / S3 / RDS をフル機能の ServiceDefinition として追加する(spec: `docs/superpowers/specs/2026-07-14-sqs-sns-s3-rds-services-design.md`、要件 R22〜R35)。

**Architecture:** T0 で共有ファイル(依存・アイコン・商標・unsupported 共通化)を先行変更し、T1〜T4 を worktree 分離の並列サブエージェントでサービスごとに実装(各タスクは Rust コマンド + API ラッパー + ページ + registry 配線 + unit/integration テストまで自己完結)。統合後に T5 で E2E とドキュメント同期。

**Tech Stack:** Tauri 2 / React 19 + TS / aws-sdk-{sqs,sns,s3,rds} v1 / tauri-plugin-dialog 2 / Vitest / WebdriverIO。

## Global Constraints

- UI 文言は日本語、識別子・コメントは英語。ライトテーマのみ。既存 DynamoDB ページと同トーン(`docs/design/ui-mock.html` 準拠)。
- ワイヤ契約: Rust struct は serde `rename_all = "camelCase"`、コマンドは `#[tauri::command(rename_all = "camelCase")]`。TS 側ミラーと必ず両側同時変更。
- 新サービスのワイヤ型は各 `src/api/<service>.ts` 内で export(`types.ts` には追記しない)。
- 共通 UI プリミティブ(`src/components/ui/`、`useProfileScopedFetch`、`src/lib/format.ts`)を必ず使用。ページ固有の生 Tailwind カード/ボタン再発明は禁止。
- エラーは既存 `AppError`(`map_sdk_err`)のみ。新エラー型追加禁止。
- クライアント生成は `connections::make_sdk_config`: `aws_sdk_sqs::Client::new(&make_sdk_config(&profile))`。connections.rs は編集不要。
- チェックブロック(タスク完了条件): `npx tsc --noEmit && npx vitest run && (cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test)` が green。
- Integration テストは `#[ignore]` + 環境変数 `EMU_ENDPOINT`(未設定時 `DDB_ENDPOINT` → 既定 `http://localhost:8000`)。ローカル検証でホストポート 4566 / 8000 は使用禁止(`EMU_PORT` で 4571〜4580 を使う)。LocalStack は `localstack/localstack:3` 固定。
- コミットは Conventional Commits。1 ステップ群ごとに頻繁にコミット。
- S3 アップロード上限 100MB(フロントで検証)。SQS 受信は max 10 / visibility 30s / wait 1s。S3 list は delimiter "/" / max 100。RDS 削除は SkipFinalSnapshot=true。

---

## 実行アーキテクチャ(コントローラ向け)

1. **T0**(直列、メインブランチ `feature/sqs-sns-s3-rds` 上): 共有ファイル一括変更。
2. **T1〜T4**(並列、各 worktree、T0 コミットを起点): サービス単位で自己完結。各タスクは共有配線
   (`commands/mod.rs` / `lib.rs` の generate_handler / `api/client.ts` / `services/registry.ts`)に
   「自サービスの 1 行」を追加してよい(worktree 内で単独コンパイル・テスト可能にするため)。
   統合時の cherry-pick コンフリクトは全て「両方残す(union)」で機械的に解消できる。
3. 統合(コントローラ): T1→T2→T3→T4 の順に cherry-pick、チェックブロック実行、タスクレビュー。
4. **T5**(直列): E2E 4 spec + SPEC-COVERAGE + AGENTS.md/README 同期。ローカルで ministack(RDS 対応系)と
   localstack:3(RDS 非対応系)の双方に対して実行して green を確認。
5. 全体レビュー(Opus)→ PR → CI green → merge。

---

### Task 0: 共有スキャフォールディング

**Files:**
- Modify: `src-tauri/Cargo.toml`(deps 追加)
- Modify: `src-tauri/src/lib.rs`(dialog プラグイン登録のみ。generate_handler は触らない)
- Modify: `src-tauri/capabilities/default.json`(`"dialog:default"` 追加)
- Modify: `package.json`(`@tauri-apps/plugin-dialog` 追加)
- Create: `src/assets/aws/icon-rds.svg`
- Modify: `src/pages/Home.tsx:58`(商標表記に「Amazon RDS」追加)
- Create: `src/lib/unsupported.ts` + Test: `src/lib/unsupported.test.ts`
- Modify: `src/features/dynamodb/BackupsPage.tsx:20`(`isUnsupported` を共通化版に差し替え)

**Interfaces:**
- Produces: `isUnsupportedOperation(err: { message: string }): boolean` — `/unknown ?operation|not supported|not yet implemented|pro feature/i` にマッチしたら true。T4(RDS)が使用。
- Produces: Cargo deps `aws-sdk-sqs = "1"`, `aws-sdk-sns = "1"`, `aws-sdk-s3 = "1"`, `aws-sdk-rds = "1"`, `tauri-plugin-dialog = "2"`。npm dep `@tauri-apps/plugin-dialog`。T3 が `save()` を使用。

- [ ] **Step 1**: Cargo.toml に上記 5 依存を追加し、`(cd src-tauri && cargo build)` が通ることを確認。
- [ ] **Step 2**: `lib.rs` の本番側 builder に `.plugin(tauri_plugin_dialog::init())` を追加(E2E/wdio 分岐の両方に必要 — dialog は E2E ビルドでも使う)。capabilities/default.json の permissions に `"dialog:default"` を追加。
- [ ] **Step 3**: `npm install @tauri-apps/plugin-dialog` 実行(lockfile 更新をコミットに含める)。
- [ ] **Step 4**: `icon-rds.svg` を作成。既存 `icon-ddb.svg` を Read して同じ viewBox / 単色系トーンで DB シリンダー型グリフを描く(手書き SVG、path は 3〜5 要素程度に抑える)。
- [ ] **Step 5**: Home.tsx の商標文字列を「…Amazon S3、Amazon RDS、Amazon EC2、Amazon EKS は、…」に変更。既存 Home の vitest があれば文言アサートを更新。
- [ ] **Step 6**: `src/lib/unsupported.ts` を TDD で作成:

```ts
// unsupported.test.ts の要点
expect(isUnsupportedOperation({ message: "UnknownOperationException" })).toBe(true);
expect(isUnsupportedOperation({ message: "This action is not supported" })).toBe(true);
expect(isUnsupportedOperation({ message: "API for service 'rds' not yet implemented or pro feature" })).toBe(true);
expect(isUnsupportedOperation({ message: "ResourceNotFoundException" })).toBe(false);
```

```ts
// unsupported.ts
export const isUnsupportedOperation = (err: { message: string }): boolean =>
  /unknown ?operation|not supported|not yet implemented|pro feature/i.test(err.message);
```

- [ ] **Step 7**: BackupsPage.tsx のローカル `isUnsupported` を削除し `isUnsupportedOperation` を import。`npx vitest run` で既存 backups テストが green のまま確認。
- [ ] **Step 8**: チェックブロック全 green → `git commit -m "chore: scaffold deps, RDS icon, trademark note and shared unsupported detector"`(論理単位で分割コミット可)。

---

## T1〜T4 共通要件(各サービスタスクに全て適用)

- **Rust**: `src-tauri/src/commands/<service>.rs` 新設。先頭は `use crate::connections::{make_sdk_config, ConnectionProfile}; use crate::error::{map_sdk_err, AppError};`(実名は connections.rs / error.rs / commands/dynamodb.rs を Read して合わせる)。全コマンド `#[tauri::command(rename_all = "camelCase")]`、async、`Result<T, AppError>`。`commands/mod.rs` に `pub mod <service>;` を、`lib.rs` の `generate_handler!` に自サービスのコマンドを追記。
- **TS API**: `src/api/<service>.ts` に invoke ラッパー + ワイヤ型 export(`api/dynamodb.ts` が手本)。`api/client.ts` の `api` に 1 行合成(`import { sqs } from "./sqs"; ... export const api = { ..., sqs };` 形式は client.ts の現状を Read して合わせる)。
- **ページ**: `useProfileScopedFetch` で一覧取得、未接続時 `ConnectionRequired`、`PageHeader` + `Card`/`DataTable`、作成は `Modal`+`ModalFooter`、削除は `ConfirmDangerModal`(対象名入力確認)。エラーは `ErrorBanner`(既存ページの利用箇所を Read して同じ配線)。
- **service.tsx**: `ServiceDefinition` を export し、`services/registry.ts` の該当 comingSoon 行を置き換え(RDS は新規挿入、並び: dynamodb, sqs, sns, s3, rds, ec2, eks)。basePath 直下はリスト画面へ `<Navigate>`。
- **Unit テスト**: 各ページ・モーダルに vitest(api モック、一覧描画 / 作成 / 削除確認 / エラーバナー / プロファイル未選択)。既存 `src/features/dynamodb/TablesPage.test.tsx` 等を手本に。
- **Integration テスト**: `src-tauri/tests/` または `commands/<service>.rs` 内 `#[cfg(test)] #[ignore]`(dynamodb の既存 integration テストの置き場所を Read して同じ場所に)。エンドポイント解決は
  `std::env::var("EMU_ENDPOINT").or_else(|_| std::env::var("DDB_ENDPOINT")).unwrap_or("http://localhost:8000".into())`。
- **完了条件**: チェックブロック green + integration テストがローカル ministack(`scripts/emulator.sh start ministack` を `EMU_PORT=457X` で)に対して green。

---

### Task 1: SQS(R22〜R25)

**Files:**
- Create: `src-tauri/src/commands/sqs.rs`
- Create: `src/api/sqs.ts`
- Create: `src/features/sqs/QueuesPage.tsx` / `QueueDetailPage.tsx` / `CreateQueueModal.tsx` / `SendMessageModal.tsx` / `service.tsx`
- Test: `src/features/sqs/QueuesPage.test.tsx` / `QueueDetailPage.test.tsx`
- Modify: `commands/mod.rs`, `lib.rs`, `api/client.ts`, `services/registry.ts`(共通要件どおり)

**Interfaces(Produces — T5 E2E が依存):**

Rust コマンド(spec §2.1 の sqs ブロックを逐語で実装):
`sqs_list_queues` / `sqs_get_queue` / `sqs_create_queue` / `sqs_delete_queue` / `sqs_set_queue_attributes` / `sqs_send_message` / `sqs_receive_messages` / `sqs_delete_message` / `sqs_purge_queue`。

TS API(型は spec §2.1 の camelCase ミラー):

```ts
export interface QueueSummary { queueUrl: string; name: string; fifo: boolean; approximateMessages: number; approximateNotVisible: number; }
export interface QueueDetail extends QueueSummary { arn: string; visibilityTimeout: number; retentionPeriod: number; delaySeconds: number; maxMessageSize: number; redrivePolicy: string | null; createdAt: string | null; }
export interface CreateQueueRequest { name: string; fifo: boolean; visibilityTimeout?: number; retentionPeriod?: number; delaySeconds?: number; redrivePolicy?: string; }
export interface QueueAttributesUpdate { visibilityTimeout: number; retentionPeriod: number; delaySeconds: number; redrivePolicy?: string; }
export interface SendMessageRequest { body: string; delaySeconds?: number; attributes?: Record<string, { dataType: string; stringValue: string }>; groupId?: string; dedupId?: string; }
export interface SqsMessage { messageId: string; receiptHandle: string; body: string; attributes: Record<string, unknown>; sentAt: string | null; }
export const sqs = {
  listQueues: (profile: ConnectionProfile) => invoke<QueueSummary[]>("sqs_list_queues", { profile }),
  getQueue: (profile: ConnectionProfile, queueUrl: string) => invoke<QueueDetail>("sqs_get_queue", { profile, queueUrl }),
  createQueue: (profile: ConnectionProfile, req: CreateQueueRequest) => invoke<void>("sqs_create_queue", { profile, req }),
  deleteQueue: (profile: ConnectionProfile, queueUrl: string) => invoke<void>("sqs_delete_queue", { profile, queueUrl }),
  setQueueAttributes: (profile: ConnectionProfile, queueUrl: string, req: QueueAttributesUpdate) => invoke<void>("sqs_set_queue_attributes", { profile, queueUrl, req }),
  sendMessage: (profile: ConnectionProfile, queueUrl: string, req: SendMessageRequest) => invoke<void>("sqs_send_message", { profile, queueUrl, req }),
  receiveMessages: (profile: ConnectionProfile, queueUrl: string) => invoke<SqsMessage[]>("sqs_receive_messages", { profile, queueUrl }),
  deleteMessage: (profile: ConnectionProfile, queueUrl: string, receiptHandle: string) => invoke<void>("sqs_delete_message", { profile, queueUrl, receiptHandle }),
  purgeQueue: (profile: ConnectionProfile, queueUrl: string) => invoke<void>("sqs_purge_queue", { profile, queueUrl }),
};
```

testid 契約(E2E が使用。変更禁止):
- nav: `nav-queues`。一覧: `queues-create` / `queues-delete` / `queue-link-<name>`(行内リンク)/ 行選択チェックは DataTable の selection。
- 作成モーダル: `q-name` / `q-fifo` / `q-visibility` / `q-retention` / `q-delay` / `q-redrive` / 保存 `q-save`。
- 詳細: タブ `tab-messages` / `tab-settings`。送信ボタン `queue-send`、モーダル `sm-body` / `sm-delay` / `sm-group-id` / `sm-dedup-id` / `sm-save`。ポーリング `queue-poll`、メッセージ表 `messages-table`、行 `msg-row-<messageId>`、行展開で本文全文、選択削除 `msg-delete`、パージ `queue-purge`(ConfirmDangerModal、確認語はキュー名)。設定タブ: `qs-visibility` / `qs-retention` / `qs-delay` / `qs-redrive` / `qs-save`。

**実装メモ:**
- `sqs_list_queues`: ListQueues 後、各 URL へ GetQueueAttributes(All)を逐次呼び(キュー数は少量前提)、`ApproximateNumberOfMessages` / `ApproximateNumberOfMessagesNotVisible` / `FifoQueue` を集計。name は URL 末尾セグメント。
- `sqs_create_queue`: fifo=true なら name に `.fifo` を自動付与(UI 側でも suffix プレビュー表示)し、Attributes に `FifoQueue=true`。
- `sqs_receive_messages`: `max_number_of_messages(10).visibility_timeout(30).wait_time_seconds(1)`、`message_system_attribute_names(All)` で SentTimestamp を取得し ISO8601 文字列へ。
- FIFO 送信時は `sm-group-id` 必須バリデーション(FIFO でない場合は両フィールド非表示)。
- R23 属性編集: 設定タブは QueueDetail の現在値を初期値に、保存で `setQueueAttributes` → 再取得。

- [ ] **Step 1**: `sqs.rs` の型・コマンド 9 本を実装(TDD 対象のロジックは name 抽出と fifo 判定程度なので、`#[cfg(test)]` で URL→name のユニットテストを先に書く)。mod.rs / lib.rs 配線。`cargo clippy -- -D warnings` green。
- [ ] **Step 2**: integration テスト(`#[ignore]`)を追加: create(standard)→ send → receive(body 一致)→ delete_message → purge → set/get attributes(visibility 変更が反映)→ delete。FIFO は create+send のみ、`Err` の場合は `eprintln!` してスキップ扱いで `Ok` を返す(spec §3「許容スキップ」)。
- [ ] **Step 3**: `api/sqs.ts` + client.ts 合成。`npx tsc --noEmit` green。
- [ ] **Step 4**: QueuesPage を TDD で(テスト → 実装): 一覧(名前/種別バッジ/メッセージ数)、作成モーダル、選択削除(名前確認)。
- [ ] **Step 5**: QueueDetailPage を TDD で: メッセージタブ(送信/ポーリング/削除/パージ)、設定タブ(属性編集)。ルートは `/sqs/queues/:name`(URL は一覧で取得した queueUrl を `location.state` 経由でなく、詳細側で listQueues から name 解決 — リロード耐性のため)。
- [ ] **Step 6**: `service.tsx` + registry 置き換え。nav: `[{ label: "キュー", path: "/sqs/queues", testId: "nav-queues", group: 0 }]`、home `/sqs/queues`、crumbLabel で `キュー / <name>`。
- [ ] **Step 7**: チェックブロック + ministack integration green → 論理単位でコミット(`feat: add SQS queue commands` / `feat: add SQS pages and service registration` 等)。

---

### Task 2: SNS(R26〜R28)

**Files:**
- Create: `src-tauri/src/commands/sns.rs`、`src/api/sns.ts`
- Create: `src/features/sns/TopicsPage.tsx` / `TopicDetailPage.tsx` / `CreateTopicModal.tsx` / `service.tsx`
- Test: `src/features/sns/TopicsPage.test.tsx` / `TopicDetailPage.test.tsx`
- Modify: 共有配線 4 ファイル(共通要件どおり)

**Interfaces:**

Rust: `sns_list_topics` / `sns_create_topic` / `sns_delete_topic` / `sns_list_subscriptions` / `sns_subscribe_sqs` / `sns_unsubscribe` / `sns_publish`(spec §2.1 sns ブロック逐語)。

```ts
export interface TopicSummary { topicArn: string; name: string; fifo: boolean; }
export interface SnsSubscription { subscriptionArn: string; protocol: string; endpoint: string; filterPolicy: string | null; rawDelivery: boolean; }
export interface PublishRequest { message: string; subject?: string; attributes?: Record<string, { dataType: string; stringValue: string }>; groupId?: string; dedupId?: string; }
export const sns = {
  listTopics: (profile: ConnectionProfile) => invoke<TopicSummary[]>("sns_list_topics", { profile }),
  createTopic: (profile: ConnectionProfile, name: string, fifo: boolean) => invoke<void>("sns_create_topic", { profile, name, fifo }),
  deleteTopic: (profile: ConnectionProfile, topicArn: string) => invoke<void>("sns_delete_topic", { profile, topicArn }),
  listSubscriptions: (profile: ConnectionProfile, topicArn: string) => invoke<SnsSubscription[]>("sns_list_subscriptions", { profile, topicArn }),
  subscribeSqs: (profile: ConnectionProfile, topicArn: string, queueArn: string, filterPolicy: string | null, rawDelivery: boolean) => invoke<void>("sns_subscribe_sqs", { profile, topicArn, queueArn, filterPolicy, rawDelivery }),
  unsubscribe: (profile: ConnectionProfile, subscriptionArn: string) => invoke<void>("sns_unsubscribe", { profile, subscriptionArn }),
  publish: (profile: ConnectionProfile, topicArn: string, req: PublishRequest) => invoke<void>("sns_publish", { profile, topicArn, req }),
};
```

testid 契約:
- nav: `nav-topics`。一覧: `topics-create` / `topics-delete` / `topic-link-<name>`。作成モーダル: `t-name` / `t-fifo` / `t-save`。
- 詳細: タブ `tab-subs` / `tab-publish`。サブスク: `sub-add`(モーダル: `sub-queue-select` / `sub-filter` / `sub-raw` / `sub-save`)、表 `subs-table`、行 `sub-row-<endpoint末尾のキュー名>`、解除 `sub-remove`(確認付き)。
- 発行タブ: `pub-subject` / `pub-message` / `pub-group-id` / `pub-dedup-id` / `pub-save`、成功表示 `publish-result`(「発行しました (MessageId: …)」等の日本語テキスト。sns_publish の戻りを `invoke<string>` にして MessageId を返しても良い — その場合 TS 型も `Promise<string>` に揃える)。

**実装メモ:**
- `sns_subscribe_sqs`: protocol "sqs"、endpoint に queueArn。filter_policy は Attributes `FilterPolicy`、raw は `RawMessageDelivery="true"`。
- キューセレクタは `api.sqs.listQueues` + `api.sqs.getQueue`(ARN 取得)で構成(T1 の API に依存 — worktree では T1 未取込のため、**このタスクは T1 の `api/sqs.ts` と `sqs.rs` を Consumes に持つ。コントローラは T1 完了後に T2 を開始するか、T2 worktree に T1 コミットを取り込むこと**)。
- `sns_create_topic`: fifo は name `.fifo` 付与 + Attributes `FifoTopic=true`。
- name→ARN 解決は詳細ページで list_topics から(URL パラメータは name)。
- integration テスト: topic → SQS queue 作成 → subscribe → publish → SQS receive で envelope の `Message` フィールド一致 → unsubscribe → cleanup(SNS→SQS 実配信の検証、spec §0)。

- [ ] **Step 1**: `sns.rs` 実装 + 配線 + clippy green(ARN→name 抽出のユニットテスト先行)。
- [ ] **Step 2**: integration テスト(上記フロー)。
- [ ] **Step 3**: `api/sns.ts` + client.ts 合成、tsc green。
- [ ] **Step 4**: TopicsPage / CreateTopicModal を TDD で。
- [ ] **Step 5**: TopicDetailPage(サブスク一覧・追加・解除、発行フォーム、FIFO 分岐)を TDD で。
- [ ] **Step 6**: `service.tsx`(nav: トピック / `nav-topics`、home `/sns/topics`)+ registry 置き換え。
- [ ] **Step 7**: チェックブロック + ministack integration green → コミット。

---

### Task 3: S3(R29〜R32)

**Files:**
- Create: `src-tauri/src/commands/s3.rs`、`src/api/s3.ts`
- Create: `src/features/s3/BucketsPage.tsx` / `BucketBrowserPage.tsx` / `CreateBucketModal.tsx` / `service.tsx`
- Test: `src/features/s3/BucketsPage.test.tsx` / `BucketBrowserPage.test.tsx`
- Modify: 共有配線 4 ファイル

**Interfaces:**

Rust: `s3_list_buckets` / `s3_create_bucket` / `s3_delete_bucket` / `s3_list_objects` / `s3_head_object` / `s3_put_object` / `s3_download_object` / `s3_delete_object`(spec §2.1 s3 ブロック逐語)。

```ts
export interface BucketSummary { name: string; createdAt: string | null; }
export interface ObjectSummary { key: string; size: number; lastModified: string | null; }
export interface ObjectPage { prefixes: string[]; objects: ObjectSummary[]; nextToken: string | null; }
export interface ObjectDetail { key: string; size: number; contentType: string | null; etag: string | null; lastModified: string | null; metadata: Record<string, string>; }
export const s3 = {
  listBuckets: (profile: ConnectionProfile) => invoke<BucketSummary[]>("s3_list_buckets", { profile }),
  createBucket: (profile: ConnectionProfile, name: string) => invoke<void>("s3_create_bucket", { profile, name }),
  deleteBucket: (profile: ConnectionProfile, name: string) => invoke<void>("s3_delete_bucket", { profile, name }),
  listObjects: (profile: ConnectionProfile, bucket: string, prefix: string, nextToken?: string) => invoke<ObjectPage>("s3_list_objects", { profile, bucket, prefix, nextToken }),
  headObject: (profile: ConnectionProfile, bucket: string, key: string) => invoke<ObjectDetail>("s3_head_object", { profile, bucket, key }),
  putObject: (profile: ConnectionProfile, bucket: string, key: string, bodyBase64: string, contentType?: string) => invoke<void>("s3_put_object", { profile, bucket, key, bodyBase64, contentType }),
  downloadObject: (profile: ConnectionProfile, bucket: string, key: string, destPath: string) => invoke<void>("s3_download_object", { profile, bucket, key, destPath }),
  deleteObject: (profile: ConnectionProfile, bucket: string, key: string) => invoke<void>("s3_delete_object", { profile, bucket, key }),
};
```

testid 契約:
- nav: `nav-buckets`。一覧: `buckets-create` / `buckets-delete` / `bucket-link-<name>`。作成モーダル: `b-name` / `b-save`。
- ブラウザ: パンくず `prefix-crumb-<i>`(0=ルート)、フォルダ行 `prefix-link-<相対名>`、オブジェクト行 `object-row-<相対名>`(クリックで詳細パネル)、`objects-next` / `objects-prev` は不要(further ページは `objects-more`「さらに読み込む」ボタン方式)。
- 操作: `object-upload`(ボタン)+ 隠し `<input type="file" data-testid="object-upload-input">`、`object-download`、`objects-delete`(選択削除、ConfirmDangerModal 確認語はバケット名)、詳細パネル `od-size` / `od-content-type` / `od-etag` / `od-modified`。

**実装メモ:**
- `s3_put_object`: `base64::engine::general_purpose::STANDARD.decode(body_base64)`(base64 クレートは attr.rs で使用中の同 API を Read して合わせる)。key は `currentPrefix + fileName`。
- `s3_download_object`: GetObject → `tokio::fs::write(dest_path, bytes)`(または std::fs — 既存コードの async 度合いに合わせる)。ダウンロード先の取得は UI 側: `window.__E2E_SAVE_PATH ?? await save({ defaultPath: fileName })`(`@tauri-apps/plugin-dialog`)。save() が null(キャンセル)なら何もしない。`declare global { interface Window { __E2E_SAVE_PATH?: string } }` を BucketBrowserPage 内に。
- アップロード: `file.arrayBuffer()` → chunk せず一括 base64(`FileReader.readAsDataURL` の data: プレフィックス除去でも可)。`file.size > 100 * 1024 * 1024` なら ErrorBanner に日本語検証メッセージ(Rust に到達させない)。完了後に現在プレフィックスを再取得。
- `s3_list_objects`: `delimiter("/")`, `prefix(prefix)`, `max_keys(100)`, continuation_token。CommonPrefixes → `prefixes`、Contents から prefix 自身(サイズ 0 のフォルダマーカー)は除外。
- `?prefix=` クエリで状態保持(`useSearchParams`)。パンくずは prefix を "/" 分割。
- バケット削除: 非空エラーはそのまま ErrorBanner(R29)。
- integration テスト: bucket → put(text)→ list(prefix 階層: `a/b.txt` を置いて delimiter 動作確認)→ head(contentType/size)→ get(download_object をテンポラリパスへ、内容一致)→ delete → bucket 削除。非空 delete_bucket が Err になることも確認。

- [ ] **Step 1**: `s3.rs` 実装 + 配線 + clippy green。
- [ ] **Step 2**: integration テスト(上記)。
- [ ] **Step 3**: `api/s3.ts` + client.ts 合成、tsc green。
- [ ] **Step 4**: BucketsPage / CreateBucketModal を TDD で。
- [ ] **Step 5**: BucketBrowserPage を TDD で(プレフィックスナビ / アップロード(File モック)/ ダウンロード(save() モック + __E2E_SAVE_PATH 分岐)/ 削除 / 詳細パネル / 100MB 検証)。
- [ ] **Step 6**: `service.tsx`(nav: バケット / `nav-buckets`、home `/s3/buckets`、crumbLabel で `バケット / <bucket>`)+ registry 置き換え。
- [ ] **Step 7**: チェックブロック + ministack integration green(Rust SDK は CRC32 なので追加設定不要)→ コミット。

---

### Task 4: RDS(R33〜R35)

**Files:**
- Create: `src-tauri/src/commands/rds.rs`、`src/api/rds.ts`
- Create: `src/features/rds/InstancesPage.tsx` / `CreateInstanceModal.tsx` / `service.tsx`
- Test: `src/features/rds/InstancesPage.test.tsx`
- Modify: 共有配線 4 ファイル

**Interfaces:**

Rust: `rds_list_instances` / `rds_create_instance` / `rds_delete_instance`(spec §2.1 rds ブロック逐語)。

```ts
export interface DbInstanceSummary { id: string; engine: string; status: string; instanceClass: string; endpointAddress: string | null; endpointPort: number | null; allocatedStorage: number | null; }
export interface CreateDbInstanceRequest { id: string; engine: string; instanceClass: string; masterUsername: string; masterPassword: string; allocatedStorage: number; }
export const rds = {
  listInstances: (profile: ConnectionProfile) => invoke<DbInstanceSummary[]>("rds_list_instances", { profile }),
  createInstance: (profile: ConnectionProfile, req: CreateDbInstanceRequest) => invoke<void>("rds_create_instance", { profile, req }),
  deleteInstance: (profile: ConnectionProfile, id: string) => invoke<void>("rds_delete_instance", { profile, id }),
};
```

testid 契約:
- nav: `nav-instances`。一覧: `instances-create` / `instances-delete` / `instance-row-<id>`。
- 作成モーダル: `i-id` / `i-engine`(select: mysql / postgres)/ `i-class`(既定 "db.t3.micro")/ `i-username` / `i-password` / `i-storage`(既定 20)/ `i-save`。
- 非対応バナー: `rds-unsupported`(amber 系、BackupsPage の `backups-unsupported` バナーと同構造)。表示時は `instances-create` を描画しない(R34)。バナー本文に「対応エミュレータ: ministack、floci(--volume /var/run/docker.sock マウント時)」を含める。
- describe 成功 & create 失敗時は通常 ErrorBanner(R35 — `isUnsupportedOperation` に該当しないエラーは非対応バナーにしない)。

**実装メモ:**
- 一覧ロードのエラーを `isUnsupportedOperation`(T0 の `src/lib/unsupported.ts`)で分類(BackupsPage.tsx:167-283 の unsupported/error 二段構えをそのまま踏襲)。
- `rds_delete_instance`: `.skip_final_snapshot(true)`。
- StatusBadge: status "available" → 緑系(既存 StatusBadge の対応を Read して従う)。
- integration テスト: `#[ignore]` + さらに RDS 対応エミュレータ前提のため、リスト取得が unsupported エラーなら early-return Ok(スキップ扱い)。対応時は create → list に available で出現 → delete。
- masterPassword はフロントの state のみに保持し、profile 保存等に書かない(シークレット禁止則)。

- [ ] **Step 1**: `rds.rs` 実装 + 配線 + clippy green。
- [ ] **Step 2**: integration テスト(unsupported 時スキップ設計込み)。
- [ ] **Step 3**: `api/rds.ts` + client.ts 合成、tsc green。
- [ ] **Step 4**: InstancesPage / CreateInstanceModal を TDD で(unsupported 分岐・R35 分岐のユニットテスト必須)。
- [ ] **Step 5**: `service.tsx`(id "rds"、name "RDS"、description "リレーショナルデータベース"、icon は T0 の `icon-rds.svg`、nav: データベース / `nav-instances`、home `/rds/instances`)+ registry へ新規挿入(s3 の後)。
- [ ] **Step 6**: チェックブロック green(integration はローカル ministack で)→ コミット。

---

### Task 5: E2E + ドキュメント同期(統合後・直列)

**Files:**
- Create: `e2e/specs/sqs.e2e.ts` / `sns.e2e.ts` / `s3.e2e.ts` / `rds.e2e.ts`
- Modify: `e2e/helpers/app.ts`(必要ヘルパー追加のみ、既存変更禁止)
- Modify: `e2e/SPEC-COVERAGE.md`(R22〜R35 追記、100% 維持)
- Modify: `AGENTS.md`(R 範囲 R1..R21 → R1..R35 の記述更新)、`README.md`(同様の記述があれば)

**Interfaces:**
- Consumes: T1〜T4 の testid 契約(上記)と `@aws-sdk/client-{sqs,sns,s3,rds}`(E2E 検証用 SDK。`e2e/package.json` に devDependency 追加 — 既存 E2E が DynamoDB 検証に使う SDK パッケージの流儀を Read して合わせる)。

**テスト一覧(spec §3):**
- `sqs.e2e.ts`: R22(SDK で 2 キュー seed → 一覧表示・メッセージ数)/ R23(UI 作成 → SDK で属性検証、UI 属性編集 → SDK 検証、UI 削除)/ R24(UI 送信 → SDK receive で本文・属性一致)/ R25(SDK send seed → UI ポーリング表示 → UI 削除 → SDK で消滅確認、パージ)。
- `sns.e2e.ts`: R26(作成/一覧/削除)/ R27(SQS サブスク追加 → 一覧表示 → 解除)/ R28(UI publish → SDK で SQS receive、envelope.Message 一致。filterPolicy 付きサブスクで不一致メッセージが届かないことまでは不要)。
- `s3.e2e.ts`: R29(作成/一覧/非空削除エラー/空削除)/ R30(SDK で `a/b.txt`,`a/c/d.txt`,`e.txt` seed → プレフィックスナビ・パンくず・`?prefix=`)/ R31(file input 直接設定または DataTransfer 合成でアップロード → SDK GetObject 検証。`browser.execute(p => { window.__E2E_SAVE_PATH = p }, path)` → download → Node fs で内容検証)/ R32(詳細パネルのメタデータ表示、選択削除)。
- `rds.e2e.ts`: before で SDK 3 分岐プローブ(describe 失敗(unsupported)→ R34 のみ / describe+create 成功 → R33 / describe 成功・create 失敗 → R35)。R33: UI 作成 → 一覧に available → UI 削除。R34: `rds-unsupported` 表示 + `instances-create` 非存在。R35: 一覧表示 + UI 作成でエラーバナー。各分岐は他分岐のテストを自己スキップ(backups.e2e.ts の `[^backup]` 方式を踏襲)。

- [ ] **Step 1**: E2E 用 SDK devDeps 追加、helpers に goto ヘルパー等を追加。
- [ ] **Step 2**: 4 spec ファイルを作成(seed/cleanup は SDK 直、backups.e2e.ts の構造を手本に)。
- [ ] **Step 3**: `npm run e2e:build` → ministack(`EMU_PORT=4573` 等)で `E2E_ENDPOINT=http://localhost:4573 npm run e2e` green(R33 分岐)。
- [ ] **Step 4**: localstack:3(別ポート)でも実行し R34 分岐 green。既存 R1〜R21 も含めスイート全 green を確認。
- [ ] **Step 5**: SPEC-COVERAGE.md に R22〜R35 の行 + 脚注(RDS 3 分岐)を追記。AGENTS.md / README の R 範囲記述を更新。
- [ ] **Step 6**: チェックブロック green → コミット(`test: add SQS/SNS/S3/RDS e2e specs (R22-R35)` / `docs: ...`)。

---

## Self-Review 済み事項

- spec R22〜R35 全てにタスクあり(R22-25→T1、R26-28→T2、R29-32→T3、R33-35→T4、E2E→T5、商標/unsupported/icon→T0)。
- 型名・コマンド名は spec §2.1 と逐語一致。T2 の SQS 依存(キューセレクタ)は Consumes として明記し、コントローラが T1 コミットを T2 worktree に供給する。
- 共有ファイル(mod.rs / lib.rs / client.ts / registry.ts)の並列編集は union 解消前提で許容(統合手順に明記)。
