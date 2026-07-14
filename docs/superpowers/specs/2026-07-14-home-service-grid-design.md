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

## スコープ外

- coming soon サービスの画面実装(グリッド掲載のみ)。
- 各サービスの専用 SVG アイコン作成(略称タイルで代替)。
