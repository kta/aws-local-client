import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { browser } from "@wdio/globals";
import type { TauriCapabilities } from "@wdio/tauri-service";
import { restoreDialogs } from "./helpers/app";

const rootDir = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const tauriDir = join(rootDir, "src-tauri");

// CI uploads these directories on failure (see .github/workflows/e2e.yml).
const logsDir = join(rootDir, "e2e", "logs");
const screenshotsDir = join(rootDir, "e2e", "screenshots");

// Tauri identifier for E2E builds, overridden in src-tauri/tauri.e2e.conf.json
// (see package.json `e2e:build`). The e2e overlay uses a distinct `.e2e`
// identifier so resetting app state never touches a developer's real
// (production-identifier) app-config dir. The app persists connection profiles
// to <app_config_dir>/connections.json; on macOS that is under
// ~/Library/Application Support/<identifier>/.
const TAURI_IDENTIFIER = "jp.dev.neolocalstack.desktop.e2e";

/**
 * `tauri build --debug` output binary. The Cargo package is named "app", so the
 * raw executable is target/debug/app. We also fall back to the bundled .app and
 * to a productName-based binary so this keeps working if the package is renamed.
 */
function resolveAppBinary(): string {
  const candidates = [
    join(tauriDir, "target", "debug", "app"),
    join(tauriDir, "target", "debug", "neo-localstack-desktop"),
    join(
      tauriDir,
      "target",
      "debug",
      "bundle",
      "macos",
      "neo-localstack-desktop.app",
      "Contents",
      "MacOS",
      "neo-localstack-desktop",
    ),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      `Debug app binary not found. Run \`npm run e2e:build\` first. Looked in:\n${candidates.join("\n")}`,
    );
  }
  return found;
}

/**
 * macOS app-config path where connection profiles are persisted. Deleting it
 * before the run guarantees each E2E run starts from zero registered
 * connections. `active` is derived from the loaded profiles, so an empty file
 * is enough for a clean start regardless of any stale localStorage.
 */
function connectionsConfigPath(): string {
  if (process.platform === "darwin") {
    return join(
      homedir(),
      "Library",
      "Application Support",
      TAURI_IDENTIFIER,
      "connections.json",
    );
  }
  if (process.platform === "win32") {
    return join(
      process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
      TAURI_IDENTIFIER,
      "connections.json",
    );
  }
  return join(
    process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
    TAURI_IDENTIFIER,
    "connections.json",
  );
}

const appBinaryPath = resolveAppBinary();

/**
 * Kill any lingering debug-app process. The embedded-driver app can outlive its
 * WebDriver session and keep TAURI_WEBDRIVER_PORT bound, which makes the *next*
 * session attach to the stale window (observed: session 3 saw session 2's UI).
 * Only safe to call in afterSession (the service owns launch in beforeSession).
 */
function killLingeringApp(): void {
  try {
    if (process.platform === "win32") {
      execSync("taskkill /F /IM app.exe /T", { stdio: "ignore" });
    } else {
      execSync(`pkill -f ${appBinaryPath}`, { stdio: "ignore" });
    }
  } catch {
    /* nothing to kill */
  }
}

const tauriCapabilities: TauriCapabilities[] = [
  {
    browserName: "tauri",
    "tauri:options": {
      application: appBinaryPath,
    },
  },
];

export const config: WebdriverIO.Config = {
  runner: "local",
  tsConfigPath: join(rootDir, "e2e", "tsconfig.json"),

  // WebdriverIO + driver logs land here so CI can upload them on failure.
  outputDir: logsDir,

  specs: [join(rootDir, "e2e", "specs", "**", "*.e2e.ts")],
  maxInstances: 1,

  services: [
    [
      "@wdio/tauri-service",
      {
        appBinaryPath,
        // Embedded W3C WebDriver server (tauri-plugin-wdio-webdriver). No
        // external tauri-driver / CrabNebula needed; works natively on macOS.
        driverProvider: "embedded",
      },
    ],
  ],

  capabilities: tauriCapabilities as unknown as WebdriverIO.Config["capabilities"],

  // WebdriverIO's request layer sets a `Content-Length` header manually. Node
  // 26's built-in undici rejects that as an "invalid content-length header"
  // (UND_ERR_INVALID_ARG) before the request is sent. Dropping the header lets
  // fetch/undici compute it, which is what newer runtimes require.
  transformRequest: (requestOptions: RequestInit) => {
    const headers = requestOptions.headers;
    if (headers instanceof Headers) {
      headers.delete("Content-Length");
    } else if (headers && typeof headers === "object") {
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === "content-length") {
          delete (headers as Record<string, string>)[key];
        }
      }
    }
    return requestOptions;
  },

  logLevel: "info",
  bail: 0,
  waitforTimeout: 15000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,

  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: {
    ui: "bdd",
    timeout: 120000,
  },

  // Ensure the logs/screenshots output directories exist once per run.
  onPrepare() {
    mkdirSync(logsDir, { recursive: true });
    mkdirSync(screenshotsDir, { recursive: true });
  },

  // Reset persisted connection state before EACH spec-file session so every
  // spec starts from zero registered connections (see connectionsConfigPath
  // docs above). NOTE: do NOT kill the app here — the tauri-service launches it
  // in its own beforeSession, and killing would race that launch.
  beforeSession() {
    const path = connectionsConfigPath();
    if (existsSync(path)) {
      rmSync(path, { force: true });
      // eslint-disable-next-line no-console
      console.log(`[e2e] removed stale connections config: ${path}`);
    }
  },

  // Ensure the app process is gone once the session ends, so a lingering window
  // cannot keep the WebDriver port bound and leak into the next spec's session
  // (observed: session 3 attached to session 2's stale UI).
  afterSession() {
    killLingeringApp();
  },

  // On any failing test, capture a screenshot of the webview into
  // e2e/screenshots/ so CI (and local debugging) can inspect the failure state.
  async afterTest(test, _context, result) {
    // Restore any window.confirm / window.prompt stubs installed during the test
    // so they never leak into the next test's window state. Best-effort: a
    // restore failure must not mask the test result or the screenshot capture.
    try {
      await restoreDialogs();
    } catch {
      /* session may already be gone; ignore */
    }
    if (result.passed) return;
    try {
      const safe = `${test.parent} ${test.title}`
        .replace(/[^a-z0-9]+/gi, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 120);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const file = join(screenshotsDir, `${stamp}__${safe || "test"}.png`);
      await browser.saveScreenshot(file);
      // eslint-disable-next-line no-console
      console.log(`[e2e] saved failure screenshot: ${file}`);
    } catch (e) {
      // A screenshot failure must never mask the original test failure.
      const err = e as Error;
      try {
        writeFileSync(
          join(logsDir, "screenshot-errors.log"),
          `${new Date().toISOString()} ${test.title}: ${err.message}\n`,
          { flag: "a" },
        );
      } catch {
        /* ignore */
      }
    }
  },
};
