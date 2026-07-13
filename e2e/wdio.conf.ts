import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TauriCapabilities } from "@wdio/tauri-service";

const rootDir = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const tauriDir = join(rootDir, "src-tauri");

// Tauri identifier from src-tauri/tauri.conf.json. The app persists connection
// profiles to <app_config_dir>/connections.json; on macOS that is under
// ~/Library/Application Support/<identifier>/.
const TAURI_IDENTIFIER = "jp.dev.neolocalstack.desktop";

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

  // Reset persisted connection state before the whole run so the suite starts
  // from a clean slate (see connectionsConfigPath docs above).
  onPrepare() {
    const path = connectionsConfigPath();
    if (existsSync(path)) {
      rmSync(path, { force: true });
      // eslint-disable-next-line no-console
      console.log(`[e2e] removed stale connections config: ${path}`);
    }
  },
};
