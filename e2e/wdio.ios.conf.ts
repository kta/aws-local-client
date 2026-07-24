import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { browser } from "@wdio/globals";
import { restoreDialogs } from "./helpers/app";

/**
 * iOS E2E configuration: runs the SAME spec suite as the desktop config, but
 * drives the Tauri iOS app's WKWebView in the simulator through Appium's
 * XCUITest driver (webview context).
 *
 * Why not the embedded WebDriver used on desktop? The published
 * tauri-plugin-wdio(-webdriver) crates declare an `ios_path` but ship no iOS
 * sources (upstream repo lacks them too), so they cannot compile for mobile.
 * Appium's hybrid-app support gives us a W3C session against the webview DOM,
 * which is all the specs need (they interact via testids + browser.execute).
 *
 * Build the app under test first:
 *   npm run e2e:ios:build
 * Then run against a live emulator (default endpoint http://localhost:4566):
 *   E2E_ENDPOINT=http://localhost:4566 npm run e2e:ios
 *
 * The simulator shares the host network stack, so `localhost:<port>` inside
 * the app reaches the same emulator the specs seed via the AWS SDK.
 */
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const logsDir = join(rootDir, "e2e", "logs-ios");
const screenshotsDir = join(rootDir, "e2e", "screenshots");

const appPath =
  process.env.IOS_APP ??
  join(
    rootDir,
    "src-tauri",
    "gen",
    "apple",
    "build",
    "arm64-sim",
    "neo-localstack-desktop.app",
  );

if (!existsSync(appPath)) {
  throw new Error(
    `iOS E2E app not found at ${appPath}. Run \`npm run e2e:ios:build\` first ` +
      `(or point IOS_APP at a simulator .app bundle).`,
  );
}

/**
 * Pick a simulator device. The app is a desktop-style console, so prefer the
 * roomier iPad; fall back to any iPhone. Overridable via IOS_DEVICE.
 */
function resolveDeviceName(): string {
  if (process.env.IOS_DEVICE) return process.env.IOS_DEVICE;
  const list = execSync("xcrun simctl list devices available", { encoding: "utf8" });
  // Device names may contain parentheses ("iPad Pro 13-inch (M5)"), so anchor
  // the split on the 36-char UDID that always follows the name.
  const ipad = list.match(/^\s+(iPad.+?) \([0-9A-F-]{36}\)/m)?.[1]?.trim();
  if (ipad) return ipad;
  const iphone = list.match(/^\s+(iPhone.+?) \([0-9A-F-]{36}\)/m)?.[1]?.trim();
  if (iphone) return iphone;
  throw new Error("No available iOS simulator device found (xcrun simctl list devices).");
}

const deviceName = resolveDeviceName();
// eslint-disable-next-line no-console
console.log(`[e2e-ios] device: ${deviceName}, app: ${appPath}`);

export const config: WebdriverIO.Config = {
  runner: "local",
  tsConfigPath: join(rootDir, "e2e", "tsconfig.json"),
  outputDir: logsDir,

  specs: [join(rootDir, "e2e", "specs", "**", "*.e2e.ts")],
  maxInstances: 1,

  // @wdio/appium-service starts/stops the Appium server around the run. The
  // XCUITest driver is an npm devDependency, so the whole stack is hermetic.
  services: [
    [
      "appium",
      {
        args: {
          relaxedSecurity: true,
        },
      },
    ],
  ],

  capabilities: [
    {
      platformName: "iOS",
      "appium:automationName": "XCUITest",
      "appium:deviceName": deviceName,
      "appium:app": appPath,
      // Land the session directly in the WKWebView context: specs speak DOM.
      "appium:autoWebview": true,
      "appium:webviewConnectRetries": 30,
      // Default reset (noReset/fullReset both unset) reinstalls the app per
      // session, which clears the app container and therefore the persisted
      // connection profiles — every spec file starts from zero connections
      // (the desktop config deletes the profile store file instead).
      // fullReset would be stronger but shuts down and erases the whole
      // simulator per session, which is both very slow and disruptive.
      "appium:newCommandTimeout": 300,
      // CI simulators cold-boot slowly.
      "appium:wdaLaunchTimeout": 120000,
      "appium:simulatorStartupTimeout": 300000,
    },
  ] as unknown as WebdriverIO.Config["capabilities"],

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
  // The simulator is slower than a native desktop app; give waits more room.
  // Session creation includes the WebDriverAgent build on a cold CI runner,
  // which can take several minutes even with the simulator pre-booted.
  waitforTimeout: 20000,
  connectionRetryTimeout: 600000,
  connectionRetryCount: 2,

  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: {
    ui: "bdd",
    timeout: 240000,
  },

  onPrepare() {
    mkdirSync(logsDir, { recursive: true });
    mkdirSync(screenshotsDir, { recursive: true });
    // Pre-boot the simulator so session creation does not pay the cold-boot
    // cost inside the WebDriver request timeout. `bootstatus -b` boots the
    // device when needed and blocks until it is ready; booting an already
    // booted device is a no-op.
    // eslint-disable-next-line no-console
    console.log(`[e2e-ios] booting simulator: ${deviceName} ...`);
    execSync(`xcrun simctl bootstatus "${deviceName}" -b`, {
      stdio: "inherit",
      timeout: 300000,
    });
  },

  // On any failing test, capture a screenshot of the webview into
  // e2e/screenshots/ so CI (and local debugging) can inspect the failure state.
  async afterTest(test, _context, result) {
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
      const file = join(screenshotsDir, `ios-${stamp}__${safe || "test"}.png`);
      await browser.saveScreenshot(file);
      // eslint-disable-next-line no-console
      console.log(`[e2e-ios] saved failure screenshot: ${file}`);
    } catch (e) {
      const err = e as Error;
      try {
        writeFileSync(
          join(logsDir, "screenshot-errors.log"),
          `${new Date().toISOString()} ${test.title}: ${err.message}\n`,
          { flag: "a" },
        );
      } catch {
        /* never mask the original failure */
      }
    }
  },
};
