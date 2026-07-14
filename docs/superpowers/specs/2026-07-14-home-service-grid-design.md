# Home サービスグリッド簡素化 設計書

日付: 2026-07-14
ステータス: ユーザー要望による確定仕様(E2E 要件 R には追加しない。smoke の Home 経由遷移が回帰ガード)

## 要件

1. Home のサービスカードは **ロゴ(またはタイル)+ サービス名のみ** を表示する。
   説明文(「NoSQL データベース」「coming soon」等)はカードに表示しない。
2. **有効(enabled)なサービスをグリッドの先頭に**、未実装(グレー)のサービスをその後ろに並べる。
   各グループ内はレジストリ定義順。
3. グリッドには **floci(community, 2026-07-14 実機調査で 68 サービス対応)が対応する全サービス**を
   コンソール単位で掲載する(サブ API は親サービスに集約: IoT Data→IoT Core、SES v1/v2→SES、
   API Gateway v1/v2→API Gateway、RDS Data API→RDS 等。STS/Resource Groups Tagging 等の
   補助 API はカード化しない)。実装済み 5 種 + coming soon 約 58 種。
4. 専用 SVG アイコンが無いサービスは、略称タイル(角丸スクエア + 単語頭文字 2〜3 文字、
   単一語は先頭 3 文字大文字)で表示する。`ServiceDefinition.icon` は optional に変更。
5. 商標表記はサービス数の増加に合わせて包括表現に変更:
   「Amazon Web Services および本アプリに表示される各 AWS サービス名は、Amazon.com, Inc.
   またはその関連会社の商標です。本アプリは AWS 非公式のローカルエミュレータ用クライアントです。」

## 実装

- `src/services/types.ts`: `icon?: string` に変更。
- `src/services/registry.ts`: `FLOCI_COMING_SOON` リスト(id, name)を定義し comingSoon 展開。
  既存 SVG がある ec2 / eks のみアイコン付与。
- `src/pages/Home.tsx`: description 表示を削除、`Icon` に略称タイルフォールバック追加、
  `enabled` 降順ソート、商標文差し替え。

## 追加要件(2026-07-14 更新)

### 公式サービスアイコン

6. Home のサービスカードは **AWS 公式 Architecture Icons(Service icons, 64px)** を表示する。
   出典は npm パッケージ `aws-svg-icons`(ISC ライセンス。https://aws.amazon.com/architecture/icons/
   の公式 SVG を同梱)。`src/services/icons.ts` が service id → アイコン URL の対応表
   `SERVICE_ICONS` を提供し、`registry.ts` が全サービスに一括適用する(実装済みサービスの
   従来アイコンも公式アイコンで上書き)。
7. 2021 年版アイコンセットに存在しない新しめのサービス(Bedrock / MemoryDB / Billing /
   Cloud Control / Resource Groups)は `SERVICE_ICONS` にエントリを持たず、要件 4 の略称タイルに
   フォールバックする。
8. 専用アイコンが無いがサブ機能として親サービスのアイコンを流用するもの:
   EventBridge Scheduler / Pipes → EventBridge、CloudWatch Logs → CloudWatch、
   S3 Vectors → S3、OpenSearch → Elasticsearch(前身サービス)。

### サービス検索

9. サービスグリッド上部に検索ボックス(`data-testid="service-search"`、placeholder「サービスを検索」)。
   入力値でサービス名(name)と id を **大文字小文字無視の部分一致** でフィルタする。
   enabled 先頭のソート(要件 2)は維持する。
10. 該当 0 件時は「該当するサービスがありません」(`data-testid="service-search-empty"`)を表示する。

### リージョン一覧の拡充

11. リージョン一覧を AWS 商用リージョン(2026 年時点の主要どころ約 33 件)に拡充し、
    `src/lib/regions.ts` の `AWS_REGIONS` に共通定義する。並びは利用頻度上位
    (ap-northeast-1, us-east-1, us-west-2, ap-northeast-3)を先頭に、残りをアルファベット順。
12. ヘッダのリージョンセレクタ(Layout)と接続編集フォーム(ConnectionsPage、datalist 候補)は
    この共通定数を共有する。E2E R17 が使う `ap-northeast-1` / `us-east-1` は一覧に含める。

## スコープ外

- coming soon サービスの画面実装(グリッド掲載のみ)。
- 2021 版セットに無いサービスの専用アイコン作成(略称タイルで代替)。
