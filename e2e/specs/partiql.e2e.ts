import { $, browser, expect } from "@wdio/globals";
import {
  E2E_ENDPOINT,
  T,
  clickT,
  countByTestId,
  gotoPartiql,
  setSelectValue,
  setValueT,
  setupActiveConnection,
  waitDisplayed,
  waitForNotLoading,
} from "../helpers/app";
import { createTable, deleteTable, getItem, makeClient, putItems } from "../helpers/emulator";

const S = (v: string) => ({ S: v });

/** Wait until exactly `expected` partiql-row rows are rendered. */
async function waitForPartiqlRows(expected: number, timeout = 20000): Promise<void> {
  let last = -1;
  await browser.waitUntil(
    async () => {
      last = await countByTestId("partiql-row");
      return last === expected;
    },
    { timeout, timeoutMsg: `expected ${expected} partiql rows, last saw ${last}` },
  );
}

/**
 * PartiQL requirement:
 *   R19 template select fills SELECT * FROM "<table>"; SELECT renders rows;
 *       INSERT then SELECT shows the inserted item (write path); an invalid
 *       statement shows the error banner.
 */
describe("partiql", () => {
  const client = makeClient(E2E_ENDPOINT);

  before(async () => {
    // A seeded table with two rows for SELECT, plus room for an INSERT.
    await createTable({ tableName: "pq_tbl", pk: { name: "id", type: "S" } }, client);
    await putItems(
      "pq_tbl",
      [
        { id: S("seed-1"), name: S("alpha") },
        { id: S("seed-2"), name: S("beta") },
      ],
      client,
    );

    await setupActiveConnection({
      name: "partiql-conn",
      endpoint: E2E_ENDPOINT,
      region: "ap-northeast-1",
    });
  });

  after(async () => {
    await deleteTable("pq_tbl", client);
  });

  // R19 — the template selector fills the statement box.
  it("R19: template selector fills SELECT * FROM \"<table>\"", async () => {
    await gotoPartiql();
    await setSelectValue("partiql-template-select", "pq_tbl");
    await expect($(T("partiql-statement"))).toHaveValue('SELECT * FROM "pq_tbl"');
  });

  // R19 — running a SELECT renders the seeded rows.
  it("R19: runs a SELECT and renders the seeded rows", async () => {
    await gotoPartiql();
    await setValueT("partiql-statement", 'SELECT * FROM "pq_tbl"');
    await clickT("partiql-run");
    await waitDisplayed(T("partiql-results"));
    await waitForPartiqlRows(2);
    const text = await $(T("partiql-results")).getText();
    expect(text).toContain("seed-1");
    expect(text).toContain("seed-2");
  });

  // R19 — an INSERT statement writes, then a SELECT shows the inserted item.
  it("R19: INSERT then SELECT shows the inserted item (write path)", async () => {
    await gotoPartiql();
    await setValueT(
      "partiql-statement",
      `INSERT INTO "pq_tbl" VALUE {'id':'inserted-1','name':'gamma'}`,
    );
    await clickT("partiql-run");
    // A write statement returns no rows -> the success message appears.
    await waitDisplayed(T("partiql-success"));

    // Confirm the write really landed (independent of the UI).
    const stored = await getItem("pq_tbl", { id: S("inserted-1") }, client);
    expect(stored?.name).toEqual(S("gamma"));

    // And the UI SELECT surfaces it.
    await setValueT("partiql-statement", 'SELECT * FROM "pq_tbl"');
    await clickT("partiql-run");
    await waitDisplayed(T("partiql-results"));
    await browser.waitUntil(
      async () => (await $(T("partiql-results")).getText()).includes("inserted-1"),
      { timeout: 20000, timeoutMsg: "inserted item did not appear in SELECT results" },
    );
  });

  // R19 — an invalid statement surfaces the error banner.
  it("R19: an invalid statement shows the error banner", async () => {
    await gotoPartiql();
    await setValueT("partiql-statement", "THIS IS NOT VALID PARTIQL");
    await clickT("partiql-run");
    await waitForNotLoading();
    await waitDisplayed(T("error-banner"));
    await expect($(T("error-banner"))).toBeDisplayed();
  });
});
