import { $, browser, expect } from "@wdio/globals";
import {
  E2E_ENDPOINT,
  T,
  changeRegionViaHeader,
  clearAllConnections,
  clickT,
  connectionRowExists,
  connectionRowText,
  deleteConnectionByName,
  editConnectionByName,
  gotoConnections,
  gotoTables,
  navigateHash,
  registerConnection,
  setValueT,
  setupActiveConnection,
  switchConnectionByName,
  useConnectionByName,
  waitDisplayed,
  waitForTableRow,
} from "../helpers/app";
import { createTable, makeClient } from "../helpers/emulator";

/**
 * Connection-management requirements:
 *   R1  manual register / edit / delete (defaults 4566 / ap-northeast-1 / dummy)
 *   R2  auto-detect (scan button -> add from results)
 *   R3  switch connection (use -> home, header selector, connection color)
 *   R13 error handling (unreachable endpoint -> error banner + retry)
 *   R14 connection management is the entry screen; 0 profiles can't leave it
 *   R17 header region selector changes the active connection's region,
 *       persists it, and refetches the table list
 *
 * The suite starts from a clean connections.json (wdio onPrepare), so R14 runs
 * first while zero profiles exist.
 */
describe("connections", () => {
  // Ensure a zero-profile starting point regardless of cross-session leftovers
  // (the per-session config reset is best-effort; this is deterministic).
  before(async () => {
    await clearAllConnections();
  });

  // R14 — MUST run first: the app boots into 接続管理 with zero profiles and
  // cannot navigate to any other screen.
  it("R14: boots into 接続管理 and blocks navigation while zero profiles exist", async () => {
    const heading = await waitDisplayed(T("connections-heading"), 30000);
    await expect(heading).toHaveText("接続管理");
    await expect($(T("connection-row"))).not.toBeExisting();

    // Attempting to jump straight to the tables screen bounces back.
    await navigateHash("#/dynamodb/tables");
    await browser.waitUntil(async () => await $(T("connections-heading")).isDisplayed(), {
      timeout: 10000,
      timeoutMsg: "did not stay on / return to 接続管理 with zero profiles",
    });
    await expect($(T("tables-heading"))).not.toBeExisting();
  });

  // R1 — register (with default field values), edit, delete.
  it("R1: registers a connection using the default field values", async () => {
    await gotoConnections();
    await clickT("add-connection");

    // Defaults per spec: endpoint 4566, region ap-northeast-1.
    await expect($(T("conn-endpoint"))).toHaveValue("http://localhost:4566");
    await expect($(T("conn-region"))).toHaveValue("ap-northeast-1");

    await setValueT("conn-name", "r1-conn");
    await setValueT("conn-endpoint", E2E_ENDPOINT);
    await clickT("save-connection");

    await waitDisplayed(T("connection-row"));
    expect(await connectionRowExists("r1-conn")).toBe(true);
  });

  it("R1: edits an existing connection's name", async () => {
    await gotoConnections();
    await editConnectionByName("r1-conn");
    await setValueT("conn-name", "r1-renamed");
    await clickT("save-connection");
    await browser.waitUntil(async () => await connectionRowExists("r1-renamed"), {
      timeout: 10000,
      timeoutMsg: "renamed connection did not appear",
    });
    expect(await connectionRowExists("r1-conn")).toBe(false);
  });

  it("R1: deletes a connection (with confirmation)", async () => {
    await gotoConnections();
    await deleteConnectionByName("r1-renamed");
    expect(await connectionRowExists("r1-renamed")).toBe(false);
    await expect($(T("connection-row"))).not.toBeExisting();
  });

  // R2 — scan for local endpoints and add one from the results. The emulator is
  // published on a port in the auto-detect candidate list (4566/8000/4567).
  it("R2: detects the running emulator via スキャン and adds it", async () => {
    await gotoConnections();
    await clickT("scan-connections");

    // Detected rows appear; find the exact row for our endpoint (match the
    // endpoint span precisely so we don't grab the outer wrapper / another row).
    const addBtn = $(
      `//div[span[normalize-space()="${E2E_ENDPOINT}"]]//button[@data-testid="detect-add"]`,
    );
    await addBtn.waitForDisplayed({ timeout: 30000 });
    await addBtn.click();

    // The add form opens pre-filled from the detected endpoint; name it and save.
    await setValueT("conn-name", "r2-detected");
    await expect($(T("conn-endpoint"))).toHaveValue(E2E_ENDPOINT);
    await clickT("save-connection");

    await browser.waitUntil(async () => await connectionRowExists("r2-detected"), {
      timeout: 10000,
      timeoutMsg: "detected connection was not added",
    });
    expect(await connectionRowText("r2-detected")).toContain(E2E_ENDPOINT);
  });

  // R3 — switch connection: "この接続を使う" -> home; header selector switches;
  // the active connection color is reflected in the header.
  it("R3: switches connection via use-button and header selector, reflecting color", async () => {
    await registerConnection({ name: "r3-red", endpoint: E2E_ENDPOINT, region: "ap-northeast-1" });
    // Give it a distinctive color through the edit form.
    await editConnectionByName("r3-red");
    await setValueT("conn-color", "#ff0000");
    await clickT("save-connection");
    await gotoConnections();
    await registerConnection({ name: "r3-blue", endpoint: E2E_ENDPOINT, region: "ap-northeast-1" });

    // Use r3-red -> lands on Home, header reflects its color.
    await useConnectionByName("r3-red");
    await waitDisplayed(T("home-heading"));
    await expect($("b=r3-red")).toBeExisting();
    const dot = await waitDisplayed(T("header-conn-color"));
    const color = await dot.getCSSProperty("background-color");
    expect(color.parsed.hex).toBe("#ff0000");

    // Switch to r3-blue via the header connection selector.
    await switchConnectionByName("r3-blue");
    await browser.waitUntil(
      async () => (await $(T("header-conn-select")).getText()).includes("r3-blue"),
      { timeout: 10000, timeoutMsg: "header selector did not switch to r3-blue" },
    );
  });

  // R13 — unreachable endpoint surfaces a connection error banner with retry.
  it("R13: shows an error banner with retry for an unreachable endpoint", async () => {
    await setupActiveConnection({
      name: "r13-dead",
      endpoint: "http://localhost:59999",
      region: "ap-northeast-1",
    });
    await gotoTables();

    const banner = await waitDisplayed(T("error-banner"), 30000);
    await expect(banner).toBeDisplayed();
    const retry = await waitDisplayed(T("error-retry"));
    await retry.click();
    // Still unreachable: the banner remains after retrying.
    await expect($(T("error-banner"))).toBeDisplayed();
  });

  // R17 — header region selector changes the active connection's region,
  // persists it to the profile, and refetches the table list for the new region.
  it("R17: changes region from the header, persists it, and refetches tables", async () => {
    // Seed a table that lives in us-east-1 (used to prove the refetch targets
    // the new region).
    await createTable(
      { tableName: "r17_useast", pk: { name: "id", type: "S" } },
      makeClient(E2E_ENDPOINT, "us-east-1"),
    );

    await setupActiveConnection({
      name: "r17-conn",
      endpoint: E2E_ENDPOINT,
      region: "ap-northeast-1",
    });
    await gotoTables();

    // Switch region in the header; the list refetches for us-east-1 and shows
    // the us-east-1 table.
    await changeRegionViaHeader("us-east-1");
    await waitForTableRow("r17_useast", 30000);

    // Persistence: the profile now records the new region.
    await gotoConnections();
    expect(await connectionRowText("r17-conn")).toContain("us-east-1");
  });
});
