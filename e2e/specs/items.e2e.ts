import { $, expect } from "@wdio/globals";
import {
  E2E_ENDPOINT,
  T,
  clickT,
  createItem,
  currentPageNumber,
  deleteRowByPk,
  explorePkTexts,
  gotoExplore,
  itemRowExists,
  openItemByPk,
  runQuery,
  runScan,
  setValueT,
  setupActiveConnection,
  waitForModalClosed,
  waitForRowCount,
} from "../helpers/app";
import { createTable, deleteTable, makeClient, putItems, seedItems } from "../helpers/emulator";

// ministack does not implement GSIs; skip the GSI query with E2E_NO_GSI=1.
const NO_GSI = process.env.E2E_NO_GSI === "1";
const gsiIt = NO_GSI ? it.skip : it;

const S = (v: string) => ({ S: v });

/**
 * Item requirements:
 *   R7  scan (no filter / attribute filter = / contains)
 *   R8  query (PK / SK begins_with / SK = / GSI)
 *   R9  pagination (>50 items: next/prev, page number)
 *   R10 create item (plain JSON editor)
 *   R11 edit item (plain <-> DynamoDB JSON toggle, save)
 *   R12 delete item (checkbox select -> action -> delete, confirmation)
 */
describe("items", () => {
  const client = makeClient(E2E_ENDPOINT);

  before(async () => {
    // R7 fixture: three items with a filterable "name" attribute.
    await createTable({ tableName: "it_scan", pk: { name: "id", type: "S" } }, client);
    await putItems(
      "it_scan",
      [
        { id: S("1"), name: S("apple") },
        { id: S("2"), name: S("apricot") },
        { id: S("3"), name: S("banana") },
      ],
      client,
    );

    // R8 fixture: composite key + a GSI.
    await createTable(
      {
        tableName: "it_query",
        pk: { name: "pk", type: "S" },
        sk: { name: "sk", type: "S" },
        gsis: NO_GSI ? [] : [{ name: "gsi1", pk: { name: "gpk", type: "S" } }],
      },
      client,
    );
    await putItems(
      "it_query",
      [
        { pk: S("user#1"), sk: S("order#1"), gpk: S("active") },
        { pk: S("user#1"), sk: S("order#2"), gpk: S("active") },
        { pk: S("user#1"), sk: S("profile"), gpk: S("inactive") },
        { pk: S("user#2"), sk: S("order#1"), gpk: S("active") },
      ],
      client,
    );

    // R9 fixture: 55 items to force pagination (page size 50).
    await seedItems(
      { tableName: "it_page", pk: { name: "id", type: "S" } },
      55,
      (i) => ({ id: S(`item-${String(i).padStart(3, "0")}`) }),
      client,
    );

    // R10/R11/R12 fixture: one seeded item; R10 adds another via the UI.
    await createTable({ tableName: "it_crud", pk: { name: "id", type: "S" } }, client);
    await deleteTable("it_crud", client); // ensure empty
    await createTable({ tableName: "it_crud", pk: { name: "id", type: "S" } }, client);
    await putItems("it_crud", [{ id: S("seed1"), note: S("hello") }], client);

    await setupActiveConnection({
      name: "items-conn",
      endpoint: E2E_ENDPOINT,
      region: "ap-northeast-1",
    });
  });

  // R7 — scan with no filter.
  it("R7: scans a table with no filter", async () => {
    await gotoExplore("it_scan");
    await runScan();
    await waitForRowCount(3);
  });

  // R7 — scan with an equality attribute filter.
  it("R7: scans with an attribute filter (=)", async () => {
    await gotoExplore("it_scan");
    await runScan({ attr: "name", op: "eq", value: "apple" });
    await waitForRowCount(1);
    expect(await itemRowExists("1")).toBe(true);
  });

  // R7 — scan with a contains attribute filter.
  it("R7: scans with an attribute filter (contains)", async () => {
    await gotoExplore("it_scan");
    await runScan({ attr: "name", op: "contains", value: "ap" });
    await waitForRowCount(2); // apple + apricot
  });

  // R8 — query by partition key only.
  it("R8: queries by partition key", async () => {
    await gotoExplore("it_query");
    await runQuery({ pkValue: "user#1" });
    await waitForRowCount(3);
  });

  // R8 — query with SK begins_with.
  it("R8: queries with sort key begins_with", async () => {
    await gotoExplore("it_query");
    await runQuery({ pkValue: "user#1", sk: { op: "begins_with", value: "order#" } });
    await waitForRowCount(2);
  });

  // R8 — query with SK equals.
  it("R8: queries with sort key =", async () => {
    await gotoExplore("it_query");
    await runQuery({ pkValue: "user#1", sk: { op: "eq", value: "profile" } });
    await waitForRowCount(1);
  });

  // R8 — query against a GSI (skipped where GSIs are unsupported).
  gsiIt("R8: queries against a GSI", async () => {
    await gotoExplore("it_query");
    await runQuery({ pkValue: "active", index: "gsi1" });
    await waitForRowCount(3);
  });

  // R9 — pagination across >50 items.
  it("R9: paginates forward and back across 50+ items", async () => {
    await gotoExplore("it_page");
    await runScan();
    await waitForRowCount(50);
    expect(await currentPageNumber()).toBe(1);
    const page1Pks = await explorePkTexts();
    expect(page1Pks).toHaveLength(50);

    await clickT("explore-next");
    await waitForRowCount(5); // 55 - 50
    expect(await currentPageNumber()).toBe(2);
    // Page 2 must be genuinely different rows (the 55-item seed is deterministic
    // and scan pagination uses ExclusiveStartKey), not a re-render of page 1:
    // every page-2 PK is absent from page 1.
    const page2Pks = await explorePkTexts();
    expect(page2Pks).toHaveLength(5);
    expect(page2Pks.every((pk) => !page1Pks.includes(pk))).toBe(true);

    await clickT("explore-prev");
    await waitForRowCount(50);
    expect(await currentPageNumber()).toBe(1);
  });

  // R10 — create an item via the plain JSON editor.
  it("R10: creates an item with the plain JSON editor", async () => {
    await gotoExplore("it_crud");
    await runScan();
    await createItem('{"id":"created","note":"fresh"}');
    await waitForRowCount(2); // seed1 + created
    expect(await itemRowExists("created")).toBe(true);
  });

  // R11 — edit an item, toggling between plain and DynamoDB JSON.
  it("R11: edits an item and toggles plain <-> DynamoDB JSON", async () => {
    await gotoExplore("it_crud");
    await runScan();
    await openItemByPk("seed1");

    // Plain JSON shows the raw value.
    expect(await $(T("item-json")).getValue()).toContain("hello");

    // Toggle to DynamoDB JSON: the typed representation appears.
    await clickT("item-ddb-toggle");
    expect(await $(T("item-json")).getValue()).toContain('"S"');

    // Edit in DynamoDB JSON and save.
    await setValueT("item-json", '{"id":{"S":"seed1"},"note":{"S":"world"}}');
    await clickT("item-save");
    await waitForModalClosed();

    // Re-open and confirm the change persisted.
    await gotoExplore("it_crud");
    await runScan();
    await openItemByPk("seed1");
    expect(await $(T("item-json")).getValue()).toContain("world");
    // Close the modal so it does not bleed into the next test.
    await clickT("item-cancel");
    await waitForModalClosed();
  });

  // R12 — delete an item via checkbox selection + actions menu (confirmation).
  it("R12: deletes an item via selection and the actions menu", async () => {
    await gotoExplore("it_crud");
    await runScan();
    await deleteRowByPk("seed1");
    expect(await itemRowExists("seed1")).toBe(false);
  });
});
