# AGENTS.md

neo-localstack-desktop is an AWS-console-style desktop client for local AWS emulators
(LocalStack / floci / ministack / kumo / amazon dynamodb-local), selected by endpoint URL.
Stack: Tauri 2 shell, React 19 + TypeScript (Vite) frontend, Rust backend using the aws-sdk-* crates.
Supported services: DynamoDB (Phase 1); SQS, SNS, S3, RDS (Phase 2); and the Top20
expansion — Lambda, API Gateway, Cognito, EventBridge, Secrets Manager, ElastiCache,
CloudFormation, ECS, ECR, CloudWatch, Step Functions, OpenSearch, Athena, MSK, Systems
Manager (SSM), Route 53. Emulator API gaps are handled per-operation via capability gates
(`e2e/helpers/capabilities.ts`), never by assuming one emulator's whole feature set.
UI copy is Japanese; the codebase is English.

## Setup & Commands

Install (use the lockfile):

```bash
npm ci
```

Run the desktop app in dev mode:

```bash
npm run tauri dev
```

Run all checks (must be green before claiming done):

```bash
npx tsc --noEmit \
  && npx vitest run \
  && (cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test)
```

Integration tests (require Docker; hit a real emulator via `DDB_ENDPOINT`, default `http://localhost:8000`):

```bash
docker run -d --name ddb-local -p 8000:8000 amazon/dynamodb-local
(cd src-tauri && cargo test -- --ignored)
# Against another emulator, override the endpoint:
docker run -d --name localstack -p 4566:4566 localstack/localstack:3
(cd src-tauri && DDB_ENDPOINT=http://localhost:4566 cargo test -- --ignored)
```

E2E (full-app WebDriver suite; runs against a live emulator via `E2E_ENDPOINT`, default `http://localhost:4566`):

```bash
# 1. Build the debug app binary (cross-env keeps this working on Windows too).
npm run e2e:build
# 2. Start + wait for an emulator (<localstack|floci|ministack|kumo|ministack-pip>).
#    Set EMU_PORT to publish on a free host port when 4566 is taken.
scripts/emulator.sh start ministack && scripts/emulator.sh wait ministack
# 3. Run the suite against that emulator's endpoint.
E2E_ENDPOINT=http://localhost:4566 npm run e2e
scripts/emulator.sh stop ministack     # tear down when done
```

## Architecture

- `src/api/client.ts` — typed `invoke` wrappers mirroring Rust commands 1:1 (camelCase names).
- `src/api/types.ts` — TS mirrors of Rust wire structs (ConnectionProfile, TableDetail, PageResult, ...).
- `src/features/dynamodb/` — DynamoDB pages (Tables, TableDetail, Explore) + item/table modals.
- `src/pages/` — top-level screens: ConnectionsPage (initial screen), Home (service grid).
- `src/lib/ddbJson.ts` — DynamoDB JSON ⇔ plain JSON converters (UI-edge only).
- `src/state/connections.tsx` — connection context: profiles, active profile, switching.
- `src/components/` — Layout, SideNav, ErrorBanner.
- `src-tauri/src/error.rs` — `AppError` enum (connection/notFound/validation/internal), the error wire contract.
- `src-tauri/src/attr.rs` — AttributeValue ⇔ DynamoDB JSON conversion (lossless, base64 for binary).
- `src-tauri/src/connections.rs` — profile store, `make_client`, localhost port scan (auto-detect).
- `src-tauri/src/ddb.rs` — core DynamoDB commands (list/describe/scan/query/put/delete/create/delete table).
- `src-tauri/src/lib.rs` — Tauri builder + `invoke_handler` command registry.
- `e2e/` — spec-traceable E2E suite (see `e2e/SPEC-COVERAGE.md`).
- `docs/design/ui-mock.html` — approved design reference; UI must follow it.

## Conventions

- Commits: Conventional Commits (`feat:` / `fix:` / `chore:` / `docs:` / `test:` / `ci:`).
- English for identifiers and comments; Japanese for user-facing UI copy.
- Wire contract is serde `rename_all = "camelCase"` on Rust structs, mirrored by TS types.
  Change BOTH sides or neither — never one side alone.
- On-the-wire item format is always DynamoDB JSON (lossless). Convert to/from plain JSON
  only at the UI edge (`src/lib/ddbJson.ts`), never in the transport layer.
- Light theme only.

## Do & Don't

Do:
- Run the full check block above and confirm green before claiming any work is done.
- Keep `e2e/SPEC-COVERAGE.md` at 100% (every R-id has a test) when touching spec behavior.
- Pin token-free emulator image tags (e.g. `localstack/localstack:3`).

Don't:
- Commit secrets (tokens, API keys); use `~/.zshrc.local` / direnv `.envrc`.
- Push or deploy without an explicit request.
- Change one side of the Rust⇄TS camelCase wire contract without the other.
- Use `localstack/localstack:latest` (requires an auth token since 2026-03).

## Testing

Three levels:
- Unit: `npx vitest run` (frontend) + `cargo test` (Rust). No Docker required.
- Integration: `cargo test -- --ignored` against a live emulator via `DDB_ENDPOINT`
  (default `http://localhost:8000`).
- E2E: full-app WebDriver suite against a live emulator via `E2E_ENDPOINT`
  (default `http://localhost:4566`). Traceability rule: `e2e/SPEC-COVERAGE.md` maps every
  requirement id (R1..R50) to at least one test; when a spec requirement changes, update the
  spec in `docs/superpowers/specs/` AND the coverage table in the same change.
