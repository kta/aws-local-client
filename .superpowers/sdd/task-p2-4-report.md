# Task P2-4 レポート: E2E 仕様 100% スイート + トレーサビリティ表

## 結論

**成功(GREEN)**。R1〜R17 の全 17 要件を E2E 化し、LocalStack / floci / ministack の 3 エミュレータ
すべてに対して**フルスイート 31/31 テスト green**を実機確認。`e2e/SPEC-COVERAGE.md` は全 17 行が
埋まっており、要件カバレッジ 100%。GSI を含め per-emulator スキップは 0 件(下記脚注参照)。

## 成果物

- `e2e/helpers/emulator.ts` — `@aws-sdk/client-dynamodb`(既存 devDep)でのシード/クリーンアップ。
  `createTable`(delete-then-create + ACTIVE 待ち)/ `putItems`(25 件バッチ + UnprocessedItems リトライ)/
  `seedItems`(R9 の 55 件投入)/ `deleteTable` / `makeClient(endpoint, region)`。
- `e2e/helpers/app.ts` — 画面操作ヘルパ(接続登録・切替・削除、テーブル作成/削除、explore の scan/query/
  ページネーション、アイテム CRUD、ヘッダーのリージョン/接続切替、`clearAllConnections` 等)。
- `e2e/specs/connections.e2e.ts`(R1,R2,R3,R13,R14,R17)/ `tables.e2e.ts`(R4,R5,R6,R15,R16)/
  `items.e2e.ts`(R7,R8,R9,R10,R11,R12)。テスト名に要件 ID を明記。
- `e2e/SPEC-COVERAGE.md` — 要件ID / 仕様文 / テスト の対応表(全 17 行)。
- wdio: `afterTest` で失敗時スクショを `e2e/screenshots/` に保存、ログは `outputDir=e2e/logs/`。
  両ディレクトリは `.gitignore` 済み(CI が失敗時にアップロードするための出力先)。

## per-emulator 結果(2026-07-13、macOS / Apple Silicon、E2E_ENDPOINT=http://localhost:4567)

| エミュレータ | image | connections | items | smoke | tables | 合計 |
| --- | --- | --- | --- | --- | --- | --- |
| LocalStack | localstack/localstack:3 | 8 | 11 | 3 | 9 | **31/31** |
| floci | floci/floci:latest | 8 | 11 | 3 | 9 | **31/31** |
| ministack | ministackorg/ministack | 8 | 11 | 3 | 9 | **31/31** |

`smoke.e2e.ts`(P2-3 の 3 本)も含めスイート全体を各エミュレータで実行。合計 4 spec ファイル × 3 種 = 全 green。

## スキップ / 制約

- **なし**。計画では「ministack の GSI 非対応の可能性」を想定していたが、検証した
  `ministackorg/ministack` は GSI(作成・クエリ・詳細表示)を完全にサポートし、R5/R8/R15 の
  GSI 系テストも green だった。将来 GSI 非対応のエミュレータに備え、環境変数 `E2E_NO_GSI=1` で
  GSI 系アサートをスキップできる安全弁を実装済み(既定は有効=スキップしない)。SPEC-COVERAGE.md 脚注に明記。

## ポート戦略(重要な運用判断)

ホストでユーザーの LocalStack が 4566、dynamodb-local が 8000 を占有していたため、**ユーザー資産を
一切停止せず**に検証するため、自前のエミュレータは**ホストポート 4567**(コンテナ内は 4566)で起動した。
4567 は Rust の自動検出候補ポート `SCAN_PORTS=[4566,8000,4567]` に含まれるため、R2(スキャン→追加)も
成立する。`scripts/emulator.sh` に `EMU_PORT`(既定 4566、後方互換)を追加し、`docker run -p ${EMU_PORT}:4566`
とした。CI(P2-5)は既定の 4566 をそのまま使える。

検証コマンド:
```
for EMU in localstack floci ministack; do
  EMU_PORT=4567 scripts/emulator.sh start $EMU && EMU_PORT=4567 scripts/emulator.sh wait $EMU
  E2E_ENDPOINT=http://localhost:4567 npm run e2e
  EMU_PORT=4567 scripts/emulator.sh stop $EMU
done
```

## E2E 実行中に発見・修正した問題(app / infra)

いずれもセレクタ/タイミング/テスト基盤の軽微な修正。アプリの挙動バグ(BLOCKED 級)はなし。

1. **セッション間でアプリがリーク(最重要)**: WebdriverIO は spec ファイルごとに新セッション=新アプリ起動
   だが、前セッションの debug アプリが終了しきらず `TAURI_WEBDRIVER_PORT`(4445)を保持し続け、
   次セッションが**前セッションの古い画面に接続**していた(3 本目 smoke が 2 本目 items の explore 画面を
   掴んで全 fail)。→ wdio.conf の **`afterSession` で残存 app プロセスを kill**(mac/linux は
   `pkill -f <binary>`、win は `taskkill`)。`beforeSession` では kill しない(tauri-service が
   beforeSession でアプリを起動するため、そこで kill すると起動と競合してセッション作成失敗)。
2. **ExplorePage の状態リーク**: SPA でコンポーネントが再マウントされないため、mode/filter/index が
   テスト間で持ち越され、後続テストが誤ったフィルタで 0 件になっていた。→ 各 run 前に index リセット +
   `リセット`ボタン押下で明示クリア。
3. **React 制御 `<select>` に selectByAttribute が効かない**(embedded webkit driver)。→
   ネイティブ setter + bubbling `change` イベント発火の helper(`setSelectValue`)に統一。
4. **行数カウントの stale**: `$$().length` が不安定 → `browser.execute` で DOM ノードを直接カウント。
5. **window.confirm / prompt**: 削除確認は webview のダイアログで自動化不可のため、`browser.execute` で
   `window.confirm=()=>true` / `window.prompt=()=>name` をスタブ(SPA なので 1 回で当該セッション有効)。
6. **クロス spec 汚染**: `beforeSession` で `connections.json` を毎回削除。加えて R14(0 プロファイル)は
   `clearAllConnections()` で UI から全削除して決定的に。

### 追加した data-testid(挙動・文言は不変、最小限)

- ConnectionsPage: `scan-connections` / `detect-add` / `edit-connection` / `delete-connection` / `conn-region` / `conn-color`
- Layout: `header-conn-select` / `header-region-select` / `header-conn-color` / `nav-connections`
- SideNav: `nav-tables` / `nav-explore`
- CreateTableModal: `ct-name` / `ct-pk-name` / `ct-pk-type` / `ct-sk-name` / `ct-sk-type` / `ct-add-gsi` / `ct-gsi-name-N` / `ct-gsi-pk-name-N` / `ct-gsi-pk-type-N` / `ct-submit`
- TablesPage: `tables-create` / `tables-delete` / `table-link-<name>`
- TableDetailPage: `td-tab-overview` / `td-tab-indexes` / `td-delete` / `td-explore` / `td-delete-input` / `td-delete-confirm` / `td-pk` / `td-sk` / `td-capacity` / `td-status` / `td-item-count` / `td-indexes` / `index-name-<name>`
- ExplorePage: `explore-table-select` / `explore-index-select` / `explore-mode-query` / `explore-mode-scan` / `explore-pk-value` / `explore-sk-op` / `explore-sk-value` / `explore-filter-attr` / `explore-filter-op` / `explore-filter-value` / `explore-run` / `explore-reset` / `explore-count` / `explore-actions` / `explore-delete` / `explore-create-item` / `explore-row` / `explore-row-checkbox` / `explore-pk-link` / `explore-prev` / `explore-next` / `explore-page`
- ItemEditorModal: `item-json` / `item-ddb-toggle` / `item-save` / `item-cancel`
- ErrorBanner: `error-banner` / `error-retry`

## flakiness メモ

- セッション間のアプリ終了レースが唯一の不安定要因だったが `afterSession` kill で解消。修正後は
  3 エミュレータ連続実行を含め安定して全 green(各 spec 単体・フル通し双方で再現確認)。
- Node v26.5.0 + undici の `Content-Length` 問題は P2-3 の `transformRequest` で回避済み(継続有効)。
- `pkill`/`taskkill` は debug バイナリの絶対パス指定で他プロセスに影響しない。

## 全チェック結果(green)

- `npx tsc --noEmit`(root): OK
- `npm run e2e:typecheck`: OK
- `npx vitest run`: 20 passed(P2-3 の 18 + Layout の R17 テスト 2)
- E2E: LocalStack / floci / ministack いずれも 31/31 passing

## 申し送り(P2-5 CI 向け)

- CI(ubuntu)は既定ポート 4566 で `scripts/emulator.sh start <emu>` を使えばよい(EMU_PORT 不要)。
- `afterSession` の `pkill -f`(mac/linux)/ `taskkill /IM app.exe`(win)は CI でも有効。Linux は
  `xvfb-run` 下で同様に動く想定。
- 失敗時アーティファクトは `e2e/screenshots/` と `e2e/logs/`(`.gitignore` 済み、CI で upload-artifact)。
