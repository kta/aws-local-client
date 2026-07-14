import { $, browser, expect } from "@wdio/globals";
import {
  E2E_ENDPOINT,
  T,
  clickT,
  countByTestId,
  gotoDashboard,
  setupActiveConnection,
  waitDisplayed,
} from "../helpers/app";
import { createTable, deleteTable, makeClient, putItems } from "../helpers/emulator";

const S = (v: string) => ({ S: v });

/**
 * Dashboard requirement:
 *   R18 dashboard summary (table count / total items) reflecting the SDK-seeded
 *       state; table-row click -> detail; "テーブルを作成" quick action lands on
 *       /dynamodb/tables with the create modal open; sidebar nav-dashboard reaches it.
 */
describe("dashboard", () => {
  const client = makeClient(E2E_ENDPOINT);

  before(async () => {
    // Two seeded tables with known item counts. The dashboard lists every table
    // on the emulator, so assertions target these specific rows + internal
    // consistency (summary count == rendered rows) rather than absolute totals.
    await createTable({ tableName: "dash_a", pk: { name: "id", type: "S" } }, client);
    await putItems("dash_a", [{ id: S("1") }, { id: S("2") }, { id: S("3") }], client);
    await createTable({ tableName: "dash_b", pk: { name: "id", type: "S" } }, client);
    await putItems("dash_b", [{ id: S("1") }, { id: S("2") }], client);

    await setupActiveConnection({
      name: "dash-conn",
      endpoint: E2E_ENDPOINT,
      region: "ap-northeast-1",
    });
  });

  after(async () => {
    await deleteTable("dash_a", client);
    await deleteTable("dash_b", client);
  });

  // R18 — summary reflects the seeded state and both seeded rows are listed.
  it("R18: shows a summary matching the SDK-seeded state", async () => {
    await gotoDashboard();
    await waitDisplayed(T("dashboard-summary"));

    // Both seeded tables appear as rows.
    await waitDisplayed('//tr[@data-testid="dashboard-table-row"][.//td[normalize-space()="dash_a"]]');
    await expect(
      $('//tr[@data-testid="dashboard-table-row"][.//td[normalize-space()="dash_b"]]'),
    ).toBeExisting();

    // Summary "テーブル数" equals the number of rendered rows (internal
    // consistency with the SDK state), and is at least our two seeded tables.
    const summaryText = await $(T("dashboard-summary")).getText();
    const tableCount = Number(summaryText.match(/テーブル数\s*(\d[\d,]*)/)?.[1]?.replace(/,/g, ""));
    const rowCount = await countByTestId("dashboard-table-row");
    expect(tableCount).toBe(rowCount);
    expect(tableCount).toBeGreaterThanOrEqual(2);
    // A total-items figure is rendered.
    expect(summaryText).toContain("合計アイテム数");
  });

  // R18 — clicking a table row navigates to that table's detail page.
  it("R18: navigates to table detail when a row is clicked", async () => {
    await gotoDashboard();
    const row = await waitDisplayed(
      '//tr[@data-testid="dashboard-table-row"][.//td[normalize-space()="dash_a"]]',
    );
    await row.click();
    await waitDisplayed(T("td-tab-overview"));
    const hash = await browser.execute(() => window.location.hash);
    expect(hash).toContain("/dynamodb/tables/dash_a");
  });

  // R18 — "テーブルを作成" quick action opens the create modal on the tables page.
  it("R18: 'テーブルを作成' quick action opens the create modal on the tables page", async () => {
    await gotoDashboard();
    await clickT("dashboard-create-table");
    await waitDisplayed(T("tables-heading"));
    await waitDisplayed(T("ct-name"));
    const hash = await browser.execute(() => window.location.hash);
    expect(hash).toContain("/dynamodb/tables");
  });

  // R18 — the sidebar "ダッシュボード" link reaches the dashboard.
  it("R18: sidebar nav-dashboard reaches the dashboard", async () => {
    // Start elsewhere so the nav click is what performs the navigation.
    await browser.execute(() => {
      window.location.hash = "#/dynamodb/tables";
    });
    await waitDisplayed(T("nav-dashboard"));
    await clickT("nav-dashboard");
    await waitDisplayed(T("dashboard-heading"));
    const hash = await browser.execute(() => window.location.hash);
    expect(hash).toContain("/dynamodb");
  });
});
