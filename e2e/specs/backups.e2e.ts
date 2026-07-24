import { $, browser, expect } from "@wdio/globals";
import {
  E2E_ENDPOINT,
  T,
  clickT,
  gotoBackups,
  setSelectValue,
  setValueT,
  setupActiveConnection,
  stubDialogs,
  assertDialogShown,
  waitDisplayed,
} from "../helpers/app";
import {
  createTable,
  deleteTable,
  getItem,
  makeClient,
  putItems,
  tableExists,
} from "../helpers/emulator";
import { expectCovered, gate, supports } from "../helpers/capabilities";

const S = (v: string) => ({ S: v });

/** Row for the backup whose name matches (name is the first cell). */
const backupRow = (name: string) =>
  `//tr[@data-testid="backup-row"][.//td[normalize-space()="${name}"]]`;

/**
 * Backup requirements (capability-adaptive — the suite is green on every emulator):
 *   R20 supported emulators (ministack): create backup via the UI modal, the row
 *       appears, restore to a new table (verified via SDK), delete with confirm.
 *   R21 unsupported emulators (localstack:3 / floci / dynamodb-local): the
 *       backups screen shows the `backups-unsupported` banner and the create
 *       button is absent.
 *
 * Which branch runs is decided by the `dynamodb.backups` capability probe
 * (see helpers/capabilities.ts); the other branch's tests self-skip and the
 * `after` coverage guard asserts one of the two actually ran.
 */
describe("backups", () => {
  const client = makeClient(E2E_ENDPOINT);
  let supported = false;

  // Unique names so leftover state from a prior run never collides.
  const stamp = Date.now();
  const srcTable = "bk_src";
  const backupName = `bk-e2e-${stamp}`;
  const restoredTable = `bk_restored_${stamp}`;

  before(async () => {
    supported = await supports("dynamodb.backups");

    await setupActiveConnection({
      name: "backups-conn",
      endpoint: E2E_ENDPOINT,
      region: "ap-northeast-1",
    });

    if (supported) {
      await createTable({ tableName: srcTable, pk: { name: "id", type: "S" } }, client);
      await putItems(srcTable, [{ id: S("seed1"), note: S("hello") }], client);
    }
  });

  after(async () => {
    if (supported) {
      await deleteTable(srcTable, client);
      await deleteTable(restoredTable, client);
    }
    expectCovered("R20-R21");
  });

  describe("supported emulator (R20)", () => {
    it("R20: creates a backup, restores it to a new table, then deletes it", async function () {
      await gate(this, "R20-R21", { on: ["dynamodb.backups"] });
      await gotoBackups();

      // --- create -------------------------------------------------------------
      await clickT("backups-create");
      await waitDisplayed(T("backup-create-table"));
      await setSelectValue("backup-create-table", srcTable);
      await setValueT("backup-create-name", backupName);
      await clickT("backup-create-submit");
      // The row for the just-created backup appears.
      await waitDisplayed(backupRow(backupName));

      // --- restore ------------------------------------------------------------
      await $(backupRow(backupName)).$(T("backup-restore")).click();
      await waitDisplayed(T("backup-restore-target"));
      await setValueT("backup-restore-target", restoredTable);
      await clickT("backup-restore-submit");
      await waitDisplayed(T("backups-note"));

      // Verify the restore really produced a table with the seeded item.
      await browser.waitUntil(async () => tableExists(restoredTable, client), {
        timeout: 60000,
        interval: 1000,
        timeoutMsg: `restored table ${restoredTable} never appeared`,
      });
      await browser.waitUntil(
        async () => {
          const item = await getItem(restoredTable, { id: S("seed1") }, client);
          return item?.note?.S === "hello";
        },
        { timeout: 60000, interval: 1000, timeoutMsg: "restored table missing the seeded item" },
      );

      // --- delete -------------------------------------------------------------
      await gotoBackups();
      await waitDisplayed(backupRow(backupName));
      await stubDialogs();
      await $(backupRow(backupName)).$(T("backup-delete")).click();
      await assertDialogShown("confirm", backupName);
      await browser.waitUntil(async () => !(await $(backupRow(backupName)).isExisting()), {
        timeout: 20000,
        timeoutMsg: `backup row ${backupName} was not removed after delete`,
      });
    });
  });

  describe("unsupported emulator (R21)", () => {
    it("R21: shows the unsupported banner and hides the create button", async function () {
      await gate(this, "R20-R21", { off: ["dynamodb.backups"] });
      await gotoBackups();
      await waitDisplayed(T("backups-unsupported"));
      await expect($(T("backups-unsupported"))).toBeDisplayed();
      // The raw emulator error is surfaced too (non-empty banner text).
      expect((await $(T("backups-unsupported")).getText()).length).toBeGreaterThan(10);
      // The create action is not offered on an unsupported emulator.
      await expect($(T("backups-create"))).not.toBeExisting();
    });
  });
});
