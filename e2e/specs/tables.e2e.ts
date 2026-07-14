import { $, browser, expect } from "@wdio/globals";
import {
  E2E_ENDPOINT,
  T,
  clickT,
  createTableViaUI,
  deleteTableFromList,
  deleteTableViaDetail,
  gotoTables,
  openIndexesTab,
  openTableDetail,
  setupActiveConnection,
  tableIndexCountText,
  tableRowText,
  waitDisplayed,
  waitForTableActive,
  waitForTableRow,
} from "../helpers/app";
import { createTable, deleteTable, makeClient } from "../helpers/emulator";

// ministack does not implement Global Secondary Indexes; set E2E_NO_GSI=1 to
// skip the GSI-specific assertions there (documented in SPEC-COVERAGE.md).
const NO_GSI = process.env.E2E_NO_GSI === "1";
const gsiIt = NO_GSI ? it.skip : it;

/**
 * Table requirements:
 *   R4  table list (name / status / PK / SK / index count)
 *   R5  create table (PK only / PK+SK / with GSI)
 *   R6  delete table (name-confirmation, selection-delete from list)
 *   R15 table detail: overview tab + indexes tab (GSI/LSI)
 *   R16 "テーブルの項目を探索" button -> explore screen with ?table=
 */
describe("tables", () => {
  const client = makeClient(E2E_ENDPOINT);

  before(async () => {
    // Clean any leftovers from previous runs of the UI-created table names.
    for (const name of ["r5_pk", "r5_pksk", "r5_gsi", "r6_list", "r6_detail"]) {
      await deleteTable(name, client);
    }
    // Seed read-only fixtures.
    await createTable(
      {
        tableName: "r4_table",
        pk: { name: "id", type: "S" },
        sk: { name: "sk", type: "S" },
        gsis: NO_GSI ? [] : [{ name: "gsi1", pk: { name: "gpk", type: "S" } }],
      },
      client,
    );
    await createTable(
      {
        tableName: "r15_table",
        pk: { name: "id", type: "S" },
        sk: { name: "sk", type: "N" },
        gsis: NO_GSI ? [] : [{ name: "byStatus", pk: { name: "status", type: "S" } }],
      },
      client,
    );
    await createTable({ tableName: "r16_table", pk: { name: "id", type: "S" } }, client);

    await setupActiveConnection({
      name: "tbl-conn",
      endpoint: E2E_ENDPOINT,
      region: "ap-northeast-1",
    });
  });

  // R4 — list shows name, status, PK/SK and index count.
  it("R4: lists tables with name, status, keys and index count", async () => {
    await gotoTables();
    await waitForTableRow("r4_table");
    await waitForTableActive("r4_table");
    const text = await tableRowText("r4_table");
    expect(text).toContain("r4_table");
    expect(text).toContain("アクティブ");
    expect(text).toContain("id"); // partition key
    expect(text).toContain("sk"); // sort key
    // Index-count cell specifically (not just anywhere in the row): 1 GSI, or 0
    // when GSIs are unsupported.
    expect((await tableIndexCountText("r4_table")).trim()).toBe(NO_GSI ? "0" : "1");
  });

  // R5 — create PK-only.
  it("R5: creates a table with a partition key only", async () => {
    await gotoTables();
    await createTableViaUI({ name: "r5_pk", pk: { name: "id", type: "S" } });
    await waitForTableRow("r5_pk");
  });

  // R5 — create PK + SK.
  it("R5: creates a table with partition and sort keys", async () => {
    await gotoTables();
    await createTableViaUI({
      name: "r5_pksk",
      pk: { name: "pk", type: "S" },
      sk: { name: "sk", type: "N" },
    });
    await waitForTableRow("r5_pksk");
    await openTableDetail("r5_pksk");
    expect(await $(T("td-pk")).getText()).toContain("pk");
    expect(await $(T("td-sk")).getText()).toContain("sk");
  });

  // R5 — create with a GSI (skipped on emulators without GSI support).
  gsiIt("R5: creates a table with a GSI", async () => {
    await gotoTables();
    await createTableViaUI({
      name: "r5_gsi",
      pk: { name: "id", type: "S" },
      gsi: { name: "gsi1", pk: { name: "gpk", type: "S" } },
    });
    await waitForTableRow("r5_gsi");
    await openTableDetail("r5_gsi");
    await openIndexesTab();
    await expect($(T("index-name-gsi1"))).toBeExisting();
  });

  // R6 — delete from list via the name-confirmation modal (formerly window.prompt).
  it("R6: deletes a table from the list (name confirmation)", async () => {
    await gotoTables();
    await createTableViaUI({ name: "r6_list", pk: { name: "id", type: "S" } });
    await waitForTableRow("r6_list");
    await deleteTableFromList("r6_list");
    await expect($(T("table-link-r6_list"))).not.toBeExisting();
  });

  // R6 — delete from the detail page via the name-confirmation modal.
  it("R6: deletes a table from its detail page (name confirmation modal)", async () => {
    await gotoTables();
    await createTableViaUI({ name: "r6_detail", pk: { name: "id", type: "S" } });
    await openTableDetail("r6_detail");
    await deleteTableViaDetail("r6_detail");
    await expect($(T("table-link-r6_detail"))).not.toBeExisting();
  });

  // R15 — table detail: overview tab.
  it("R15: shows the overview tab (PK/SK, capacity, status, item count)", async () => {
    await gotoTables();
    await openTableDetail("r15_table");
    expect(await $(T("td-pk")).getText()).toContain("id");
    expect(await $(T("td-sk")).getText()).toContain("sk");
    await expect($(T("td-capacity"))).toHaveText("オンデマンド");
    expect(await $(T("td-status")).getText()).toContain("アクティブ");
    await expect($(T("td-item-count"))).toBeExisting();
  });

  // R15 — table detail: indexes tab (GSI/LSI).
  it("R15: shows the indexes tab with GSI/LSI sections", async () => {
    await gotoTables();
    await openTableDetail("r15_table");
    await openIndexesTab();
    const indexes = await waitDisplayed(T("td-indexes"));
    const text = await indexes.getText();
    // Both GSI and LSI sections render (LSI is empty here).
    expect(text).toContain("グローバルセカンダリインデックス");
    expect(text).toContain("ローカルセカンダリインデックス");
    if (!NO_GSI) {
      await expect($(T("index-name-byStatus"))).toBeExisting();
    }
  });

  // R16 — explore button navigates to the explore screen with ?table=.
  it("R16: opens the item explorer with ?table= for the table", async () => {
    await gotoTables();
    await openTableDetail("r16_table");
    await clickT("td-explore");
    await waitDisplayed(T("explore-table-select"));
    const hash = await browser.execute(() => window.location.hash);
    expect(hash).toContain("explore");
    expect(hash).toContain("table=r16_table");
    await expect($(T("explore-table-select"))).toHaveValue("r16_table");
  });
});
