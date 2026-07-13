# UI Design Revision(承認済みモック準拠)— Tasks 8-11 への上書き仕様

日付: 2026-07-13
ステータス: ユーザー承認済み。**このドキュメントと `docs/design/ui-mock.html` は、
`2026-07-13-dynamodb-client.md` の Task 8〜11 に書かれた UI 構成・コードと矛盾する場合、常にこちらが優先される。**

## 正とするデザイン

- `docs/design/ui-mock.html` — 承認済みモック。配色・余白・コンポーネントの見た目は
  このモックを Tailwind で忠実に再現する(CSS 変数の値をそのまま Tailwind の任意値として使ってよい)
- テーマは Phase 1 では**ライトのみ**(モック内のダークテーマ CSS は移植不要)
- サービスアイコン: `docs/design/icons/*.svg`(AWS 公式 Architecture Icons)を
  `src/assets/aws/` にコピーして import する

## ルーティング(Task 8 の routes 定義を置き換え)

| パス | 画面 | 備考 |
|---|---|---|
| `/connections` | 接続管理 | **初期画面**。起動時はここに遷移 |
| `/` | ホーム(サービスグリッド) | AWS 公式アイコン使用 |
| `/dynamodb` | → `/dynamodb/tables` へ redirect | |
| `/dynamodb/tables` | テーブル一覧 | サイドバーあり |
| `/dynamodb/tables/:tableName` | テーブル詳細 | サイドバーあり |
| `/dynamodb/explore` | 項目を探索 | サイドバーあり。`?table=名前` で対象テーブル指定 |

- 接続プロファイルが 0 件のとき、`/connections` 以外へのアクセスは `/connections` へリダイレクト

## レイアウト(Task 8)

- **ヘッダー**(モックの `header.top`): brand(クリックで `/`)/ パンくず /
  右側に LOCAL バッジ・接続ピル(色ドット + `<select>`)・リージョン表示・「接続管理」ボタン
- ヘッダー直下に**接続色ライン**(3px、アクティブ接続の `color`。未設定時は `#7c4dff`)
- **サイドバー**(`/dynamodb/*` でのみ表示、モックの `aside.sidenav`):
  見出し「DynamoDB」、有効項目 =「テーブル」「項目を探索」、
  無効(グレーアウト)=「ダッシュボード」「PartiQL エディタ」「バックアップ」、
  末尾に「← サービス一覧へ」リンク
- パンくず: `/dynamodb/tables` → 「DynamoDB › テーブル」、詳細 → 「DynamoDB › テーブル › {name}」、
  explore → 「DynamoDB › 項目を探索」、`/connections` → 「接続管理」、`/` → なし

## 接続管理(Task 9)

計画 Task 9 のコードをベースに、以下を変更:

- 各接続行に **「この接続を使う」**(primary)ボタンを追加。クリックで
  `setActiveId(p.id)` して `/` へ navigate
- 接続確認表示: プロファイルごとに `ddb_list_tables` を軽く叩いて成功なら「接続OK」
  (`status-ok` スタイル)、失敗なら「未確認」を表示(画面表示時に非同期で確認、失敗はエラー扱いにしない)
- その他(検出パネル・追加/編集モーダル・削除)は計画 Task 9 のまま

## テーブル一覧(Task 10)

計画 Task 10 のコードをベースに、以下を変更:

- 列構成: チェックボックス / 名前(リンク) / ステータス(「アクティブ」等) /
  パーティションキー(chip) / ソートキー(chip) / インデックス数
  - ステータスとキー・インデックス数は `ddb_describe_table` を行ごとに非同期取得して埋める
    (取得中は `-` 表示)
- 削除: 行ごとの削除ボタンではなく、**チェックボックスで選択 → ヘッダーの「削除」ボタン**
  (選択 1 件のときのみ有効。テーブル名入力確認は据え置き)
- 「テーブルの作成」ボタンと CreateTableModal は計画のまま

## テーブル詳細 + 項目を探索(Task 11 を 2 画面に分割)

### TableDetailPage(`/dynamodb/tables/:tableName`)

- ヘッダー右: 「テーブルの削除」(danger、名前入力確認)/
  「テーブルの項目を探索」(primary、`/dynamodb/explore?table={name}` へ navigate)
- タブ: **「概要」「インデックス」**(有効)+「モニタリング」「バックアップ」「追加の設定」(無効表示)
  - 概要タブ: カード「一般的な情報」(パーティションキー / ソートキー / 容量モード
    (固定表示「オンデマンド」)/ テーブルステータス)+
    カード「項目の概要」(項目数(概算)/ テーブルサイズ / 右上に「項目を探索」ボタン)
  - インデックスタブ: カード「グローバルセカンダリインデックス (n)」
    (テーブル: 名前 / PK / SK / 射影(ALL 固定表示))+
    カード「ローカルセカンダリインデックス (n)」(0 件なら「ありません」表示)

### ExplorePage(`/dynamodb/explore?table=...`)— 旧 ItemsExplorer を画面に昇格

- ページヘッダー右にテーブル選択 `<select>`(`ddb_list_tables` の結果。変更で `?table=` を更新)
- カード1「スキャンまたはクエリ」:
  - ラジオ: **クエリ / スキャン**(既定: クエリ)
  - 対象 select: 「テーブル - {name}」+ 各 GSI/LSI「インデックス - {index}」
  - クエリ時: PK 行(chip でキー名と型を表示、条件は `=` 固定)+ SK 行(条件: 「次で始まる」/「=」、値は任意)
  - スキャン時: フィルタ行(属性名 / `=` or `contains` / 値)
  - 「実行」(primary)/「リセット」ボタン。クエリは PK 値必須
- カード2「返された項目 (n)」:
  - ヘッダー: 「アクション ▾」(選択行があるときのみ有効。メニューは「削除」のみ。確認つき一括削除)
    + 「項目を作成」(primary、ItemEditorModal を新規モードで開く)
  - テーブル: 先頭にチェックボックス列。**PK 列の値をリンク**にし、クリックで ItemEditorModal を編集モードで開く
  - フッター: 左に件数表示、右にページャ「◀ {ページ番号} ▶」(lastKey スタック方式は計画 Task 11 のまま)
- ItemEditorModal(通常 JSON ⇔ DynamoDB JSON トグル)は計画 Task 11 のコードのまま使用

### ファイル構成の変更(Task 11)

```
src/features/dynamodb/
├── TablesPage.tsx
├── CreateTableModal.tsx
├── TableDetailPage.tsx    # タブ: 概要 / インデックス のみ
├── ExplorePage.tsx        # 旧 ItemsExplorer.tsx(画面として独立)
└── ItemEditorModal.tsx
```

## 手動確認フロー(Task 12 に追記)

起動 → 接続管理(初期画面)→ スキャン検出 → 追加 → 「この接続を使う」→ ホーム →
DynamoDB → サイドバー「テーブル」→ 作成 → 詳細(概要/インデックス)→
「テーブルの項目を探索」→ クエリ/スキャン → 項目を作成/編集/削除 → ページネーション →
ヘッダーで別接続に切り替え(色が変わり、テーブル一覧が切り替わる)
