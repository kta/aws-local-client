# Task 3: S3 拡充(R43〜R46)実装レポート

## STATUS: DONE

## 概要

BucketBrowser を「オブジェクト / プロパティ」タブ構成に再編し、以下を実装した。

- **R43 タブ化 + プロパティ**: `tab-objects` / `tab-props`。プロパティタブでバージョニング
  トグル(`props-versioning-toggle` / `props-versioning-status`)、タグ編集
  (`props-tags-table` / `props-tag-key` / `props-tag-value` / `props-tag-add` /
  `props-tag-save` / `props-tag-remove-<key>`)、CORS(`props-cors-editor` /
  `props-cors-save`)、ポリシー(`props-policy-editor` / `props-policy-save`)。
  未設定 Get(NoSuchTagSet / NoSuchCORSConfiguration / NoSuchBucketPolicy)は
  null/空で返しエラーにしない。
- **R44 バージョン表示**: `versions-toggle` ON で `versions-table`(行 `version-row-<versionId>`、
  DL `version-download-<versionId>`)。versionId 指定 GET でダウンロード可。
  **バージョン指定削除は非提供**(ministack が versionId を無視し delete marker を積むバグ)。
- **R45 コピー & フォルダ作成**: 単一選択オブジェクトを別キーへ CopyObject
  (`object-copy` / `copy-dest-input` / `copy-save`)。`<prefix>/` の 0 バイト put で
  フォルダ作成(`folder-create` / `folder-name-input` / `folder-save`)。
- **R46 マルチパート対応パス方式アップロード**: 旧 `<input type="file">` + base64 経路と
  `object-upload-input` を廃止。`@tauri-apps/plugin-dialog` の `open({ multiple: false })`
  でパス取得、`window.__E2E_UPLOAD_PATH` シームで dialog をバイパス。Rust 側で
  `tokio::fs` からパス読み込み、8MB 以下は put_object、超は multipart(8MB チャンク、
  失敗時 abort)。Content-Type は拡張子から小さな match で推定。100MB 上限撤廃。
  `object-upload` ボタン testid は維持。

## 変更ファイル

- `src-tauri/src/commands/s3.rs`: 10 コマンド追加(`s3_get_bucket_properties` /
  `s3_set_versioning` / `s3_put_bucket_tagging` / `s3_put_bucket_cors` /
  `s3_put_bucket_policy` / `s3_list_object_versions` / `s3_download_object_version` /
  `s3_copy_object` / `s3_create_folder` / `s3_upload_file`)。`s3_put_object` は互換のため残置。
  純粋関数 `use_multipart` / `split_ranges` / `guess_content_type` / CORS JSON 変換を切り出し。
- `src-tauri/src/lib.rs`: invoke_handler に 10 コマンド登録。
- `src-tauri/Cargo.toml`: tokio に `fs` feature 追加。
- `src/api/s3.ts`: `BucketProperties` / `BucketTag` / `ObjectVersion` 型 + 10 ラッパー(camelCase 両側同時)。
- `src/features/s3/BucketBrowserPage.tsx`: タブ化 + コピー/フォルダモーダル + パス方式アップロード。
- `src/features/s3/PropertiesTab.tsx`(新規): バージョニング/タグ/CORS/ポリシー。
- `src/features/s3/VersionsView.tsx`(新規): バージョン一覧 + versionId 指定 DL。
- `src/features/s3/BucketBrowserPage.test.tsx`: 新機能ぶんのユニット拡張(旧 base64/100MB テストは撤去)。
- `src-tauri/tests/integration_s3.rs`: versioning 往復 / 2 版 list / versionId GET / tagging /
  CORS / policy / copy / folder / 9MB multipart の 4 テスト追加。
- `e2e/specs/s3.e2e.ts`: R31 を R31/R46 パスシームへ移行、R43/R44/R45 追加。
- `e2e/SPEC-COVERAGE.md`: R31 記述更新 + R43〜R46 行追加、ヘッダ範囲を R1〜R50 に更新。

## テスト結果

- `npx tsc --noEmit`: OK
- `npm run e2e:typecheck`: OK
- `npx vitest run`: 141 passed (23 files)
- `cargo fmt --check`: OK / `cargo clippy -- -D warnings`: OK / `cargo test`: 47 passed
- `EMU_ENDPOINT=http://localhost:4574 cargo test --test integration_s3 -- --ignored`: 5 passed(2 回連続 green で冪等性確認)

## 懸念 / 注意

- **E2E は未実行**(app バイナリのビルドを要し、完了条件外)。R43/R44/R45 spec と R31/R46 移行は
  既存パターンに準拠して記述済み・型チェック済みだが、統合担当が
  `npm run e2e:build && scripts/emulator.sh ... && E2E_ENDPOINT=... npm run e2e` で実行確認が必要。
- **ministack version-scoped delete バグ**により、versioning テストのバケットは完全クリーンアップ
  不可。テストは run 毎ユニークキー(nanos)でスコープし count アサーションを決定的にした。
  バケット自体は残存しうるが無害(`x3-` プレフィックス)。
- `SPEC-COVERAGE.md` は他タスク(R36〜R42, R47〜R50)と同一ファイルを編集するためマージ競合が
  想定される。S3 行(R31, R43〜R46)とヘッダ文言のみ変更した。
- `s3_put_object`(base64)は Rust コマンド・`api.s3.putObject` ともに互換のため残置(UI 未使用)。
