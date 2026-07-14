# Phase 3: ダッシュボード / PartiQL エディタ / バックアップ 設計

Phase 1 スペック(2026-07-13-neo-localstack-desktop-dynamodb-design.md)の追補。
サイドバーでグレーアウトしていた 3 項目(ダッシュボード / PartiQL エディタ / バックアップ)を
実装して有効化する。要件 ID は R18〜R21 を追加する。

## エミュレータ能力調査(2026-07-14 実測)

| API | localstack:3 | floci | ministack | dynamodb-local |
| --- | --- | --- | --- | --- |
| ExecuteStatement (PartiQL SELECT/INSERT/UPDATE/DELETE) | ✅ | ✅ | ✅ | ✅ |
| CreateBackup / ListBackups / DescribeBackup / RestoreTableFromBackup / DeleteBackup | ❌ UnknownOperationException | ❌ "not supported" | ✅(復元でデータも戻ることを確認) | ❌ UnknownOperationException |

→ PartiQL は全エミュレータで無条件に提供。バックアップは対応エミュレータでのみ動作し、
非対応エミュレータでは分かりやすいエラーバナーを表示する(能力はエラー応答で判定、事前判定はしない)。

## 要件

### R18: ダッシュボード(`/dynamodb`)

- サイドバー「ダッシュボード」を有効化。`/dynamodb` はリダイレクトをやめてダッシュボードを表示。
- 表示内容(既存 API `ddb_list_tables` + `ddb_describe_table` の合成、Rust 変更なし):
  - サマリカード: テーブル数 / 合計アイテム数 / 合計サイズ(bytes を適切な単位で表示)
  - テーブル一覧(名前・ステータス・アイテム数)。行クリックでテーブル詳細へ。
  - クイックアクション: 「テーブルを作成」(→ /dynamodb/tables、作成モーダルを開くクエリ `?create=1`)/「項目を探索」(→ /dynamodb/explore)
- テーブル 0 件時は空状態メッセージ + 作成導線。
- 取得エラーは ErrorBanner + 再試行。

### R19: PartiQL エディタ(`/dynamodb/partiql`)

- サイドバー「PartiQL エディタ」を有効化。
- ステートメント入力(textarea)+「実行」ボタン。テーブル一覧セレクタから
  `SELECT * FROM "<table>"` テンプレートを挿入できる。
- SELECT: 結果をテーブル表示(通常 JSON 表示。ワイヤは DynamoDB JSON、UI エッジで変換)。
  `nextToken` があれば「さらに読み込む」で追記ロード。
- INSERT / UPDATE / DELETE: 成功メッセージ「ステートメントを実行しました(0 件の結果)」系を表示。
- 構文エラー等は ErrorBanner に表示。
- Rust: `ddb_execute_statement(profile, statement, nextToken?) -> { items: DdbItem[], nextToken? }`

### R20: バックアップ(`/dynamodb/backups`)

- サイドバー「バックアップ」を有効化。
- バックアップ一覧(バックアップ名 / テーブル / ステータス / サイズ / 作成日時)。
- 「バックアップを作成」: テーブル選択 + バックアップ名入力のモーダル。
- 「復元」: 復元先テーブル名を入力するモーダル → RestoreTableFromBackup。
- 「削除」: 確認付き削除。
- Rust: `ddb_list_backups` / `ddb_create_backup` / `ddb_delete_backup` / `ddb_restore_backup`。

### R21: バックアップ非対応エミュレータのフォールバック

- ListBackups 等が UnknownOperationException / "not supported" を返す場合、
  バックアップ画面に「このエミュレータはバックアップ API をサポートしていません
  (ministack は対応しています)」の案内バナー(`data-testid="backups-unsupported"`)を表示し、
  操作 UI を無効化する。生のエラー文も併記する。
- E2E は接続先エミュレータの能力を SDK でプローブし、対応なら R20 のフロー、
  非対応なら本バナーをアサートする(同一スイートが全エミュレータで green になる)。

## ワイヤ契約(camelCase、両側同時変更)

```
PartiqlResult { items: DdbItem[], nextToken?: string }
BackupSummary { backupArn, backupName, tableName, status, sizeBytes?, createdAt? (RFC3339) }
```

## E2E / トレーサビリティ

- `e2e/SPEC-COVERAGE.md` に R18〜R21 を追加し、100% を維持する。
- 既存 3 エミュレータ + CI 構成は変更なし。バックアップの実動作検証は ministack が担う。
