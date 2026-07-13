# Task P2-5 Report — GitHub Actions: e2e.yml + build.yml

## Deliverables

1. `.github/workflows/e2e.yml` (created)
2. `.github/workflows/build.yml` (created)
3. `.github/workflows/ci.yml` (modified: added `develop` to push branches)
4. `src/web-smoke.test.tsx` (created — web build 動作確認 smoke)

## Workflow design decisions

### e2e.yml (on: push [main, develop] + workflow_dispatch)
- **e2e-linux**: `ubuntu-latest`, matrix `emulator: [localstack, floci, ministack]`, `fail-fast: false`.
  Steps: checkout → Tauri apt deps (copied verbatim from ci.yml) → node 22 + `npm ci` →
  `dtolnay/rust-toolchain@stable` + `Swatinem/rust-cache@v2` (workspaces: src-tauri) →
  `scripts/emulator.sh start <emulator>` + `wait` → `npm run tauri build -- --debug` →
  `xvfb-run --auto-servernum npm run e2e` with `E2E_ENDPOINT=http://localhost:4566` →
  `if: always()` stop emulator → `if: failure()` upload `e2e/logs/` + `e2e/screenshots/` artifact.
- **e2e-macos** / **e2e-windows**: single `ministack-pip` emulator (no docker on those runners),
  `npm run e2e` (no xvfb). All emulator.sh invocations use `shell: bash` (Git Bash on Windows).
  Same always()-stop + failure()-upload pattern.
- Rationale for the split (from plan Global Constraints): emulator compatibility is a network-protocol
  concern and OS-independent, so the 3-emulator matrix runs only on Linux; mac/win verify OS
  compatibility with one pip-launched emulator.
- Emulator image references documented inline as comments per plan:
  localstack `localstack/localstack:4.4.0` (fallback `:3`), floci `floci/floci:latest`,
  ministack `ministackorg/ministack`. Actual image selection lives in `scripts/emulator.sh` (P2-3).
- Debug binary: `tauri.conf.json` `beforeBuildCommand: "npm run build"` builds the frontend dist as
  part of `tauri build`, so no separate `npm run build` step is needed before the debug bundle.

### build.yml (on: push [main, develop] + workflow_dispatch)
- **desktop**: matrix via `include` —
  - `macos-latest` with `args: --target universal-apple-darwin` + `rustup target add aarch64-apple-darwin x86_64-apple-darwin`;
  - `windows-latest` with empty args.
  Uses `tauri-apps/tauri-action@v0` with `includeUpdaterJson: false`, **no signing env** (unsigned build).
  Uploads `actions/upload-artifact@v4` covering both `src-tauri/target/release/bundle/**` and
  `src-tauri/target/universal-apple-darwin/release/bundle/**` (universal bundles land under the target subdir).
- **web**: `ubuntu-latest`, `npm ci` → `npm run build` → upload `dist/` → web smoke
  `npx vitest run src/web-smoke.test.tsx`.

### src/web-smoke.test.tsx
- Uses `@tauri-apps/api/mocks` `mockIPC` to mock `list_connections` → `[]` (also `detect_connections`,
  `ddb_list_tables` → `[]` defensively). Renders `<App/>` and asserts the `接続管理` heading
  (role=heading) plus the empty-state text `接続がまだ登録されていません`.
- Needed `import "@testing-library/jest-dom/vitest"` because `test-setup.ts` does not register
  jest-dom matchers globally (existing tests use `.textContent`); scoped the import to this file to
  avoid touching shared setup.
- `clearMocks()` in `afterEach`.

## Validation results
- actionlint (all three workflows): exit 0, no findings.
- YAML load (ruby YAML.load_file): OK for all three files. (`python3` had no pyyaml; used ruby + actionlint.)
- `npx vitest run src/web-smoke.test.tsx`: 1 passed.
- `npx vitest run` (full suite): 4 files, 19 tests passed.
- `npx tsc --noEmit`: clean.

## Contract assumptions to reconcile with P2-3
1. **emulator.sh supports `ministack-pip`** as a mode for `start|stop|wait` (used on mac/win). The
   task deliverable text spelled out inline `pipx install ministack || pip3 install ministack`; I
   instead routed mac/win through `scripts/emulator.sh start ministack-pip` to keep a single source
   of truth matching the stated P2-3 contract. If emulator.sh does NOT implement `ministack-pip`,
   either add it there or replace the mac/win start/stop steps with inline pip commands.
2. **Artifact paths** `e2e/logs/` and `e2e/screenshots/` are assumed output locations for wdio logs
   and failure screenshots. Uploads use `if-no-files-found: ignore`, so a path mismatch degrades
   gracefully but silently — confirm wdio.conf.ts writes there (or adjust paths).
3. **`npm run e2e`** and `E2E_ENDPOINT` (default `http://localhost:4566`) per the fixed contract.
4. **Debug binary path**: not referenced directly in the workflow; wdio.conf.ts is assumed to locate
   the `--debug` bundle produced by `npm run tauri build -- --debug`.
