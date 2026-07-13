# neo-localstack-desktop Phase 1 (DynamoDB クライアント) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** LocalStack/floci/ministack 等のローカル AWS エミュレータに接続できる、AWS コンソール風の Tauri デスクトップアプリを DynamoDB クライアントとして一気通貫で動くところまで作る。

**Architecture:** Tauri 2 デスクトップアプリ。AWS API 呼び出しはすべて Rust 側(`aws-sdk-dynamodb`)の Tauri コマンドで行い、React フロントは `invoke()` するだけ。データはワイヤ上では常に DynamoDB JSON(`{"S": "..."}` 形式)で受け渡しし(ロスレス)、表示・編集用の「通常 JSON」変換はフロント側の純関数で行う。接続プロファイルはアプリ設定ディレクトリの JSON ファイルに永続化する(スペック記載の tauri-plugin-store はテスト容易性のため素の JSON ファイル永続化に変更 — 機能は同等)。

**Tech Stack:** Tauri 2 / Rust (aws-sdk-dynamodb 1.x) / React 18 + TypeScript + Vite / Tailwind CSS 4 / React Router 7 / Vitest + Testing Library

**Spec:** `docs/superpowers/specs/2026-07-13-neo-localstack-desktop-dynamodb-design.md`

## Global Constraints

- 応答・UI 文言は日本語ベースでよいが、コード内識別子・コメント・コミットメッセージは英語 + Conventional Commits(`feat:` / `fix:` / `chore:` / `test:` / `docs:`)
- Rust: `cargo fmt --check`・`cargo clippy -- -D warnings`・`cargo test` が green であること
- TS: `npx tsc --noEmit`・`npx vitest run` が green であること
- DynamoDB 統合テストは `#[ignore]` 付き。実行には `docker run -d -p 8000:8000 amazon/dynamodb-local` が必要で、`cargo test -- --ignored` で回す
- 接続プロファイルの「種類」フィールドは持たない(エンドポイント URL だけで任意のエミュレータに対応)
- キー・値のワイヤ形式は常に DynamoDB JSON(AttributeValue のシリアライズ形)
- ポートスキャン対象は `[4566, 8000, 4567]`(定数 `SCAN_PORTS`)
- リージョン既定値は `ap-northeast-1`、認証情報既定値は `dummy`/`dummy`
- テーブル作成の課金モードは `PAY_PER_REQUEST` 固定、GSI の Projection は `ALL` 固定(Phase 1)
- **UI は承認済みモック `docs/design/ui-mock.html` を正とする。Task 8〜11 の UI 記述と矛盾する場合は `docs/superpowers/plans/2026-07-13-ui-revision.md` が優先。テーマはライトのみ(Phase 1)**

## File Structure

```
neo-localstack-desktop/
├── package.json / vite.config.ts / tsconfig.json / index.html
├── src/                              # React フロント
│   ├── main.tsx / App.tsx / index.css
│   ├── api/
│   │   ├── types.ts                  # Rust コマンドと対になる型定義
│   │   └── client.ts                 # invoke() ラッパー(全コマンド)
│   ├── lib/
│   │   ├── ddbJson.ts                # DynamoDB JSON ⇔ 通常 JSON 純関数
│   │   └── ddbJson.test.ts
│   ├── state/
│   │   └── connections.tsx           # 接続プロファイル Context(active 切替)
│   ├── components/
│   │   ├── Layout.tsx                # ヘッダー(接続セレクタ)+ Outlet
│   │   └── ErrorBanner.tsx
│   ├── pages/
│   │   ├── Home.tsx                  # サービスグリッド
│   │   └── ConnectionsPage.tsx       # 接続 CRUD + 自動検出
│   └── features/dynamodb/
│       ├── TablesPage.tsx            # テーブル一覧 + 作成/削除
│       ├── TableDetailPage.tsx       # 概要タブ + 項目探索タブ
│       ├── ItemsExplorer.tsx         # Scan/Query + フィルタ + ページネーション
│       ├── ItemEditorModal.tsx       # アイテム作成/編集(JSON 切替)
│       └── CreateTableModal.tsx
└── src-tauri/
    ├── Cargo.toml / tauri.conf.json
    ├── src/
    │   ├── main.rs / lib.rs          # コマンド登録
    │   ├── error.rs                  # AppError + SDK エラー分類
    │   ├── attr.rs                   # AttributeValue ⇔ DynamoDB JSON
    │   ├── connections.rs            # ConnectionProfile / ProfileStore / make_client / probe
    │   └── ddb.rs                    # DynamoDB 操作のコア関数 + Tauri コマンド
    └── tests/
        └── integration_ddb.rs        # dynamodb-local への統合テスト (#[ignore])
```

---

### Task 1: プロジェクト scaffold(Vite + React + TS + Tailwind + Vitest + Tauri 2)

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css`, `.gitignore`
- Create (tauri init が生成): `src-tauri/` 一式

**Interfaces:**
- Produces: `npm run dev` / `npm run tauri dev` が動く土台。`src/App.tsx` は後続タスクで全面置換される前提の仮実装

- [ ] **Step 1: フロント一式を手書きで作成**(create-vite は非空ディレクトリで対話になるため手書きが確実)

`package.json`:
```json
{
  "name": "neo-localstack-desktop",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "tauri": "tauri"
  }
}
```

`vite.config.ts`:
```ts
/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  test: {
    environment: "jsdom",
    globals: true,
  },
});
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "skipLibCheck": true,
    "types": ["vitest/globals"],
    "noEmit": true
  },
  "include": ["src"]
}
```

`index.html`:
```html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>neo-localstack-desktop</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/index.css`:
```css
@import "tailwindcss";
```

`src/main.tsx`:
```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

`src/App.tsx`(仮 — Task 8 で全面置換):
```tsx
export default function App() {
  return <h1 className="p-4 text-xl font-bold">neo-localstack-desktop</h1>;
}
```

`.gitignore`:
```
node_modules
dist
src-tauri/target
```

- [ ] **Step 2: 依存インストール**

```bash
npm install react react-dom @tauri-apps/api
npm install -D typescript vite @vitejs/plugin-react tailwindcss @tailwindcss/vite \
  vitest jsdom @testing-library/react @testing-library/jest-dom @types/react @types/react-dom \
  @tauri-apps/cli
```

- [ ] **Step 3: フロント単体で起動確認**

Run: `npm run build`
Expected: tsc エラーなし、vite build 成功(dist/ 生成)

- [ ] **Step 4: Tauri 初期化(非対話フラグ指定)**

```bash
npx tauri init \
  --app-name neo-localstack-desktop \
  --window-title "neo-localstack-desktop" \
  --frontend-dist ../dist \
  --dev-url http://localhost:5173 \
  --before-dev-command "npm run dev" \
  --before-build-command "npm run build"
```

- [ ] **Step 5: Tauri dev 起動確認**

Run: `npm run tauri dev`
Expected: ウィンドウが開き "neo-localstack-desktop" の見出しが表示される(確認したら終了)

Run: `cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings`
Expected: エラーなし

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold tauri 2 + react + typescript + tailwind app"
```

---

### Task 2: Rust — AppError と SDK エラー分類

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/error.rs`
- Modify: `src-tauri/src/lib.rs`(`mod error;` 追加)

**Interfaces:**
- Produces:
  - `enum AppError { Connection(String), NotFound(String), Validation(String), Internal(String) }`(`Serialize` 実装、ワイヤ形式は `{"kind": "connection", "message": "..."}`)
  - `fn map_sdk_err<E, R>(err: SdkError<E, R>) -> AppError`

- [ ] **Step 1: Cargo.toml に依存追加**

`src-tauri/Cargo.toml` の `[dependencies]` に追記:
```toml
aws-sdk-dynamodb = "1"
aws-smithy-runtime-api = "1"
base64 = "0.22"
uuid = { version = "1", features = ["v4"] }
tokio = { version = "1", features = ["rt-multi-thread", "macros"] }
```
`[dev-dependencies]` を追加:
```toml
tempfile = "3"
```

- [ ] **Step 2: 失敗するテストを書く**

`src-tauri/src/error.rs`(テスト部分から先に):
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_error_serializes_with_kind_and_message() {
        let e = AppError::Connection("refused".into());
        let json = serde_json::to_value(&e).unwrap();
        assert_eq!(json["kind"], "connection");
        assert_eq!(json["message"], "refused");
    }
}
```

Run: `cd src-tauri && cargo test app_error`
Expected: FAIL(`AppError` 未定義でコンパイルエラー)

- [ ] **Step 3: 実装**

`src-tauri/src/error.rs` の本体:
```rust
use aws_smithy_runtime_api::client::result::SdkError;
use aws_smithy_runtime_api::http::Response;
use serde::Serialize;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", content = "message", rename_all = "snake_case")]
pub enum AppError {
    Connection(String),
    NotFound(String),
    Validation(String),
    Internal(String),
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AppError::Connection(m) => write!(f, "connection error: {m}"),
            AppError::NotFound(m) => write!(f, "not found: {m}"),
            AppError::Validation(m) => write!(f, "validation error: {m}"),
            AppError::Internal(m) => write!(f, "internal error: {m}"),
        }
    }
}

impl std::error::Error for AppError {}

pub fn map_sdk_err<E>(err: SdkError<E, Response>) -> AppError
where
    E: aws_sdk_dynamodb::error::ProvideErrorMetadata + std::fmt::Debug,
{
    match &err {
        SdkError::DispatchFailure(_) | SdkError::TimeoutError(_) => {
            AppError::Connection(format!("{err:?}"))
        }
        SdkError::ServiceError(se) => {
            let code = se.err().code().unwrap_or("");
            let msg = se
                .err()
                .message()
                .map(String::from)
                .unwrap_or_else(|| format!("{:?}", se.err()));
            match code {
                "ResourceNotFoundException" => AppError::NotFound(msg),
                "ValidationException"
                | "ConditionalCheckFailedException"
                | "ResourceInUseException" => AppError::Validation(msg),
                _ => AppError::Internal(format!("{code}: {msg}")),
            }
        }
        _ => AppError::Internal(format!("{err:?}")),
    }
}
```

`src-tauri/src/lib.rs` の先頭に `pub mod error;` を追加。

- [ ] **Step 4: テストが通ることを確認**

Run: `cd src-tauri && cargo test app_error && cargo clippy -- -D warnings`
Expected: PASS、clippy 警告なし

- [ ] **Step 5: Commit**

```bash
git add src-tauri
git commit -m "feat: add AppError with sdk error classification"
```

---

### Task 3: Rust — AttributeValue ⇔ DynamoDB JSON 変換

**Files:**
- Create: `src-tauri/src/attr.rs`
- Modify: `src-tauri/src/lib.rs`(`pub mod attr;` 追加)

**Interfaces:**
- Consumes: `AppError`(Task 2)
- Produces:
  - `fn attr_to_json(av: &AttributeValue) -> serde_json::Value`
  - `fn json_to_attr(v: &serde_json::Value) -> Result<AttributeValue, AppError>`
  - `fn item_to_json(item: &HashMap<String, AttributeValue>) -> serde_json::Value`
  - `fn json_to_item(v: &serde_json::Value) -> Result<HashMap<String, AttributeValue>, AppError>`

- [ ] **Step 1: 失敗するテストを書く**

`src-tauri/src/attr.rs`(テストから):
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use aws_sdk_dynamodb::types::AttributeValue;
    use serde_json::json;

    #[test]
    fn scalar_roundtrip() {
        for j in [
            json!({"S": "hello"}),
            json!({"N": "42.5"}),
            json!({"BOOL": true}),
            json!({"NULL": true}),
        ] {
            let av = json_to_attr(&j).unwrap();
            assert_eq!(attr_to_json(&av), j);
        }
    }

    #[test]
    fn nested_roundtrip() {
        let j = json!({"M": {"tags": {"L": [{"S": "a"}, {"N": "1"}]}, "ok": {"BOOL": false}}});
        let av = json_to_attr(&j).unwrap();
        assert_eq!(attr_to_json(&av), j);
    }

    #[test]
    fn sets_roundtrip() {
        let j = json!({"SS": ["a", "b"]});
        assert_eq!(attr_to_json(&json_to_attr(&j).unwrap()), j);
        let j = json!({"NS": ["1", "2"]});
        assert_eq!(attr_to_json(&json_to_attr(&j).unwrap()), j);
    }

    #[test]
    fn binary_roundtrip_base64() {
        let j = json!({"B": "aGVsbG8="}); // "hello"
        assert_eq!(attr_to_json(&json_to_attr(&j).unwrap()), j);
    }

    #[test]
    fn item_roundtrip() {
        let j = json!({"pk": {"S": "user#1"}, "age": {"N": "30"}});
        let item = json_to_item(&j).unwrap();
        assert_eq!(item_to_json(&item), j);
    }

    #[test]
    fn invalid_shape_is_validation_error() {
        assert!(matches!(
            json_to_attr(&json!({"S": 1})),
            Err(crate::error::AppError::Validation(_))
        ));
        assert!(matches!(
            json_to_attr(&json!("bare string")),
            Err(crate::error::AppError::Validation(_))
        ));
    }
}
```

Run: `cd src-tauri && cargo test attr::`
Expected: FAIL(関数未定義)

- [ ] **Step 2: 実装**

`src-tauri/src/attr.rs` の本体:
```rust
use std::collections::HashMap;

use aws_sdk_dynamodb::primitives::Blob;
use aws_sdk_dynamodb::types::AttributeValue;
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde_json::{json, Map, Value};

use crate::error::AppError;

pub fn attr_to_json(av: &AttributeValue) -> Value {
    match av {
        AttributeValue::S(s) => json!({"S": s}),
        AttributeValue::N(n) => json!({"N": n}),
        AttributeValue::Bool(b) => json!({"BOOL": b}),
        AttributeValue::Null(_) => json!({"NULL": true}),
        AttributeValue::B(b) => json!({"B": B64.encode(b.as_ref())}),
        AttributeValue::Ss(v) => json!({"SS": v}),
        AttributeValue::Ns(v) => json!({"NS": v}),
        AttributeValue::Bs(v) => {
            json!({"BS": v.iter().map(|b| B64.encode(b.as_ref())).collect::<Vec<_>>()})
        }
        AttributeValue::L(l) => json!({"L": l.iter().map(attr_to_json).collect::<Vec<_>>()}),
        AttributeValue::M(m) => {
            let obj: Map<String, Value> =
                m.iter().map(|(k, v)| (k.clone(), attr_to_json(v))).collect();
            json!({"M": obj})
        }
        other => json!({"NULL": true, "_unsupported": format!("{other:?}")}),
    }
}

pub fn json_to_attr(v: &Value) -> Result<AttributeValue, AppError> {
    let obj = v.as_object().ok_or_else(|| bad(v))?;
    if obj.len() != 1 {
        return Err(bad(v));
    }
    let (tag, inner) = obj.iter().next().unwrap();
    match (tag.as_str(), inner) {
        ("S", Value::String(s)) => Ok(AttributeValue::S(s.clone())),
        ("N", Value::String(n)) => Ok(AttributeValue::N(n.clone())),
        ("BOOL", Value::Bool(b)) => Ok(AttributeValue::Bool(*b)),
        ("NULL", _) => Ok(AttributeValue::Null(true)),
        ("B", Value::String(b64)) => Ok(AttributeValue::B(Blob::new(
            B64.decode(b64).map_err(|e| AppError::Validation(e.to_string()))?,
        ))),
        ("SS", Value::Array(a)) => Ok(AttributeValue::Ss(str_vec(a, v)?)),
        ("NS", Value::Array(a)) => Ok(AttributeValue::Ns(str_vec(a, v)?)),
        ("BS", Value::Array(a)) => {
            let blobs = str_vec(a, v)?
                .iter()
                .map(|s| {
                    B64.decode(s)
                        .map(Blob::new)
                        .map_err(|e| AppError::Validation(e.to_string()))
                })
                .collect::<Result<Vec<_>, _>>()?;
            Ok(AttributeValue::Bs(blobs))
        }
        ("L", Value::Array(a)) => Ok(AttributeValue::L(
            a.iter().map(json_to_attr).collect::<Result<Vec<_>, _>>()?,
        )),
        ("M", Value::Object(m)) => {
            let mut out = HashMap::new();
            for (k, mv) in m {
                out.insert(k.clone(), json_to_attr(mv)?);
            }
            Ok(AttributeValue::M(out))
        }
        _ => Err(bad(v)),
    }
}

pub fn item_to_json(item: &HashMap<String, AttributeValue>) -> Value {
    let obj: Map<String, Value> =
        item.iter().map(|(k, v)| (k.clone(), attr_to_json(v))).collect();
    Value::Object(obj)
}

pub fn json_to_item(v: &Value) -> Result<HashMap<String, AttributeValue>, AppError> {
    let obj = v
        .as_object()
        .ok_or_else(|| AppError::Validation("item must be a JSON object".into()))?;
    let mut out = HashMap::new();
    for (k, av) in obj {
        out.insert(k.clone(), json_to_attr(av)?);
    }
    Ok(out)
}

fn str_vec(a: &[Value], orig: &Value) -> Result<Vec<String>, AppError> {
    a.iter()
        .map(|x| x.as_str().map(String::from).ok_or_else(|| bad(orig)))
        .collect()
}

fn bad(v: &Value) -> AppError {
    AppError::Validation(format!("invalid DynamoDB JSON: {v}"))
}
```

`src-tauri/src/lib.rs` に `pub mod attr;` を追加。

- [ ] **Step 3: テストが通ることを確認**

Run: `cd src-tauri && cargo test attr:: && cargo clippy -- -D warnings`
Expected: 6 テスト PASS

- [ ] **Step 4: Commit**

```bash
git add src-tauri
git commit -m "feat: add AttributeValue <-> DynamoDB JSON conversion"
```

---

### Task 4: Rust — ConnectionProfile / ProfileStore / make_client / probe

**Files:**
- Create: `src-tauri/src/connections.rs`
- Modify: `src-tauri/src/lib.rs`(`pub mod connections;` 追加)

**Interfaces:**
- Consumes: `AppError`(Task 2)
- Produces:
  - `struct ConnectionProfile { id, name, endpoint_url, region, access_key_id, secret_access_key, color: Option<String> }`(serde camelCase)
  - `struct ProfileStore::new(path: PathBuf)`, `.load()`, `.upsert(profile)`, `.remove(id)` — いずれも `Result<Vec<ConnectionProfile>, AppError>`
  - `fn make_client(p: &ConnectionProfile) -> aws_sdk_dynamodb::Client`
  - `async fn probe(endpoint_url: &str) -> Option<usize>`(応答があればテーブル数)
  - `const SCAN_PORTS: [u16; 3] = [4566, 8000, 4567]`
  - Tauri コマンド: `list_connections` / `save_connection` / `delete_connection` / `detect_connections`

- [ ] **Step 1: 失敗するテストを書く**

`src-tauri/src/connections.rs`(テストから):
```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn profile(id: &str, name: &str) -> ConnectionProfile {
        ConnectionProfile {
            id: id.into(),
            name: name.into(),
            endpoint_url: "http://localhost:4566".into(),
            region: "ap-northeast-1".into(),
            access_key_id: "dummy".into(),
            secret_access_key: "dummy".into(),
            color: None,
        }
    }

    #[test]
    fn load_returns_empty_when_file_missing() {
        let dir = tempfile::tempdir().unwrap();
        let store = ProfileStore::new(dir.path().join("connections.json"));
        assert_eq!(store.load().unwrap(), vec![]);
    }

    #[test]
    fn upsert_then_load_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let store = ProfileStore::new(dir.path().join("connections.json"));
        store.upsert(profile("1", "a")).unwrap();
        let after = store.upsert(profile("2", "b")).unwrap();
        assert_eq!(after.len(), 2);
        assert_eq!(store.load().unwrap(), after);
    }

    #[test]
    fn upsert_replaces_same_id() {
        let dir = tempfile::tempdir().unwrap();
        let store = ProfileStore::new(dir.path().join("connections.json"));
        store.upsert(profile("1", "before")).unwrap();
        let after = store.upsert(profile("1", "after")).unwrap();
        assert_eq!(after.len(), 1);
        assert_eq!(after[0].name, "after");
    }

    #[test]
    fn remove_deletes_by_id() {
        let dir = tempfile::tempdir().unwrap();
        let store = ProfileStore::new(dir.path().join("connections.json"));
        store.upsert(profile("1", "a")).unwrap();
        let after = store.remove("1").unwrap();
        assert!(after.is_empty());
    }

    #[test]
    fn serde_uses_camel_case() {
        let json = serde_json::to_value(profile("1", "a")).unwrap();
        assert!(json.get("endpointUrl").is_some());
        assert!(json.get("accessKeyId").is_some());
    }
}
```

Run: `cd src-tauri && cargo test connections::`
Expected: FAIL(型未定義)

- [ ] **Step 2: 実装**

`src-tauri/src/connections.rs` の本体:
```rust
use std::path::PathBuf;
use std::time::Duration;

use aws_sdk_dynamodb::config::{BehaviorVersion, Credentials, Region};
use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::error::AppError;

pub const SCAN_PORTS: [u16; 3] = [4566, 8000, 4567];

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionProfile {
    pub id: String,
    pub name: String,
    pub endpoint_url: String,
    pub region: String,
    pub access_key_id: String,
    pub secret_access_key: String,
    #[serde(default)]
    pub color: Option<String>,
}

pub struct ProfileStore {
    path: PathBuf,
}

impl ProfileStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn load(&self) -> Result<Vec<ConnectionProfile>, AppError> {
        if !self.path.exists() {
            return Ok(vec![]);
        }
        let raw = std::fs::read_to_string(&self.path)
            .map_err(|e| AppError::Internal(e.to_string()))?;
        serde_json::from_str(&raw).map_err(|e| AppError::Internal(e.to_string()))
    }

    pub fn upsert(&self, profile: ConnectionProfile) -> Result<Vec<ConnectionProfile>, AppError> {
        let mut all = self.load()?;
        match all.iter_mut().find(|p| p.id == profile.id) {
            Some(slot) => *slot = profile,
            None => all.push(profile),
        }
        self.save(&all)?;
        Ok(all)
    }

    pub fn remove(&self, id: &str) -> Result<Vec<ConnectionProfile>, AppError> {
        let mut all = self.load()?;
        all.retain(|p| p.id != id);
        self.save(&all)?;
        Ok(all)
    }

    fn save(&self, all: &[ConnectionProfile]) -> Result<(), AppError> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| AppError::Internal(e.to_string()))?;
        }
        let raw = serde_json::to_string_pretty(all)
            .map_err(|e| AppError::Internal(e.to_string()))?;
        std::fs::write(&self.path, raw).map_err(|e| AppError::Internal(e.to_string()))
    }
}

pub fn make_client(p: &ConnectionProfile) -> aws_sdk_dynamodb::Client {
    let creds = Credentials::new(
        p.access_key_id.clone(),
        p.secret_access_key.clone(),
        None,
        None,
        "profile",
    );
    let timeouts = aws_sdk_dynamodb::config::timeout::TimeoutConfig::builder()
        .connect_timeout(Duration::from_millis(1500))
        .operation_timeout(Duration::from_secs(30))
        .build();
    let config = aws_sdk_dynamodb::Config::builder()
        .behavior_version(BehaviorVersion::latest())
        .endpoint_url(&p.endpoint_url)
        .region(Region::new(p.region.clone()))
        .credentials_provider(creds)
        .timeout_config(timeouts)
        .build();
    aws_sdk_dynamodb::Client::from_conf(config)
}

pub async fn probe(endpoint_url: &str) -> Option<usize> {
    let p = ConnectionProfile {
        id: "probe".into(),
        name: "probe".into(),
        endpoint_url: endpoint_url.into(),
        region: "ap-northeast-1".into(),
        access_key_id: "dummy".into(),
        secret_access_key: "dummy".into(),
        color: None,
    };
    let creds = Credentials::new("dummy", "dummy", None, None, "probe");
    let timeouts = aws_sdk_dynamodb::config::timeout::TimeoutConfig::builder()
        .connect_timeout(Duration::from_millis(700))
        .operation_timeout(Duration::from_millis(1500))
        .build();
    let config = aws_sdk_dynamodb::Config::builder()
        .behavior_version(BehaviorVersion::latest())
        .endpoint_url(&p.endpoint_url)
        .region(Region::new(p.region))
        .credentials_provider(creds)
        .timeout_config(timeouts)
        .build();
    let client = aws_sdk_dynamodb::Client::from_conf(config);
    let out = client.list_tables().send().await.ok()?;
    Some(out.table_names().len())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedEndpoint {
    pub endpoint_url: String,
    pub table_count: usize,
}

fn store_for(app: &tauri::AppHandle) -> Result<ProfileStore, AppError> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(ProfileStore::new(dir.join("connections.json")))
}

#[tauri::command]
pub fn list_connections(app: tauri::AppHandle) -> Result<Vec<ConnectionProfile>, AppError> {
    store_for(&app)?.load()
}

#[tauri::command]
pub fn save_connection(
    app: tauri::AppHandle,
    profile: ConnectionProfile,
) -> Result<Vec<ConnectionProfile>, AppError> {
    store_for(&app)?.upsert(profile)
}

#[tauri::command]
pub fn delete_connection(
    app: tauri::AppHandle,
    id: String,
) -> Result<Vec<ConnectionProfile>, AppError> {
    store_for(&app)?.remove(&id)
}

#[tauri::command]
pub async fn detect_connections() -> Result<Vec<DetectedEndpoint>, AppError> {
    let mut found = vec![];
    for port in SCAN_PORTS {
        let url = format!("http://localhost:{port}");
        if let Some(table_count) = probe(&url).await {
            found.push(DetectedEndpoint { endpoint_url: url, table_count });
        }
    }
    Ok(found)
}
```

`src-tauri/src/lib.rs` に `pub mod connections;` を追加し、`invoke_handler` を以下に更新:
```rust
.invoke_handler(tauri::generate_handler![
    connections::list_connections,
    connections::save_connection,
    connections::delete_connection,
    connections::detect_connections,
])
```
(テンプレート生成の `greet` コマンドが lib.rs にあれば削除する)

- [ ] **Step 3: テストが通ることを確認**

Run: `cd src-tauri && cargo test connections:: && cargo clippy -- -D warnings`
Expected: 5 テスト PASS

- [ ] **Step 4: Commit**

```bash
git add src-tauri
git commit -m "feat: add connection profiles with json store, client factory and port detection"
```

---

### Task 5: Rust — DynamoDB コア操作 + Tauri コマンド + 統合テスト

**Files:**
- Create: `src-tauri/src/ddb.rs`
- Create: `src-tauri/tests/integration_ddb.rs`
- Modify: `src-tauri/src/lib.rs`(`pub mod ddb;` + コマンド登録追加)

**Interfaces:**
- Consumes: `make_client`, `ConnectionProfile`(Task 4)、`attr::*`(Task 3)、`map_sdk_err`(Task 2)
- Produces(コア関数はすべて `&Client` を取る。Tauri コマンドは `profile: ConnectionProfile` を受けてラップ):
  - `async fn list_tables(&Client) -> Result<Vec<String>>`
  - `async fn describe_table(&Client, name: &str) -> Result<TableDetail>`
  - `async fn scan(&Client, &ScanRequest) -> Result<PageResult>`
  - `async fn query(&Client, &QueryRequest) -> Result<PageResult>`
  - `async fn put_item(&Client, table: &str, item: &Value) -> Result<()>`
  - `async fn delete_item(&Client, table: &str, key: &Value) -> Result<()>`
  - `async fn create_table(&Client, &CreateTableRequest) -> Result<()>`
  - `async fn delete_table(&Client, name: &str) -> Result<()>`
  - Tauri コマンド名: `ddb_list_tables` / `ddb_describe_table` / `ddb_scan` / `ddb_query` / `ddb_put_item` / `ddb_delete_item` / `ddb_create_table` / `ddb_delete_table`

型(serde camelCase、フロント `src/api/types.ts` と一致させる):
```rust
KeyDef { name: String, key_type: String /* "HASH"|"RANGE" */, attr_type: String /* "S"|"N"|"B" */ }
IndexDetail { name: String, keys: Vec<KeyDef> }
TableDetail { name, status: String, item_count: i64, size_bytes: i64, keys: Vec<KeyDef>, gsis: Vec<IndexDetail>, lsis: Vec<IndexDetail> }
Filter { attr: String, op: String /* "eq"|"contains" */, value: Value /* DynamoDB JSON */ }
ScanRequest { table_name, limit: i32, start_key: Option<Value>, filter: Option<Filter> }
SkCondition { name: String, op: String /* "eq"|"begins_with" */, value: Value }
QueryRequest { table_name, index_name: Option<String>, pk_name: String, pk_value: Value, sk: Option<SkCondition>, limit: i32, start_key: Option<Value> }
PageResult { items: Vec<Value>, last_key: Option<Value>, count: i32, scanned_count: i32 }
KeyAttr { name: String, attr_type: String }
GsiSpec { name: String, pk: KeyAttr, sk: Option<KeyAttr> }
CreateTableRequest { table_name, pk: KeyAttr, sk: Option<KeyAttr>, gsis: Vec<GsiSpec> }
```

- [ ] **Step 1: 統合テストを書く(失敗確認は dynamodb-local 起動が前提)**

`src-tauri/tests/integration_ddb.rs`:
```rust
//! Requires: docker run -d -p 8000:8000 amazon/dynamodb-local
//! Run with: cargo test -- --ignored

use neo_localstack_desktop_lib::connections::{make_client, ConnectionProfile};
use neo_localstack_desktop_lib::ddb::*;
use serde_json::json;

fn local_profile() -> ConnectionProfile {
    ConnectionProfile {
        id: "test".into(),
        name: "test".into(),
        endpoint_url: "http://localhost:8000".into(),
        region: "ap-northeast-1".into(),
        access_key_id: "dummy".into(),
        secret_access_key: "dummy".into(),
        color: None,
    }
}

#[tokio::test]
#[ignore]
async fn full_lifecycle_create_put_query_scan_delete() {
    let client = make_client(&local_profile());
    let table = "it_users";

    // cleanup from previous runs
    let _ = delete_table(&client, table).await;

    create_table(
        &client,
        &CreateTableRequest {
            table_name: table.into(),
            pk: KeyAttr { name: "pk".into(), attr_type: "S".into() },
            sk: Some(KeyAttr { name: "sk".into(), attr_type: "S".into() }),
            gsis: vec![GsiSpec {
                name: "by_email".into(),
                pk: KeyAttr { name: "email".into(), attr_type: "S".into() },
                sk: None,
            }],
        },
    )
    .await
    .unwrap();

    assert!(list_tables(&client).await.unwrap().contains(&table.to_string()));

    let detail = describe_table(&client, table).await.unwrap();
    assert_eq!(detail.keys.len(), 2);
    assert_eq!(detail.gsis.len(), 1);

    for i in 0..3 {
        put_item(
            &client,
            table,
            &json!({
                "pk": {"S": "user#1"},
                "sk": {"S": format!("order#{i}")},
                "email": {"S": "a@example.com"},
                "amount": {"N": i.to_string()},
            }),
        )
        .await
        .unwrap();
    }

    // scan with filter
    let page = scan(
        &client,
        &ScanRequest {
            table_name: table.into(),
            limit: 10,
            start_key: None,
            filter: Some(Filter {
                attr: "amount".into(),
                op: "eq".into(),
                value: json!({"N": "1"}),
            }),
        },
    )
    .await
    .unwrap();
    assert_eq!(page.count, 1);

    // query pk + begins_with
    let page = query(
        &client,
        &QueryRequest {
            table_name: table.into(),
            index_name: None,
            pk_name: "pk".into(),
            pk_value: json!({"S": "user#1"}),
            sk: Some(SkCondition {
                name: "sk".into(),
                op: "begins_with".into(),
                value: json!({"S": "order#"}),
            }),
            limit: 10,
            start_key: None,
        },
    )
    .await
    .unwrap();
    assert_eq!(page.count, 3);

    // pagination: limit 2 then continue
    let p1 = scan(&client, &ScanRequest { table_name: table.into(), limit: 2, start_key: None, filter: None }).await.unwrap();
    assert!(p1.last_key.is_some());
    let p2 = scan(&client, &ScanRequest { table_name: table.into(), limit: 10, start_key: p1.last_key.clone(), filter: None }).await.unwrap();
    assert_eq!(p1.count + p2.count, 3);

    // delete one item
    delete_item(&client, table, &json!({"pk": {"S": "user#1"}, "sk": {"S": "order#0"}}))
        .await
        .unwrap();
    let page = scan(&client, &ScanRequest { table_name: table.into(), limit: 10, start_key: None, filter: None }).await.unwrap();
    assert_eq!(page.count, 2);

    delete_table(&client, table).await.unwrap();
    assert!(!list_tables(&client).await.unwrap().contains(&table.to_string()));
}

#[tokio::test]
#[ignore]
async fn describe_missing_table_is_not_found() {
    let client = make_client(&local_profile());
    let err = describe_table(&client, "no_such_table").await.unwrap_err();
    assert!(matches!(err, neo_localstack_desktop_lib::error::AppError::NotFound(_)));
}
```

注意: クレート名は `src-tauri/Cargo.toml` の `[lib] name`(テンプレートでは `neo_localstack_desktop_lib` のような名前)に合わせること。違う場合は `use` を修正。

Run: `docker ps` で dynamodb-local 起動確認後 `cd src-tauri && cargo test -- --ignored`
Expected: FAIL(`ddb` モジュール未定義)

- [ ] **Step 2: 実装**

`src-tauri/src/ddb.rs`:
```rust
use aws_sdk_dynamodb::types::{
    AttributeDefinition, GlobalSecondaryIndex, KeySchemaElement, KeyType, Projection,
    ProjectionType, ScalarAttributeType,
};
use aws_sdk_dynamodb::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::attr::{item_to_json, json_to_attr, json_to_item};
use crate::connections::{make_client, ConnectionProfile};
use crate::error::{map_sdk_err, AppError};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyDef {
    pub name: String,
    pub key_type: String,
    pub attr_type: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexDetail {
    pub name: String,
    pub keys: Vec<KeyDef>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDetail {
    pub name: String,
    pub status: String,
    pub item_count: i64,
    pub size_bytes: i64,
    pub keys: Vec<KeyDef>,
    pub gsis: Vec<IndexDetail>,
    pub lsis: Vec<IndexDetail>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Filter {
    pub attr: String,
    pub op: String,
    pub value: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanRequest {
    pub table_name: String,
    pub limit: i32,
    pub start_key: Option<Value>,
    pub filter: Option<Filter>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkCondition {
    pub name: String,
    pub op: String,
    pub value: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryRequest {
    pub table_name: String,
    pub index_name: Option<String>,
    pub pk_name: String,
    pub pk_value: Value,
    pub sk: Option<SkCondition>,
    pub limit: i32,
    pub start_key: Option<Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageResult {
    pub items: Vec<Value>,
    pub last_key: Option<Value>,
    pub count: i32,
    pub scanned_count: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyAttr {
    pub name: String,
    pub attr_type: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GsiSpec {
    pub name: String,
    pub pk: KeyAttr,
    pub sk: Option<KeyAttr>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTableRequest {
    pub table_name: String,
    pub pk: KeyAttr,
    pub sk: Option<KeyAttr>,
    pub gsis: Vec<GsiSpec>,
}

pub async fn list_tables(client: &Client) -> Result<Vec<String>, AppError> {
    let mut names = vec![];
    let mut start: Option<String> = None;
    loop {
        let out = client
            .list_tables()
            .set_exclusive_start_table_name(start.clone())
            .send()
            .await
            .map_err(map_sdk_err)?;
        names.extend(out.table_names().iter().cloned());
        start = out.last_evaluated_table_name().map(String::from);
        if start.is_none() {
            break;
        }
    }
    Ok(names)
}

pub async fn describe_table(client: &Client, name: &str) -> Result<TableDetail, AppError> {
    let out = client
        .describe_table()
        .table_name(name)
        .send()
        .await
        .map_err(map_sdk_err)?;
    let t = out
        .table()
        .ok_or_else(|| AppError::NotFound(format!("table {name} not found")))?;

    let attr_type = |attr_name: &str| -> String {
        t.attribute_definitions()
            .iter()
            .find(|d| d.attribute_name() == attr_name)
            .map(|d| d.attribute_type().as_str().to_string())
            .unwrap_or_else(|| "S".into())
    };
    let keys_of = |schema: &[KeySchemaElement]| -> Vec<KeyDef> {
        schema
            .iter()
            .map(|k| KeyDef {
                name: k.attribute_name().to_string(),
                key_type: k.key_type().as_str().to_string(),
                attr_type: attr_type(k.attribute_name()),
            })
            .collect()
    };

    Ok(TableDetail {
        name: t.table_name().unwrap_or(name).to_string(),
        status: t.table_status().map(|s| s.as_str().to_string()).unwrap_or_default(),
        item_count: t.item_count().unwrap_or(0),
        size_bytes: t.table_size_bytes().unwrap_or(0),
        keys: keys_of(t.key_schema()),
        gsis: t
            .global_secondary_indexes()
            .iter()
            .map(|g| IndexDetail {
                name: g.index_name().unwrap_or_default().to_string(),
                keys: keys_of(g.key_schema()),
            })
            .collect(),
        lsis: t
            .local_secondary_indexes()
            .iter()
            .map(|l| IndexDetail {
                name: l.index_name().unwrap_or_default().to_string(),
                keys: keys_of(l.key_schema()),
            })
            .collect(),
    })
}

pub async fn scan(client: &Client, req: &ScanRequest) -> Result<PageResult, AppError> {
    let mut op = client.scan().table_name(&req.table_name).limit(req.limit);
    if let Some(f) = &req.filter {
        let av = json_to_attr(&f.value)?;
        let expr = match f.op.as_str() {
            "eq" => "#a = :v",
            "contains" => "contains(#a, :v)",
            other => return Err(AppError::Validation(format!("unknown filter op: {other}"))),
        };
        op = op
            .filter_expression(expr)
            .expression_attribute_names("#a", &f.attr)
            .expression_attribute_values(":v", av);
    }
    if let Some(k) = &req.start_key {
        op = op.set_exclusive_start_key(Some(json_to_item(k)?));
    }
    let out = op.send().await.map_err(map_sdk_err)?;
    Ok(PageResult {
        items: out.items().iter().map(item_to_json).collect(),
        last_key: out.last_evaluated_key().map(item_to_json),
        count: out.count(),
        scanned_count: out.scanned_count(),
    })
}

pub async fn query(client: &Client, req: &QueryRequest) -> Result<PageResult, AppError> {
    let mut expr = "#pk = :pk".to_string();
    let mut op = client
        .query()
        .table_name(&req.table_name)
        .limit(req.limit)
        .expression_attribute_names("#pk", &req.pk_name)
        .expression_attribute_values(":pk", json_to_attr(&req.pk_value)?);
    if let Some(idx) = &req.index_name {
        op = op.index_name(idx);
    }
    if let Some(sk) = &req.sk {
        let cond = match sk.op.as_str() {
            "eq" => "#sk = :sk",
            "begins_with" => "begins_with(#sk, :sk)",
            other => return Err(AppError::Validation(format!("unknown sk op: {other}"))),
        };
        expr = format!("{expr} AND {cond}");
        op = op
            .expression_attribute_names("#sk", &sk.name)
            .expression_attribute_values(":sk", json_to_attr(&sk.value)?);
    }
    if let Some(k) = &req.start_key {
        op = op.set_exclusive_start_key(Some(json_to_item(k)?));
    }
    let out = op
        .key_condition_expression(expr)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(PageResult {
        items: out.items().iter().map(item_to_json).collect(),
        last_key: out.last_evaluated_key().map(item_to_json),
        count: out.count(),
        scanned_count: out.scanned_count(),
    })
}

pub async fn put_item(client: &Client, table: &str, item: &Value) -> Result<(), AppError> {
    client
        .put_item()
        .table_name(table)
        .set_item(Some(json_to_item(item)?))
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn delete_item(client: &Client, table: &str, key: &Value) -> Result<(), AppError> {
    client
        .delete_item()
        .table_name(table)
        .set_key(Some(json_to_item(key)?))
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

fn scalar_type(s: &str) -> Result<ScalarAttributeType, AppError> {
    match s {
        "S" => Ok(ScalarAttributeType::S),
        "N" => Ok(ScalarAttributeType::N),
        "B" => Ok(ScalarAttributeType::B),
        other => Err(AppError::Validation(format!("unknown attr type: {other}"))),
    }
}

pub async fn create_table(client: &Client, req: &CreateTableRequest) -> Result<(), AppError> {
    let mut attr_defs: Vec<AttributeDefinition> = vec![];
    let mut push_attr = |k: &KeyAttr, defs: &mut Vec<AttributeDefinition>| -> Result<(), AppError> {
        if defs.iter().any(|d| d.attribute_name() == k.name) {
            return Ok(());
        }
        defs.push(
            AttributeDefinition::builder()
                .attribute_name(&k.name)
                .attribute_type(scalar_type(&k.attr_type)?)
                .build()
                .map_err(|e| AppError::Internal(e.to_string()))?,
        );
        Ok(())
    };

    let key_schema = |pk: &KeyAttr, sk: &Option<KeyAttr>| -> Result<Vec<KeySchemaElement>, AppError> {
        let mut ks = vec![KeySchemaElement::builder()
            .attribute_name(&pk.name)
            .key_type(KeyType::Hash)
            .build()
            .map_err(|e| AppError::Internal(e.to_string()))?];
        if let Some(sk) = sk {
            ks.push(
                KeySchemaElement::builder()
                    .attribute_name(&sk.name)
                    .key_type(KeyType::Range)
                    .build()
                    .map_err(|e| AppError::Internal(e.to_string()))?,
            );
        }
        Ok(ks)
    };

    push_attr(&req.pk, &mut attr_defs)?;
    if let Some(sk) = &req.sk {
        push_attr(sk, &mut attr_defs)?;
    }
    for g in &req.gsis {
        push_attr(&g.pk, &mut attr_defs)?;
        if let Some(sk) = &g.sk {
            push_attr(sk, &mut attr_defs)?;
        }
    }

    let mut op = client
        .create_table()
        .table_name(&req.table_name)
        .set_attribute_definitions(Some(attr_defs))
        .set_key_schema(Some(key_schema(&req.pk, &req.sk)?))
        .billing_mode(aws_sdk_dynamodb::types::BillingMode::PayPerRequest);

    for g in &req.gsis {
        op = op.global_secondary_indexes(
            GlobalSecondaryIndex::builder()
                .index_name(&g.name)
                .set_key_schema(Some(key_schema(&g.pk, &g.sk)?))
                .projection(
                    Projection::builder()
                        .projection_type(ProjectionType::All)
                        .build(),
                )
                .build()
                .map_err(|e| AppError::Internal(e.to_string()))?,
        );
    }

    op.send().await.map_err(map_sdk_err)?;
    Ok(())
}

pub async fn delete_table(client: &Client, name: &str) -> Result<(), AppError> {
    client
        .delete_table()
        .table_name(name)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

// ---- Tauri commands ----

#[tauri::command]
pub async fn ddb_list_tables(profile: ConnectionProfile) -> Result<Vec<String>, AppError> {
    list_tables(&make_client(&profile)).await
}

#[tauri::command]
pub async fn ddb_describe_table(
    profile: ConnectionProfile,
    tableName: String,
) -> Result<TableDetail, AppError> {
    describe_table(&make_client(&profile), &tableName).await
}

#[tauri::command]
pub async fn ddb_scan(profile: ConnectionProfile, req: ScanRequest) -> Result<PageResult, AppError> {
    scan(&make_client(&profile), &req).await
}

#[tauri::command]
pub async fn ddb_query(profile: ConnectionProfile, req: QueryRequest) -> Result<PageResult, AppError> {
    query(&make_client(&profile), &req).await
}

#[tauri::command]
pub async fn ddb_put_item(
    profile: ConnectionProfile,
    tableName: String,
    item: Value,
) -> Result<(), AppError> {
    put_item(&make_client(&profile), &tableName, &item).await
}

#[tauri::command]
pub async fn ddb_delete_item(
    profile: ConnectionProfile,
    tableName: String,
    key: Value,
) -> Result<(), AppError> {
    delete_item(&make_client(&profile), &tableName, &key).await
}

#[tauri::command]
pub async fn ddb_create_table(
    profile: ConnectionProfile,
    req: CreateTableRequest,
) -> Result<(), AppError> {
    create_table(&make_client(&profile), &req).await
}

#[tauri::command]
pub async fn ddb_delete_table(
    profile: ConnectionProfile,
    tableName: String,
) -> Result<(), AppError> {
    delete_table(&make_client(&profile), &tableName).await
}
```

注意: Tauri コマンド引数の `tableName` は snake_case にして `#[tauri::command(rename_all = "camelCase")]` を使う方が clippy に優しい。clippy が non_snake_case を弾く場合は各コマンドを
```rust
#[tauri::command(rename_all = "camelCase")]
pub async fn ddb_describe_table(profile: ConnectionProfile, table_name: String) -> ...
```
の形に統一すること(フロントからは `tableName` で渡す)。

`src-tauri/src/lib.rs` に `pub mod ddb;` を追加し、`invoke_handler` に 8 コマンドを追加登録:
```rust
.invoke_handler(tauri::generate_handler![
    connections::list_connections,
    connections::save_connection,
    connections::delete_connection,
    connections::detect_connections,
    ddb::ddb_list_tables,
    ddb::ddb_describe_table,
    ddb::ddb_scan,
    ddb::ddb_query,
    ddb::ddb_put_item,
    ddb::ddb_delete_item,
    ddb::ddb_create_table,
    ddb::ddb_delete_table,
])
```

- [ ] **Step 3: 統合テストが通ることを確認**

```bash
docker run -d --name ddb-local -p 8000:8000 amazon/dynamodb-local
cd src-tauri && cargo test -- --ignored
```
Expected: 2 テスト PASS

- [ ] **Step 4: 通常テスト・clippy も green を確認**

Run: `cd src-tauri && cargo test && cargo clippy -- -D warnings && cargo fmt --check`
Expected: すべて green

- [ ] **Step 5: Commit**

```bash
git add src-tauri
git commit -m "feat: add dynamodb core operations and tauri commands with integration tests"
```

---

### Task 6: TS — DynamoDB JSON ⇔ 通常 JSON 変換ユーティリティ

**Files:**
- Create: `src/lib/ddbJson.ts`
- Test: `src/lib/ddbJson.test.ts`

**Interfaces:**
- Produces:
  - `type DdbAttr = Record<string, unknown>`(`{"S": "..."}` 形式の 1 属性値)
  - `type DdbItem = Record<string, DdbAttr>`
  - `ddbToPlain(attr: DdbAttr): unknown` / `itemToPlain(item: DdbItem): Record<string, unknown>`
  - `plainToDdb(v: unknown): DdbAttr` / `plainToItem(obj: Record<string, unknown>): DdbItem`
  - 制約: 通常 JSON → DynamoDB JSON は S/N/BOOL/NULL/L/M のみ生成(セット・バイナリは編集時 DynamoDB JSON モードでのみ扱う)。N は文字列精度を保つため、plain 側では `number` に安全に収まらない場合そのまま文字列にしない — **数値は常に JS number へ変換し、`Number.isSafeInteger` を超える整数は文字列のまま保持する**

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/ddbJson.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { ddbToPlain, itemToPlain, plainToDdb, plainToItem } from "./ddbJson";

describe("ddbToPlain", () => {
  it("converts scalars", () => {
    expect(ddbToPlain({ S: "hi" })).toBe("hi");
    expect(ddbToPlain({ N: "42.5" })).toBe(42.5);
    expect(ddbToPlain({ BOOL: true })).toBe(true);
    expect(ddbToPlain({ NULL: true })).toBe(null);
  });

  it("keeps unsafe integers as strings", () => {
    expect(ddbToPlain({ N: "9007199254740993" })).toBe("9007199254740993");
  });

  it("converts nested L and M", () => {
    expect(ddbToPlain({ M: { a: { L: [{ S: "x" }, { N: "1" }] } } })).toEqual({
      a: ["x", 1],
    });
  });

  it("converts sets to arrays (lossy, display only)", () => {
    expect(ddbToPlain({ SS: ["a", "b"] })).toEqual(["a", "b"]);
    expect(ddbToPlain({ NS: ["1", "2"] })).toEqual([1, 2]);
  });
});

describe("plainToDdb", () => {
  it("converts scalars", () => {
    expect(plainToDdb("hi")).toEqual({ S: "hi" });
    expect(plainToDdb(42.5)).toEqual({ N: "42.5" });
    expect(plainToDdb(false)).toEqual({ BOOL: false });
    expect(plainToDdb(null)).toEqual({ NULL: true });
  });

  it("converts arrays and objects", () => {
    expect(plainToDdb(["x", 1])).toEqual({ L: [{ S: "x" }, { N: "1" }] });
    expect(plainToDdb({ a: 1 })).toEqual({ M: { a: { N: "1" } } });
  });
});

describe("item conversions", () => {
  it("roundtrips a simple item", () => {
    const ddb = { pk: { S: "user#1" }, age: { N: "30" } };
    expect(plainToItem(itemToPlain(ddb))).toEqual(ddb);
  });
});
```

Run: `npx vitest run src/lib/ddbJson.test.ts`
Expected: FAIL(モジュール未存在)

- [ ] **Step 2: 実装**

`src/lib/ddbJson.ts`:
```ts
export type DdbAttr = Record<string, unknown>;
export type DdbItem = Record<string, DdbAttr>;

export function ddbToPlain(attr: DdbAttr): unknown {
  const [tag] = Object.keys(attr);
  const v = attr[tag];
  switch (tag) {
    case "S":
      return v as string;
    case "N": {
      const n = Number(v as string);
      return Number.isInteger(n) && !Number.isSafeInteger(n) ? (v as string) : n;
    }
    case "BOOL":
      return v as boolean;
    case "NULL":
      return null;
    case "B":
      return v as string; // base64 のまま表示
    case "SS":
      return v as string[];
    case "NS":
      return (v as string[]).map((s) => ddbToPlain({ N: s }));
    case "BS":
      return v as string[];
    case "L":
      return (v as DdbAttr[]).map(ddbToPlain);
    case "M":
      return itemToPlain(v as DdbItem);
    default:
      return v;
  }
}

export function itemToPlain(item: DdbItem): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(item).map(([k, v]) => [k, ddbToPlain(v)]),
  );
}

export function plainToDdb(v: unknown): DdbAttr {
  if (v === null || v === undefined) return { NULL: true };
  switch (typeof v) {
    case "string":
      return { S: v };
    case "number":
      return { N: String(v) };
    case "boolean":
      return { BOOL: v };
    case "object":
      if (Array.isArray(v)) return { L: v.map(plainToDdb) };
      return { M: plainToItem(v as Record<string, unknown>) };
    default:
      throw new Error(`unsupported value: ${String(v)}`);
  }
}

export function plainToItem(obj: Record<string, unknown>): DdbItem {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k, plainToDdb(v)]),
  );
}
```

- [ ] **Step 3: テストが通ることを確認**

Run: `npx vitest run src/lib/ddbJson.test.ts && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/lib
git commit -m "feat: add DynamoDB JSON <-> plain JSON conversion utils"
```

---

### Task 7: TS — API 型定義と invoke ラッパー

**Files:**
- Create: `src/api/types.ts`
- Create: `src/api/client.ts`

**Interfaces:**
- Consumes: Rust コマンド群(Task 4, 5)、`DdbItem`(Task 6)
- Produces(後続の全 UI タスクはこの API 経由でしか Rust を呼ばない):
  - `api.listConnections(): Promise<ConnectionProfile[]>` ほか接続系 4 つ
  - `api.ddb.listTables(profile)` / `describeTable(profile, tableName)` / `scan(profile, req)` / `query(profile, req)` / `putItem(profile, tableName, item)` / `deleteItem(profile, tableName, key)` / `createTable(profile, req)` / `deleteTable(profile, tableName)`
  - `toAppError(e: unknown): AppError`(invoke の reject を正規化)

- [ ] **Step 1: 実装**(型 + 薄いラッパーのみでテスト対象ロジックがないため実装先行、tsc を検証に使う)

`src/api/types.ts`:
```ts
import type { DdbItem } from "../lib/ddbJson";

export type ConnectionProfile = {
  id: string;
  name: string;
  endpointUrl: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  color?: string | null;
};

export type DetectedEndpoint = { endpointUrl: string; tableCount: number };

export type KeyDef = { name: string; keyType: "HASH" | "RANGE"; attrType: string };
export type IndexDetail = { name: string; keys: KeyDef[] };
export type TableDetail = {
  name: string;
  status: string;
  itemCount: number;
  sizeBytes: number;
  keys: KeyDef[];
  gsis: IndexDetail[];
  lsis: IndexDetail[];
};

export type Filter = { attr: string; op: "eq" | "contains"; value: unknown };
export type ScanRequest = {
  tableName: string;
  limit: number;
  startKey?: DdbItem | null;
  filter?: Filter | null;
};
export type SkCondition = { name: string; op: "eq" | "begins_with"; value: unknown };
export type QueryRequest = {
  tableName: string;
  indexName?: string | null;
  pkName: string;
  pkValue: unknown;
  sk?: SkCondition | null;
  limit: number;
  startKey?: DdbItem | null;
};
export type PageResult = {
  items: DdbItem[];
  lastKey: DdbItem | null;
  count: number;
  scannedCount: number;
};

export type KeyAttr = { name: string; attrType: "S" | "N" | "B" };
export type GsiSpec = { name: string; pk: KeyAttr; sk?: KeyAttr | null };
export type CreateTableRequest = {
  tableName: string;
  pk: KeyAttr;
  sk?: KeyAttr | null;
  gsis: GsiSpec[];
};

export type AppError = { kind: string; message: string };
```

`src/api/client.ts`:
```ts
import { invoke } from "@tauri-apps/api/core";
import type { DdbItem } from "../lib/ddbJson";
import type {
  AppError,
  ConnectionProfile,
  CreateTableRequest,
  DetectedEndpoint,
  PageResult,
  QueryRequest,
  ScanRequest,
  TableDetail,
} from "./types";

export function toAppError(e: unknown): AppError {
  if (typeof e === "object" && e !== null && "kind" in e && "message" in e) {
    return e as AppError;
  }
  return { kind: "internal", message: String(e) };
}

export const api = {
  listConnections: () => invoke<ConnectionProfile[]>("list_connections"),
  saveConnection: (profile: ConnectionProfile) =>
    invoke<ConnectionProfile[]>("save_connection", { profile }),
  deleteConnection: (id: string) =>
    invoke<ConnectionProfile[]>("delete_connection", { id }),
  detectConnections: () => invoke<DetectedEndpoint[]>("detect_connections"),

  ddb: {
    listTables: (profile: ConnectionProfile) =>
      invoke<string[]>("ddb_list_tables", { profile }),
    describeTable: (profile: ConnectionProfile, tableName: string) =>
      invoke<TableDetail>("ddb_describe_table", { profile, tableName }),
    scan: (profile: ConnectionProfile, req: ScanRequest) =>
      invoke<PageResult>("ddb_scan", { profile, req }),
    query: (profile: ConnectionProfile, req: QueryRequest) =>
      invoke<PageResult>("ddb_query", { profile, req }),
    putItem: (profile: ConnectionProfile, tableName: string, item: DdbItem) =>
      invoke<void>("ddb_put_item", { profile, tableName, item }),
    deleteItem: (profile: ConnectionProfile, tableName: string, key: DdbItem) =>
      invoke<void>("ddb_delete_item", { profile, tableName, key }),
    createTable: (profile: ConnectionProfile, req: CreateTableRequest) =>
      invoke<void>("ddb_create_table", { profile, req }),
    deleteTable: (profile: ConnectionProfile, tableName: string) =>
      invoke<void>("ddb_delete_table", { profile, tableName }),
  },
};
```

- [ ] **Step 2: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 3: Commit**

```bash
git add src/api
git commit -m "feat: add typed api layer over tauri invoke"
```

---

### Task 8: TS — 接続 Context・アプリシェル(ヘッダー + ルーティング + ホームグリッド)

> **UI改訂あり:** ルーティング・レイアウト(サイドバー/パンくず/初期画面)・アイコンは
> `docs/superpowers/plans/2026-07-13-ui-revision.md` と `docs/design/ui-mock.html` が優先。
> 以下のコードは骨格の参考(ConnectionsProvider とテストはそのまま有効)。

**Files:**
- Create: `src/state/connections.tsx`
- Create: `src/components/Layout.tsx`, `src/components/ErrorBanner.tsx`
- Create: `src/pages/Home.tsx`
- Modify: `src/App.tsx`(全面置換)
- Test: `src/state/connections.test.tsx`

**Interfaces:**
- Consumes: `api`(Task 7)
- Produces:
  - `<ConnectionsProvider>` と `useConnections(): { profiles, active, setActiveId, refresh, loading }`(`active: ConnectionProfile | null`。activeId は localStorage キー `nlsd.activeConnectionId` に永続化。active が消えたら先頭にフォールバック)
  - `<Layout>`: 上部ヘッダー(アプリ名 / 接続セレクタ `<select>` / 接続の region 表示 / 「接続管理」リンク)+ `<Outlet/>`
  - `<ErrorBanner error={AppError|null} onRetry?>`
  - ルート: `/`(Home)、`/connections`、`/dynamodb`、`/dynamodb/:tableName`
  - Home: サービスグリッド。定義リスト `SERVICES: { id, name, available }[]` から生成。DynamoDB のみ `available: true`

- [ ] **Step 1: react-router を追加**

```bash
npm install react-router-dom
```

- [ ] **Step 2: 失敗するテストを書く**(invoke は `vi.mock` でモック)

`src/state/connections.test.tsx`:
```tsx
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ConnectionProfile } from "../api/types";

const profiles: ConnectionProfile[] = [
  { id: "1", name: "localstack", endpointUrl: "http://localhost:4566", region: "ap-northeast-1", accessKeyId: "dummy", secretAccessKey: "dummy" },
  { id: "2", name: "ministack", endpointUrl: "http://localhost:8000", region: "ap-northeast-1", accessKeyId: "dummy", secretAccessKey: "dummy" },
];

vi.mock("../api/client", () => ({
  api: { listConnections: vi.fn(async () => profiles) },
  toAppError: (e: unknown) => ({ kind: "internal", message: String(e) }),
}));

import { ConnectionsProvider, useConnections } from "./connections";

function Probe() {
  const { active, setActiveId } = useConnections();
  return (
    <div>
      <span data-testid="active">{active?.name ?? "none"}</span>
      <button onClick={() => setActiveId("2")}>switch</button>
    </div>
  );
}

describe("ConnectionsProvider", () => {
  it("defaults active to first profile and can switch", async () => {
    render(
      <ConnectionsProvider>
        <Probe />
      </ConnectionsProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("active").textContent).toBe("localstack"));
    act(() => screen.getByText("switch").click());
    expect(screen.getByTestId("active").textContent).toBe("ministack");
    expect(localStorage.getItem("nlsd.activeConnectionId")).toBe("2");
  });
});
```

Run: `npx vitest run src/state`
Expected: FAIL(モジュール未存在)

- [ ] **Step 3: 実装**

`src/state/connections.tsx`:
```tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { ConnectionProfile } from "../api/types";

const STORAGE_KEY = "nlsd.activeConnectionId";

type Ctx = {
  profiles: ConnectionProfile[];
  active: ConnectionProfile | null;
  setActiveId: (id: string) => void;
  refresh: () => Promise<void>;
  loading: boolean;
};

const ConnectionsContext = createContext<Ctx | null>(null);

export function ConnectionsProvider({ children }: { children: React.ReactNode }) {
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(
    () => localStorage.getItem(STORAGE_KEY),
  );
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setProfiles(await api.listConnections());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setActiveId = useCallback((id: string) => {
    localStorage.setItem(STORAGE_KEY, id);
    setActiveIdState(id);
  }, []);

  const active = useMemo(
    () => profiles.find((p) => p.id === activeId) ?? profiles[0] ?? null,
    [profiles, activeId],
  );

  return (
    <ConnectionsContext.Provider value={{ profiles, active, setActiveId, refresh, loading }}>
      {children}
    </ConnectionsContext.Provider>
  );
}

export function useConnections(): Ctx {
  const ctx = useContext(ConnectionsContext);
  if (!ctx) throw new Error("useConnections must be used within ConnectionsProvider");
  return ctx;
}
```

`src/components/ErrorBanner.tsx`:
```tsx
import type { AppError } from "../api/types";

const LABELS: Record<string, string> = {
  connection: "接続できません",
  not_found: "リソースが見つかりません",
  validation: "入力内容に問題があります",
  internal: "エラーが発生しました",
};

export function ErrorBanner({ error, onRetry }: { error: AppError | null; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div className="m-4 flex items-center justify-between rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
      <div>
        <span className="font-semibold">{LABELS[error.kind] ?? LABELS.internal}: </span>
        {error.message}
      </div>
      {onRetry && (
        <button onClick={onRetry} className="ml-4 rounded bg-red-600 px-3 py-1 text-white hover:bg-red-700">
          再試行
        </button>
      )}
    </div>
  );
}
```

`src/components/Layout.tsx`:
```tsx
import { Link, Outlet } from "react-router-dom";
import { useConnections } from "../state/connections";

export function Layout() {
  const { profiles, active, setActiveId } = useConnections();
  return (
    <div className="flex min-h-screen flex-col bg-gray-100">
      <header
        className="flex items-center gap-4 px-4 py-2 text-white"
        style={{ backgroundColor: active?.color || "#232f3e" }}
      >
        <Link to="/" className="text-lg font-bold tracking-tight">
          neo-localstack
        </Link>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <select
            aria-label="接続"
            className="rounded bg-white/10 px-2 py-1"
            value={active?.id ?? ""}
            onChange={(e) => setActiveId(e.target.value)}
          >
            {profiles.length === 0 && <option value="">接続なし</option>}
            {profiles.map((p) => (
              <option key={p.id} value={p.id} className="text-black">
                {p.name}
              </option>
            ))}
          </select>
          <span className="text-white/70">{active?.region ?? "-"}</span>
          <Link to="/connections" className="rounded bg-white/10 px-2 py-1 hover:bg-white/20">
            接続管理
          </Link>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
```

`src/pages/Home.tsx`:
```tsx
import { Link } from "react-router-dom";

const SERVICES = [
  { id: "dynamodb", name: "DynamoDB", desc: "NoSQL データベース", available: true },
  { id: "sqs", name: "SQS", desc: "メッセージキュー", available: false },
  { id: "sns", name: "SNS", desc: "Pub/Sub 通知", available: false },
  { id: "s3", name: "S3", desc: "オブジェクトストレージ", available: false },
  { id: "ec2", name: "EC2", desc: "仮想サーバー", available: false },
  { id: "eks", name: "EKS", desc: "マネージド Kubernetes", available: false },
];

export function Home() {
  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="mb-4 text-2xl font-bold">サービス</h1>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {SERVICES.map((s) =>
          s.available ? (
            <Link
              key={s.id}
              to={`/${s.id}`}
              className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:shadow-md"
            >
              <div className="text-lg font-semibold text-blue-700">{s.name}</div>
              <div className="text-sm text-gray-500">{s.desc}</div>
            </Link>
          ) : (
            <div
              key={s.id}
              className="cursor-not-allowed rounded-lg border border-gray-200 bg-white p-4 opacity-40"
            >
              <div className="text-lg font-semibold">{s.name}</div>
              <div className="text-sm text-gray-500">coming soon</div>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
```

`src/App.tsx`(全面置換。DynamoDB ページは Task 10-11 まで仮置き):
```tsx
import { HashRouter, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Home } from "./pages/Home";
import { ConnectionsProvider } from "./state/connections";

function Placeholder({ name }: { name: string }) {
  return <div className="p-6 text-gray-500">{name} (準備中)</div>;
}

export default function App() {
  return (
    <ConnectionsProvider>
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Home />} />
            <Route path="/connections" element={<Placeholder name="接続管理" />} />
            <Route path="/dynamodb" element={<Placeholder name="DynamoDB" />} />
            <Route path="/dynamodb/:tableName" element={<Placeholder name="テーブル" />} />
          </Route>
        </Routes>
      </HashRouter>
    </ConnectionsProvider>
  );
}
```

- [ ] **Step 4: テスト・型チェック**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: 手動確認**

Run: `npm run tauri dev`
Expected: ヘッダー(接続セレクタは「接続なし」)、サービスグリッドで DynamoDB のみ有効。クリックで「DynamoDB (準備中)」へ遷移

- [ ] **Step 6: Commit**

```bash
git add src
git commit -m "feat: add app shell with connection context, header and service grid"
```

---

### Task 9: TS — 接続管理ページ(CRUD + 自動検出)

> **UI改訂あり:** 「この接続を使う」ボタン・接続確認表示など
> `docs/superpowers/plans/2026-07-13-ui-revision.md` の「接続管理」節が優先。

**Files:**
- Create: `src/pages/ConnectionsPage.tsx`
- Modify: `src/App.tsx`(Placeholder を差し替え)

**Interfaces:**
- Consumes: `api.saveConnection/deleteConnection/detectConnections`(Task 7)、`useConnections`(Task 8)
- Produces: `/connections` ルートの完成。フォームの既定値: region `ap-northeast-1`、認証 `dummy`/`dummy`。id は `crypto.randomUUID()`

- [ ] **Step 1: 実装**

`src/pages/ConnectionsPage.tsx`:
```tsx
import { useState } from "react";
import { api, toAppError } from "../api/client";
import type { AppError, ConnectionProfile, DetectedEndpoint } from "../api/types";
import { ErrorBanner } from "../components/ErrorBanner";
import { useConnections } from "../state/connections";

const empty = (): ConnectionProfile => ({
  id: crypto.randomUUID(),
  name: "",
  endpointUrl: "http://localhost:4566",
  region: "ap-northeast-1",
  accessKeyId: "dummy",
  secretAccessKey: "dummy",
  color: null,
});

export function ConnectionsPage() {
  const { profiles, refresh } = useConnections();
  const [editing, setEditing] = useState<ConnectionProfile | null>(null);
  const [detected, setDetected] = useState<DetectedEndpoint[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim() || !editing.endpointUrl.trim()) {
      setError({ kind: "validation", message: "名前とエンドポイント URL は必須です" });
      return;
    }
    try {
      await api.saveConnection(editing);
      await refresh();
      setEditing(null);
      setError(null);
    } catch (e) {
      setError(toAppError(e));
    }
  };

  const remove = async (p: ConnectionProfile) => {
    if (!window.confirm(`接続「${p.name}」を削除しますか?`)) return;
    try {
      await api.deleteConnection(p.id);
      await refresh();
    } catch (e) {
      setError(toAppError(e));
    }
  };

  const detect = async () => {
    setDetecting(true);
    try {
      setDetected(await api.detectConnections());
    } catch (e) {
      setError(toAppError(e));
    } finally {
      setDetecting(false);
    }
  };

  const field = (label: string, value: string, onChange: (v: string) => void, type = "text") => (
    <label className="block text-sm">
      <span className="text-gray-600">{label}</span>
      <input
        type={type}
        className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">接続管理</h1>
        <div className="flex gap-2">
          <button
            onClick={detect}
            disabled={detecting}
            className="rounded border border-gray-300 bg-white px-3 py-1 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            {detecting ? "スキャン中..." : "ローカルをスキャン"}
          </button>
          <button
            onClick={() => setEditing(empty())}
            className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
          >
            接続を追加
          </button>
        </div>
      </div>

      <ErrorBanner error={error} />

      {detected.length > 0 && (
        <div className="mb-4 rounded border border-green-300 bg-green-50 p-3 text-sm">
          <div className="mb-2 font-semibold text-green-800">検出されたエンドポイント</div>
          {detected.map((d) => (
            <div key={d.endpointUrl} className="flex items-center justify-between py-1">
              <span>
                {d.endpointUrl}(テーブル {d.tableCount} 件)
              </span>
              <button
                onClick={() => setEditing({ ...empty(), name: d.endpointUrl, endpointUrl: d.endpointUrl })}
                className="rounded bg-green-600 px-2 py-0.5 text-white hover:bg-green-700"
              >
                この内容で追加
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        {profiles.length === 0 && (
          <div className="p-6 text-center text-gray-400">接続がまだ登録されていません</div>
        )}
        {profiles.map((p) => (
          <div key={p.id} className="flex items-center justify-between border-b border-gray-100 px-4 py-3 last:border-0">
            <div>
              <div className="font-semibold">
                {p.color && (
                  <span className="mr-2 inline-block h-3 w-3 rounded-full" style={{ backgroundColor: p.color }} />
                )}
                {p.name}
              </div>
              <div className="text-sm text-gray-500">
                {p.endpointUrl} / {p.region}
              </div>
            </div>
            <div className="flex gap-2 text-sm">
              <button onClick={() => setEditing({ ...p })} className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50">
                編集
              </button>
              <button onClick={() => remove(p)} className="rounded border border-red-300 px-2 py-1 text-red-600 hover:bg-red-50">
                削除
              </button>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/40" onClick={() => setEditing(null)}>
          <div className="w-full max-w-md space-y-3 rounded-lg bg-white p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold">接続の設定</h2>
            {field("名前", editing.name, (v) => setEditing({ ...editing, name: v }))}
            {field("エンドポイント URL", editing.endpointUrl, (v) => setEditing({ ...editing, endpointUrl: v }))}
            {field("リージョン", editing.region, (v) => setEditing({ ...editing, region: v }))}
            {field("Access Key ID", editing.accessKeyId, (v) => setEditing({ ...editing, accessKeyId: v }))}
            {field("Secret Access Key", editing.secretAccessKey, (v) => setEditing({ ...editing, secretAccessKey: v }), "password")}
            {field("識別色 (例: #7c3aed)", editing.color ?? "", (v) => setEditing({ ...editing, color: v || null }))}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setEditing(null)} className="rounded border border-gray-300 px-3 py-1 text-sm">
                キャンセル
              </button>
              <button onClick={save} className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700">
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

`src/App.tsx` の `/connections` ルートを差し替え:
```tsx
import { ConnectionsPage } from "./pages/ConnectionsPage";
// ...
<Route path="/connections" element={<ConnectionsPage />} />
```

- [ ] **Step 2: 検証**

Run: `npx tsc --noEmit && npx vitest run`
Expected: green

手動確認(`npm run tauri dev` + `docker run -d -p 8000:8000 amazon/dynamodb-local`):
1. 「ローカルをスキャン」→ `http://localhost:8000` が検出される
2. 「この内容で追加」→ 名前を `ddb-local` に変えて保存 → 一覧に出る
3. ヘッダーのセレクタに `ddb-local` が出て選択できる
4. 編集・削除が動く

- [ ] **Step 3: Commit**

```bash
git add src
git commit -m "feat: add connections management page with auto detection"
```

---

### Task 10: TS — テーブル一覧 + テーブル作成/削除

> **UI改訂あり:** 列構成(チェックボックス選択・ステータス・インデックス数)と削除 UI は
> `docs/superpowers/plans/2026-07-13-ui-revision.md` の「テーブル一覧」節が優先。

**Files:**
- Create: `src/features/dynamodb/TablesPage.tsx`
- Create: `src/features/dynamodb/CreateTableModal.tsx`
- Modify: `src/App.tsx`(`/dynamodb` を差し替え)

**Interfaces:**
- Consumes: `api.ddb.listTables/createTable/deleteTable`(Task 7)、`useConnections`(Task 8)
- Produces: `/dynamodb` ルートの完成。行クリックで `/dynamodb/:tableName` へ遷移

- [ ] **Step 1: 実装**

`src/features/dynamodb/CreateTableModal.tsx`:
```tsx
import { useState } from "react";
import type { CreateTableRequest, GsiSpec, KeyAttr } from "../../api/types";

const ATTR_TYPES = ["S", "N", "B"] as const;

function KeyAttrInputs({
  label,
  value,
  onChange,
  optional,
}: {
  label: string;
  value: KeyAttr | null;
  onChange: (v: KeyAttr | null) => void;
  optional?: boolean;
}) {
  return (
    <div className="flex items-end gap-2">
      <label className="flex-1 text-sm">
        <span className="text-gray-600">{label}</span>
        <input
          className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
          value={value?.name ?? ""}
          placeholder={optional ? "(なし)" : ""}
          onChange={(e) => {
            const name = e.target.value;
            if (!name && optional) onChange(null);
            else onChange({ name, attrType: value?.attrType ?? "S" });
          }}
        />
      </label>
      <select
        className="rounded border border-gray-300 px-2 py-1 text-sm"
        value={value?.attrType ?? "S"}
        disabled={!value}
        onChange={(e) => value && onChange({ ...value, attrType: e.target.value as KeyAttr["attrType"] })}
      >
        {ATTR_TYPES.map((t) => (
          <option key={t}>{t}</option>
        ))}
      </select>
    </div>
  );
}

export function CreateTableModal({
  onSubmit,
  onClose,
}: {
  onSubmit: (req: CreateTableRequest) => Promise<void>;
  onClose: () => void;
}) {
  const [tableName, setTableName] = useState("");
  const [pk, setPk] = useState<KeyAttr | null>({ name: "", attrType: "S" });
  const [sk, setSk] = useState<KeyAttr | null>(null);
  const [gsis, setGsis] = useState<GsiSpec[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const valid = tableName.trim() && pk?.name.trim();

  const submit = async () => {
    if (!valid || !pk) return;
    setSubmitting(true);
    try {
      await onSubmit({ tableName: tableName.trim(), pk, sk, gsis: gsis.filter((g) => g.name && g.pk.name) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-lg space-y-3 rounded-lg bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold">テーブルの作成</h2>
        <label className="block text-sm">
          <span className="text-gray-600">テーブル名</span>
          <input
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            value={tableName}
            onChange={(e) => setTableName(e.target.value)}
          />
        </label>
        <KeyAttrInputs label="パーティションキー" value={pk} onChange={setPk} />
        <KeyAttrInputs label="ソートキー(任意)" value={sk} onChange={setSk} optional />

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-700">GSI</span>
            <button
              className="text-sm text-blue-600 hover:underline"
              onClick={() => setGsis([...gsis, { name: "", pk: { name: "", attrType: "S" }, sk: null }])}
            >
              + GSI を追加
            </button>
          </div>
          {gsis.map((g, i) => (
            <div key={i} className="mb-2 space-y-2 rounded border border-gray-200 p-2">
              <div className="flex items-center gap-2">
                <input
                  className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
                  placeholder="インデックス名"
                  value={g.name}
                  onChange={(e) => setGsis(gsis.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                />
                <button
                  className="text-sm text-red-600 hover:underline"
                  onClick={() => setGsis(gsis.filter((_, j) => j !== i))}
                >
                  削除
                </button>
              </div>
              <KeyAttrInputs
                label="GSI パーティションキー"
                value={g.pk}
                onChange={(v) => v && setGsis(gsis.map((x, j) => (j === i ? { ...x, pk: v } : x)))}
              />
              <KeyAttrInputs
                label="GSI ソートキー(任意)"
                value={g.sk ?? null}
                onChange={(v) => setGsis(gsis.map((x, j) => (j === i ? { ...x, sk: v } : x)))}
                optional
              />
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="rounded border border-gray-300 px-3 py-1 text-sm">
            キャンセル
          </button>
          <button
            onClick={submit}
            disabled={!valid || submitting}
            className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "作成中..." : "作成"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

`src/features/dynamodb/TablesPage.tsx`:
```tsx
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, toAppError } from "../../api/client";
import type { AppError, CreateTableRequest } from "../../api/types";
import { ErrorBanner } from "../../components/ErrorBanner";
import { useConnections } from "../../state/connections";
import { CreateTableModal } from "./CreateTableModal";

export function TablesPage() {
  const { active } = useConnections();
  const [tables, setTables] = useState<string[]>([]);
  const [error, setError] = useState<AppError | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!active) return;
    setLoading(true);
    setError(null);
    try {
      setTables(await api.ddb.listTables(active));
    } catch (e) {
      setError(toAppError(e));
    } finally {
      setLoading(false);
    }
  }, [active]);

  useEffect(() => {
    void load();
  }, [load]);

  const createTable = async (req: CreateTableRequest) => {
    if (!active) return;
    try {
      await api.ddb.createTable(active, req);
      setCreating(false);
      await load();
    } catch (e) {
      setError(toAppError(e));
    }
  };

  const deleteTable = async (name: string) => {
    if (!active) return;
    const typed = window.prompt(`テーブル「${name}」を削除します。確認のためテーブル名を入力してください:`);
    if (typed !== name) return;
    try {
      await api.ddb.deleteTable(active, name);
      await load();
    } catch (e) {
      setError(toAppError(e));
    }
  };

  if (!active) {
    return (
      <div className="p-6 text-gray-500">
        接続が未登録です。<Link to="/connections" className="text-blue-600 underline">接続管理</Link>から登録してください。
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">DynamoDB テーブル</h1>
        <button
          onClick={() => setCreating(true)}
          className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
        >
          テーブルの作成
        </button>
      </div>

      <ErrorBanner error={error} onRetry={load} />

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        {loading && <div className="p-6 text-center text-gray-400">読み込み中...</div>}
        {!loading && tables.length === 0 && !error && (
          <div className="p-6 text-center text-gray-400">テーブルがありません</div>
        )}
        {!loading &&
          tables.map((t) => (
            <div key={t} className="flex items-center justify-between border-b border-gray-100 px-4 py-3 last:border-0 hover:bg-gray-50">
              <Link to={`/dynamodb/${encodeURIComponent(t)}`} className="font-medium text-blue-700 hover:underline">
                {t}
              </Link>
              <button
                onClick={() => deleteTable(t)}
                className="rounded border border-red-300 px-2 py-1 text-sm text-red-600 hover:bg-red-50"
              >
                削除
              </button>
            </div>
          ))}
      </div>

      {creating && <CreateTableModal onSubmit={createTable} onClose={() => setCreating(false)} />}
    </div>
  );
}
```

`src/App.tsx` の `/dynamodb` ルートを差し替え:
```tsx
import { TablesPage } from "./features/dynamodb/TablesPage";
// ...
<Route path="/dynamodb" element={<TablesPage />} />
```

- [ ] **Step 2: 検証**

Run: `npx tsc --noEmit && npx vitest run`
Expected: green

手動確認(dynamodb-local 接続で):
1. テーブル作成(PK のみ / PK+SK / GSI 付き)ができる
2. 一覧に反映される。削除は名前入力確認つきで動く

- [ ] **Step 3: Commit**

```bash
git add src
git commit -m "feat: add dynamodb tables page with create and delete"
```

---

### Task 11: TS — テーブル詳細(概要タブ + 項目探索タブ + アイテム CRUD)

> **UI改訂あり:** 本タスクは「テーブル詳細(概要/インデックス タブ)」と「項目を探索(独立画面
> `/dynamodb/explore`)」の 2 画面構成に変更。`docs/superpowers/plans/2026-07-13-ui-revision.md` の
> 「テーブル詳細 + 項目を探索」節が優先。ItemEditorModal と lastKey ページネーションのコードはそのまま有効。

**Files:**
- Create: `src/features/dynamodb/TableDetailPage.tsx`
- Create: `src/features/dynamodb/ItemsExplorer.tsx`
- Create: `src/features/dynamodb/ItemEditorModal.tsx`
- Modify: `src/App.tsx`(`/dynamodb/:tableName` を差し替え)

**Interfaces:**
- Consumes: `api.ddb.describeTable/scan/query/putItem/deleteItem`(Task 7)、`ddbJson` 変換(Task 6)、`useConnections`(Task 8)
- Produces: `/dynamodb/:tableName` の完成(Phase 1 の全機能が揃う)
- 仕様詳細:
  - ページサイズ 50 固定。「次のページ」は `lastKey` を積み上げ、「前のページ」はスタックを 1 つ戻して再取得
  - Query の PK/SK はテーブル or 選択された GSI のキー定義から自動で名前・型を決める(値の入力は文字列。attrType が N なら `{"N": 値}`、それ以外は `{"S": 値}`)
  - アイテム編集は既定「通常 JSON」表示。トグルで DynamoDB JSON の生編集に切替(通常 JSON はセット・バイナリを表現できない旨の注記を表示)
  - アイテム削除はテーブルのキー定義から key を組み立てる

- [ ] **Step 1: 実装**

`src/features/dynamodb/ItemEditorModal.tsx`:
```tsx
import { useMemo, useState } from "react";
import type { DdbItem } from "../../lib/ddbJson";
import { itemToPlain, plainToItem } from "../../lib/ddbJson";

export function ItemEditorModal({
  initial,
  onSubmit,
  onClose,
}: {
  initial: DdbItem | null; // null = 新規作成
  onSubmit: (item: DdbItem) => Promise<void>;
  onClose: () => void;
}) {
  const [ddbMode, setDdbMode] = useState(false);
  const initialText = useMemo(() => {
    const item = initial ?? {};
    return {
      plain: JSON.stringify(itemToPlain(item), null, 2),
      ddb: JSON.stringify(item, null, 2),
    };
  }, [initial]);
  const [text, setText] = useState(initialText.plain);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const toggleMode = () => {
    try {
      const parsed = JSON.parse(text);
      const next = ddbMode
        ? JSON.stringify(itemToPlain(parsed), null, 2)
        : JSON.stringify(plainToItem(parsed), null, 2);
      setText(next);
      setDdbMode(!ddbMode);
      setError(null);
    } catch (e) {
      setError(`JSON が不正です: ${String(e)}`);
    }
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const parsed = JSON.parse(text);
      const item: DdbItem = ddbMode ? parsed : plainToItem(parsed);
      await onSubmit(item);
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="flex h-[80vh] w-full max-w-2xl flex-col rounded-lg bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-bold">{initial ? "アイテムの編集" : "アイテムの作成"}</h2>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={ddbMode} onChange={toggleMode} />
            DynamoDB JSON
          </label>
        </div>
        {!ddbMode && (
          <p className="mb-2 text-xs text-gray-400">
            通常 JSON モードではセット型(SS/NS/BS)とバイナリ型は表現できません。必要な場合は DynamoDB JSON に切り替えてください。
          </p>
        )}
        <textarea
          className="flex-1 resize-none rounded border border-gray-300 p-2 font-mono text-sm"
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
        />
        {error && <div className="mt-2 text-sm text-red-600">{error}</div>}
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onClose} className="rounded border border-gray-300 px-3 py-1 text-sm">
            キャンセル
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

`src/features/dynamodb/ItemsExplorer.tsx`:
```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, toAppError } from "../../api/client";
import type { AppError, ConnectionProfile, PageResult, TableDetail } from "../../api/types";
import { ErrorBanner } from "../../components/ErrorBanner";
import type { DdbItem } from "../../lib/ddbJson";
import { ddbToPlain } from "../../lib/ddbJson";
import { ItemEditorModal } from "./ItemEditorModal";

const PAGE_SIZE = 50;

type Mode = "scan" | "query";

export function ItemsExplorer({ profile, detail }: { profile: ConnectionProfile; detail: TableDetail }) {
  const [mode, setMode] = useState<Mode>("scan");
  const [indexName, setIndexName] = useState<string>(""); // "" = テーブル本体
  const [pkValue, setPkValue] = useState("");
  const [skOp, setSkOp] = useState<"eq" | "begins_with">("begins_with");
  const [skValue, setSkValue] = useState("");
  const [filterAttr, setFilterAttr] = useState("");
  const [filterOp, setFilterOp] = useState<"eq" | "contains">("eq");
  const [filterValue, setFilterValue] = useState("");

  const [page, setPage] = useState<PageResult | null>(null);
  const [keyStack, setKeyStack] = useState<DdbItem[]>([]); // 過去ページの startKey
  const [error, setError] = useState<AppError | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<{ item: DdbItem | null } | null>(null);

  const activeKeys = useMemo(() => {
    if (!indexName) return detail.keys;
    return detail.gsis.concat(detail.lsis).find((i) => i.name === indexName)?.keys ?? detail.keys;
  }, [detail, indexName]);
  const pkDef = activeKeys.find((k) => k.keyType === "HASH");
  const skDef = activeKeys.find((k) => k.keyType === "RANGE");

  const typedValue = (attrType: string, raw: string): unknown =>
    attrType === "N" ? { N: raw } : { S: raw };

  const fetchPage = useCallback(
    async (startKey: DdbItem | null) => {
      setLoading(true);
      setError(null);
      try {
        if (mode === "scan") {
          const filter =
            filterAttr.trim() && filterValue.trim()
              ? { attr: filterAttr.trim(), op: filterOp, value: { S: filterValue } }
              : null;
          return await api.ddb.scan(profile, {
            tableName: detail.name,
            limit: PAGE_SIZE,
            startKey,
            filter,
          });
        }
        if (!pkDef) throw new Error("no partition key");
        return await api.ddb.query(profile, {
          tableName: detail.name,
          indexName: indexName || null,
          pkName: pkDef.name,
          pkValue: typedValue(pkDef.attrType, pkValue),
          sk:
            skDef && skValue.trim()
              ? { name: skDef.name, op: skOp, value: typedValue(skDef.attrType, skValue) }
              : null,
          limit: PAGE_SIZE,
          startKey,
        });
      } catch (e) {
        setError(toAppError(e));
        return null;
      } finally {
        setLoading(false);
      }
    },
    [mode, filterAttr, filterOp, filterValue, pkValue, skOp, skValue, indexName, profile, detail.name, pkDef, skDef],
  );

  const run = useCallback(async () => {
    setKeyStack([]);
    const p = await fetchPage(null);
    if (p) setPage(p);
  }, [fetchPage]);

  useEffect(() => {
    if (mode === "scan") void run();
    // query は「実行」ボタンで明示的に走らせる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, detail.name]);

  const nextPage = async () => {
    if (!page?.lastKey) return;
    const startKey = page.lastKey;
    const p = await fetchPage(startKey);
    if (p) {
      setKeyStack([...keyStack, startKey]);
      setPage(p);
    }
  };

  const prevPage = async () => {
    const stack = [...keyStack];
    stack.pop();
    const p = await fetchPage(stack.length > 0 ? stack[stack.length - 1] : null);
    if (p) {
      setKeyStack(stack);
      setPage(p);
    }
  };

  const keyOf = (item: DdbItem): DdbItem => {
    const key: DdbItem = {};
    for (const k of detail.keys) {
      if (item[k.name]) key[k.name] = item[k.name];
    }
    return key;
  };

  const saveItem = async (item: DdbItem) => {
    await api.ddb.putItem(profile, detail.name, item);
    setEditing(null);
    const p = await fetchPage(keyStack.length > 0 ? keyStack[keyStack.length - 1] : null);
    if (p) setPage(p);
  };

  const deleteItem = async (item: DdbItem) => {
    if (!window.confirm("このアイテムを削除しますか?")) return;
    try {
      await api.ddb.deleteItem(profile, detail.name, keyOf(item));
      const p = await fetchPage(keyStack.length > 0 ? keyStack[keyStack.length - 1] : null);
      if (p) setPage(p);
    } catch (e) {
      setError(toAppError(e));
    }
  };

  const columns = useMemo(() => {
    const cols = detail.keys.map((k) => k.name);
    for (const item of page?.items ?? []) {
      for (const k of Object.keys(item)) {
        if (!cols.includes(k)) cols.push(k);
      }
    }
    return cols.slice(0, 8);
  }, [page, detail.keys]);

  const cell = (item: DdbItem, col: string): string => {
    const v = item[col];
    if (v === undefined) return "";
    const plain = ddbToPlain(v);
    return typeof plain === "object" ? JSON.stringify(plain) : String(plain);
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-2 text-sm">
        <select
          className="rounded border border-gray-300 px-2 py-1"
          value={mode}
          onChange={(e) => setMode(e.target.value as Mode)}
        >
          <option value="scan">Scan</option>
          <option value="query">Query</option>
        </select>

        {mode === "query" && (
          <>
            <select
              className="rounded border border-gray-300 px-2 py-1"
              value={indexName}
              onChange={(e) => setIndexName(e.target.value)}
            >
              <option value="">テーブル本体</option>
              {detail.gsis.concat(detail.lsis).map((i) => (
                <option key={i.name} value={i.name}>
                  {i.name}
                </option>
              ))}
            </select>
            <input
              className="rounded border border-gray-300 px-2 py-1"
              placeholder={`${pkDef?.name ?? "pk"} =`}
              value={pkValue}
              onChange={(e) => setPkValue(e.target.value)}
            />
            {skDef && (
              <>
                <select
                  className="rounded border border-gray-300 px-2 py-1"
                  value={skOp}
                  onChange={(e) => setSkOp(e.target.value as typeof skOp)}
                >
                  <option value="begins_with">{skDef.name} begins_with</option>
                  <option value="eq">{skDef.name} =</option>
                </select>
                <input
                  className="rounded border border-gray-300 px-2 py-1"
                  placeholder="(任意)"
                  value={skValue}
                  onChange={(e) => setSkValue(e.target.value)}
                />
              </>
            )}
          </>
        )}

        {mode === "scan" && (
          <>
            <input
              className="rounded border border-gray-300 px-2 py-1"
              placeholder="属性名でフィルタ(任意)"
              value={filterAttr}
              onChange={(e) => setFilterAttr(e.target.value)}
            />
            <select
              className="rounded border border-gray-300 px-2 py-1"
              value={filterOp}
              onChange={(e) => setFilterOp(e.target.value as typeof filterOp)}
            >
              <option value="eq">=</option>
              <option value="contains">contains</option>
            </select>
            <input
              className="rounded border border-gray-300 px-2 py-1"
              placeholder="値 (文字列)"
              value={filterValue}
              onChange={(e) => setFilterValue(e.target.value)}
            />
          </>
        )}

        <button
          onClick={run}
          disabled={loading || (mode === "query" && !pkValue.trim())}
          className="rounded bg-blue-600 px-3 py-1 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          実行
        </button>
        <button
          onClick={() => setEditing({ item: null })}
          className="ml-auto rounded border border-gray-300 bg-white px-3 py-1 hover:bg-gray-50"
        >
          アイテムを作成
        </button>
      </div>

      <ErrorBanner error={error} onRetry={run} />

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-gray-600">
            <tr>
              {columns.map((c) => (
                <th key={c} className="px-3 py-2 font-medium">
                  {c}
                </th>
              ))}
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={columns.length + 1} className="p-6 text-center text-gray-400">
                  読み込み中...
                </td>
              </tr>
            )}
            {!loading && (page?.items.length ?? 0) === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="p-6 text-center text-gray-400">
                  アイテムがありません
                </td>
              </tr>
            )}
            {!loading &&
              page?.items.map((item, i) => (
                <tr key={i} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                  {columns.map((c) => (
                    <td key={c} className="max-w-[240px] truncate px-3 py-2 font-mono text-xs">
                      {cell(item, c)}
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <button onClick={() => setEditing({ item })} className="mr-2 text-blue-600 hover:underline">
                      編集
                    </button>
                    <button onClick={() => deleteItem(item)} className="text-red-600 hover:underline">
                      削除
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between text-sm text-gray-600">
        <span>
          {page ? `${page.count} 件表示(scan 対象 ${page.scannedCount} 件)` : ""}
        </span>
        <div className="flex gap-2">
          <button
            onClick={prevPage}
            disabled={loading || keyStack.length === 0}
            className="rounded border border-gray-300 px-3 py-1 disabled:opacity-40"
          >
            前へ
          </button>
          <button
            onClick={nextPage}
            disabled={loading || !page?.lastKey}
            className="rounded border border-gray-300 px-3 py-1 disabled:opacity-40"
          >
            次へ
          </button>
        </div>
      </div>

      {editing && (
        <ItemEditorModal initial={editing.item} onSubmit={saveItem} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
```

`src/features/dynamodb/TableDetailPage.tsx`:
```tsx
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, toAppError } from "../../api/client";
import type { AppError, IndexDetail, KeyDef, TableDetail } from "../../api/types";
import { ErrorBanner } from "../../components/ErrorBanner";
import { useConnections } from "../../state/connections";
import { ItemsExplorer } from "./ItemsExplorer";

function KeyBadges({ keys }: { keys: KeyDef[] }) {
  return (
    <span className="space-x-1">
      {keys.map((k) => (
        <span key={k.name} className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs">
          {k.name} ({k.keyType === "HASH" ? "PK" : "SK"}, {k.attrType})
        </span>
      ))}
    </span>
  );
}

function IndexTable({ title, indexes }: { title: string; indexes: IndexDetail[] }) {
  if (indexes.length === 0) return null;
  return (
    <div className="mt-4">
      <h3 className="mb-1 font-semibold text-gray-700">{title}</h3>
      {indexes.map((i) => (
        <div key={i.name} className="border-b border-gray-100 py-1 text-sm last:border-0">
          <span className="mr-2 font-medium">{i.name}</span>
          <KeyBadges keys={i.keys} />
        </div>
      ))}
    </div>
  );
}

export function TableDetailPage() {
  const { tableName } = useParams<{ tableName: string }>();
  const { active } = useConnections();
  const [detail, setDetail] = useState<TableDetail | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [tab, setTab] = useState<"overview" | "items">("items");

  const load = useCallback(async () => {
    if (!active || !tableName) return;
    setError(null);
    try {
      setDetail(await api.ddb.describeTable(active, tableName));
    } catch (e) {
      setError(toAppError(e));
    }
  }, [active, tableName]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-1 text-sm text-gray-500">
        <Link to="/dynamodb" className="text-blue-600 hover:underline">
          テーブル
        </Link>
        {" / "}
        {tableName}
      </div>
      <h1 className="mb-4 text-2xl font-bold">{tableName}</h1>

      <ErrorBanner error={error} onRetry={load} />

      <div className="mb-4 flex gap-1 border-b border-gray-200">
        {(["items", "overview"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm ${
              tab === t
                ? "border-b-2 border-blue-600 font-semibold text-blue-700"
                : "text-gray-500 hover:text-gray-800"
            }`}
          >
            {t === "items" ? "項目の探索" : "概要"}
          </button>
        ))}
      </div>

      {tab === "overview" && detail && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm">
          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 md:grid-cols-4">
            <div>
              <dt className="text-gray-500">ステータス</dt>
              <dd className="font-medium">{detail.status}</dd>
            </div>
            <div>
              <dt className="text-gray-500">アイテム数(概算)</dt>
              <dd className="font-medium">{detail.itemCount}</dd>
            </div>
            <div>
              <dt className="text-gray-500">サイズ</dt>
              <dd className="font-medium">{detail.sizeBytes} bytes</dd>
            </div>
            <div>
              <dt className="text-gray-500">キー</dt>
              <dd>
                <KeyBadges keys={detail.keys} />
              </dd>
            </div>
          </dl>
          <IndexTable title="グローバルセカンダリインデックス (GSI)" indexes={detail.gsis} />
          <IndexTable title="ローカルセカンダリインデックス (LSI)" indexes={detail.lsis} />
        </div>
      )}

      {tab === "items" && detail && active && <ItemsExplorer profile={active} detail={detail} />}
    </div>
  );
}
```

`src/App.tsx` の `/dynamodb/:tableName` を差し替え(`Placeholder` 定義は不要になるので削除):
```tsx
import { TableDetailPage } from "./features/dynamodb/TableDetailPage";
// ...
<Route path="/dynamodb/:tableName" element={<TableDetailPage />} />
```

- [ ] **Step 2: 検証**

Run: `npx tsc --noEmit && npx vitest run`
Expected: green

手動確認(dynamodb-local 接続):
1. Task 10 で作ったテーブルを開く → 概要タブに PK/SK/GSI が出る
2. アイテム作成(通常 JSON で `{"pk": "user#1", "sk": "a", "n": 1}` 等)→ 一覧に出る
3. Scan フィルタ・Query(PK 指定、SK begins_with)・GSI Query が動く
4. 51 件以上入れてページネーション(次へ/前へ)が動く
5. 編集(DynamoDB JSON トグル含む)・削除が動く

- [ ] **Step 3: Commit**

```bash
git add src
git commit -m "feat: add table detail page with items explorer and item crud"
```

---

### Task 12: 最終検証 + README

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: 全タスクの成果物

- [ ] **Step 1: 全チェックを一括実行**

```bash
npx tsc --noEmit && npx vitest run
cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test
docker start ddb-local || docker run -d --name ddb-local -p 8000:8000 amazon/dynamodb-local
cargo test -- --ignored
```
Expected: すべて green

- [ ] **Step 2: LocalStack でも一気通貫の手動確認**

```bash
docker run -d --name localstack -p 4566:4566 localstack/localstack
npm run tauri dev
```
1. 接続管理 → スキャン → `http://localhost:4566` を検出して登録
2. テーブル作成 → アイテム投入 → Scan/Query → 編集 → 削除 → テーブル削除
3. ヘッダーで dynamodb-local(:8000)との切り替えが即時に反映される

- [ ] **Step 3: README を記載**

`README.md`:
```markdown
# neo-localstack-desktop

ローカル AWS エミュレータ(LocalStack / floci / ministack / dynamodb-local など)向けの
AWS コンソール風デスクトップクライアント。Phase 1 は DynamoDB に対応。

## 機能

- 複数エミュレータの接続プロファイル管理(手動登録 + localhost ポートスキャン検出)
- テーブル一覧・スキーマ表示(PK/SK・GSI/LSI)
- アイテムの Scan / Query(フィルタ・ページネーション)
- アイテムの作成・編集・削除(通常 JSON ⇔ DynamoDB JSON 切替エディタ)
- テーブルの作成(PK/SK/GSI)・削除

## 開発

```bash
npm install
npm run tauri dev
```

## テスト

```bash
npx vitest run                 # フロント
cd src-tauri && cargo test     # Rust 単体
docker run -d -p 8000:8000 amazon/dynamodb-local
cd src-tauri && cargo test -- --ignored   # DynamoDB 統合テスト
```
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add readme with features and development guide"
```

---

## Self-Review 済みの注意点(実装者向け)

- スペックとの差分: 永続化は tauri-plugin-store ではなく素の JSON ファイル(`ProfileStore`)。機能同等・テスト容易性優先の意図的変更
- aws-sdk-dynamodb / aws-smithy-runtime-api の API はバージョンで細部が変わることがある。`map_sdk_err` の `Response` 型パラメータや `ProvideErrorMetadata` の import パスがコンパイルエラーになったら、`cargo doc --open` で現行シグネチャを確認して合わせる(エラー分類のロジック自体は変えない)
- Tauri コマンドの引数名はフロントから camelCase で渡すため、Rust 側は `#[tauri::command(rename_all = "camelCase")]` + snake_case 引数で統一する
- `src-tauri/Cargo.toml` の `[lib] name` は統合テストの `use` パスと一致させること
