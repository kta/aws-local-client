import { browser, $, expect } from "@wdio/globals";

/**
 * E2E foundation smoke test (Task P2-3).
 *
 * Verifies the WebdriverIO + Tauri embedded-driver stack works end-to-end on a
 * real, debug-built binary:
 *   (a) the app launches and the 接続管理 (Connections) screen is shown,
 *   (b) a connection can be registered through the UI, and
 *   (c) after switching to it, the DynamoDB table list renders (0+ tables).
 *
 * The emulator endpoint is injected via E2E_ENDPOINT (default the local
 * dynamodb-local on :8000). Connections are registered through the UI because
 * that is how a real user provides an endpoint.
 */
const ENDPOINT = process.env.E2E_ENDPOINT ?? "http://localhost:8000";

describe("smoke: e2e foundation", () => {
  it("(a) launches with the 接続管理 screen visible", async () => {
    const heading = $('[data-testid="connections-heading"]');
    await heading.waitForDisplayed({ timeout: 30000 });
    await expect(heading).toHaveText("接続管理");
  });

  it("(b) registers a connection via the UI and shows the new row", async () => {
    await $('[data-testid="add-connection"]').click();

    const nameInput = $('[data-testid="conn-name"]');
    await nameInput.waitForDisplayed();
    await nameInput.setValue("e2e");

    const endpointInput = $('[data-testid="conn-endpoint"]');
    // Field is pre-filled with the default endpoint; clear then set ours.
    await endpointInput.clearValue();
    await endpointInput.setValue(ENDPOINT);

    await $('[data-testid="save-connection"]').click();

    const row = $('[data-testid="connection-row"]');
    await row.waitForDisplayed({ timeout: 15000 });
    await expect(row).toBeDisplayed();
  });

  it("(c) switches to the connection and renders the DynamoDB table list", async () => {
    await $('[data-testid="use-connection"]').click();

    // Home (service grid) becomes visible after switching connection.
    const home = $('[data-testid="home-heading"]');
    await home.waitForDisplayed({ timeout: 15000 });

    // Navigate into DynamoDB.
    await $('[data-testid="service-dynamodb"]').click();

    // Table list screen renders. Row count is 0+ depending on the emulator.
    const tablesHeading = $('[data-testid="tables-heading"]');
    await tablesHeading.waitForDisplayed({ timeout: 20000 });
    await expect(tablesHeading).toHaveText("テーブル");

    // The count element proves the list finished loading (no crash / error).
    const count = $('[data-testid="tables-count"]');
    await count.waitForDisplayed({ timeout: 20000 });
    const text = await count.getText();
    // Format is "(N)" with N >= 0.
    expect(text).toMatch(/^\(\d+\)$/);
  });
});
