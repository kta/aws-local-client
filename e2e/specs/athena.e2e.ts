import {
  BatchGetNamedQueryCommand,
  CreateWorkGroupCommand,
  DeleteWorkGroupCommand,
  ListNamedQueriesCommand,
  ListWorkGroupsCommand,
} from "@aws-sdk/client-athena";
import { CreateBucketCommand } from "@aws-sdk/client-s3";
import { $, browser, expect } from "@wdio/globals";
import {
  T,
  clickT,
  countByTestId,
  gotoAthenaEditor,
  gotoAthenaSavedQueries,
  gotoAthenaWorkgroups,
  setValueT,
  setupActiveConnection,
  waitDisplayed,
  waitForNotLoading,
} from "../helpers/app";
import { E2E_ENDPOINT, makeAthenaClient, makeS3Client } from "../helpers/aws";
import { expectCovered, gate } from "../helpers/capabilities";

/**
 * Athena requirements (R89-R91), gated per capability (see helpers/capabilities.ts):
 *   - athena.query      (localstack:3 CE = Pro-only → unsupported)
 *   - athena.workgroups (kumo → InvalidAction → unsupported)
 *   - athena.namedQueries (ministack-only among the four emulators)
 *
 * Each family has a supported- and an unsupported-side test, and the `after`
 * coverage guard fails when a capability combination would leave a family
 * unverified. Verification is two-sided: seed/verify via the Athena SDK, drive
 * the UI, and cross-check the side effect through the SDK.
 */
describe("athena", () => {
  const athena = makeAthenaClient(E2E_ENDPOINT);
  const stamp = Date.now();

  before(async () => {
    // The app always writes query results to s3://nlsd-athena-results/; ministack
    // fails the execution unless the bucket exists. Create it best-effort so the
    // query test can render real result rows.
    await makeS3Client(E2E_ENDPOINT)
      .send(new CreateBucketCommand({ Bucket: "nlsd-athena-results" }))
      .catch(() => {});

    await setupActiveConnection({
      name: "athena-conn",
      endpoint: E2E_ENDPOINT,
      region: "ap-northeast-1",
    });
  });

  after(async () => {
    expectCovered("R89");
    expectCovered("R90");
    expectCovered("R91");
  });

  // --- R89: query editor -----------------------------------------------------

  describe("query editor (R89)", () => {
    it("R89: runs SELECT 1 and renders at least one result row", async function () {
      await gate(this, "R89", { on: ["athena.query"] });
      await gotoAthenaEditor();
      await setValueT("athena-statement", "SELECT 1");
      await clickT("athena-run");

      // Poll → results table. Values are emulator-dependent (mock on ministack,
      // real "1" on floci), so only assert the row count, not the values.
      await waitDisplayed(T("athena-results"));
      await browser.waitUntil(async () => (await countByTestId("athena-row")) >= 1, {
        timeout: 30000,
        interval: 500,
        timeoutMsg: "SELECT 1 produced no result rows",
      });
    });

    it("R89: a SELECT on an Athena-less emulator shows the unsupported banner", async function () {
      await gate(this, "R89", { off: ["athena.query"] });
      await gotoAthenaEditor();
      await setValueT("athena-statement", "SELECT 1");
      await clickT("athena-run");
      await waitForNotLoading();
      await waitDisplayed(T("athena-unsupported"));
    });
  });

  // --- R90: workgroups CRUD --------------------------------------------------

  describe("workgroups (R90)", () => {
    it("R90: creates and deletes a workgroup (verified via the SDK)", async function () {
      await gate(this, "R90", { on: ["athena.workgroups"] });
      const name = `nlsd-wg-${stamp}`;

      // Seed one workgroup via the SDK and confirm the UI lists it.
      const seeded = `nlsd-wg-seed-${stamp}`;
      await athena.send(new CreateWorkGroupCommand({ Name: seeded })).catch(() => {});
      await gotoAthenaEditor();
      await gotoAthenaWorkgroups();
      await waitDisplayed(T(`workgroup-row-${seeded}`));

      // Create via the UI.
      await clickT("workgroups-create");
      await setValueT("wg-name", name);
      await setValueT("wg-desc", "e2e");
      await clickT("wg-save");
      await waitDisplayed(T(`workgroup-row-${name}`));

      // Cross-check the create landed in the emulator.
      const listed = await athena.send(new ListWorkGroupsCommand({}));
      expect((listed.WorkGroups ?? []).some((w) => w.Name === name)).toBe(true);

      // Delete via the row action (name-confirmation modal).
      await clickT(`workgroup-delete-${name}`);
      await setValueT("workgroups-delete-input", name);
      await clickT("workgroups-delete-confirm");
      await browser.waitUntil(
        async () => !(await $(T(`workgroup-row-${name}`)).isExisting()),
        { timeout: 20000, timeoutMsg: `workgroup ${name} was not removed` },
      );

      // Cleanup the seeded workgroup.
      await athena.send(new DeleteWorkGroupCommand({ WorkGroup: seeded })).catch(() => {});
    });

    it("R90: shows the unsupported banner on a workgroup-less emulator", async function () {
      await gate(this, "R90", { off: ["athena.workgroups"] });
      await gotoAthenaEditor();
      await gotoAthenaWorkgroups();
      await waitDisplayed(T("athena-unsupported"));
    });
  });

  // --- R91: saved (named) queries --------------------------------------------

  describe("saved queries (R91)", () => {
    it("R91: saves from the editor, recalls into the editor, and deletes", async function () {
      await gate(this, "R91", { on: ["athena.namedQueries"] });
      const name = `nlsd-nq-${stamp}`;
      const statement = `SELECT ${stamp}`;

      // Save a named query from the editor.
      await gotoAthenaEditor();
      await setValueT("athena-statement", statement);
      await clickT("athena-save");
      await setValueT("athena-save-name", name);
      await setValueT("athena-save-db", "default");
      await clickT("athena-save-confirm");

      // Cross-check the save via the SDK.
      await browser.waitUntil(
        async () => {
          const ids = (await athena.send(new ListNamedQueriesCommand({}))).NamedQueryIds ?? [];
          if (ids.length === 0) return false;
          const got = await athena.send(new BatchGetNamedQueryCommand({ NamedQueryIds: ids }));
          return (got.NamedQueries ?? []).some((q) => q.Name === name);
        },
        { timeout: 20000, timeoutMsg: `named query ${name} never appeared in the emulator` },
      );

      // The saved-queries list shows it.
      await gotoAthenaSavedQueries();
      await waitDisplayed(T(`saved-query-row-${name}`));

      // Recall it into the editor.
      await clickT(`saved-query-insert-${name}`);
      await waitDisplayed(T("athena-statement"));
      await expect($(T("athena-statement"))).toHaveValue(statement);

      // Delete via the saved-queries row action.
      await gotoAthenaEditor();
      await gotoAthenaSavedQueries();
      await clickT(`saved-query-delete-${name}`);
      await setValueT("saved-queries-delete-input", name);
      await clickT("saved-queries-delete-confirm");
      await browser.waitUntil(
        async () => !(await $(T(`saved-query-row-${name}`)).isExisting()),
        { timeout: 20000, timeoutMsg: `saved query ${name} was not removed` },
      );
    });

    it("R91: shows the unsupported banner on a named-query-less emulator", async function () {
      await gate(this, "R91", { off: ["athena.namedQueries"] });
      await gotoAthenaEditor();
      await gotoAthenaSavedQueries();
      await waitDisplayed(T("athena-unsupported"));
    });
  });
});
