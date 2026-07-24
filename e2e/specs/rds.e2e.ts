import {
  CreateDBInstanceCommand,
  DeleteDBInstanceCommand,
  DescribeDBInstancesCommand,
  type RDSClient,
} from "@aws-sdk/client-rds";
import { $, browser, expect } from "@wdio/globals";
import {
  E2E_ENDPOINT,
  T,
  clickT,
  gotoInstances,
  gotoParameterGroups,
  gotoRdsDashboard,
  gotoSnapshots,
  setValueT,
  setupActiveConnection,
  stubDialogs,
  waitDisplayed,
} from "../helpers/app";
import { makeRdsClient } from "../helpers/aws";
import { expectCovered, expectCoveredIf, gate } from "../helpers/capabilities";

/**
 * RDS requirements (R33-R35, R47-R50), gated per capability (see
 * helpers/capabilities.ts). Emulators implement different subsets of the RDS
 * API — kumo, for instance, supports instance CRUD/stop/start/modify but not
 * reboot, snapshot describe/restore or parameter groups — so every test
 * declares exactly the operations it exercises instead of assuming a
 * whole-family branch. Each family has supported- and unsupported-side tests,
 * and the `after` coverage guard fails when a capability combination would
 * leave a family unverified.
 */
describe("rds", () => {
  const rds: RDSClient = makeRdsClient(E2E_ENDPOINT);
  const stamp = Date.now();

  /** Create an instance via the SDK and wait for its row to say `available`. */
  async function seedInstanceRow(id: string): Promise<string> {
    await rds.send(
      new CreateDBInstanceCommand({
        DBInstanceIdentifier: id,
        Engine: "mysql",
        DBInstanceClass: "db.t3.micro",
        MasterUsername: "admin",
        MasterUserPassword: "password123",
        AllocatedStorage: 20,
      }),
    );
    // navigateHash is a no-op when the hash is unchanged, so a test that is
    // already on the instances page would keep a stale list; bounce through
    // the dashboard to force a remount (and a fresh describe).
    await gotoRdsDashboard();
    await gotoInstances();
    const row = `//tr[.//*[@data-testid="instance-row-${id}"]]`;
    await waitDisplayed(T(`instance-row-${id}`));
    await browser.waitUntil(async () => (await $(row).getText()).includes("available"), {
      timeout: 60000,
      interval: 2000,
      timeoutMsg: `instance ${id} never became available`,
    });
    return row;
  }

  /**
   * Click a row-scoped action, retrying through the unmount/remount each op's
   * list reload causes (slow Windows runners).
   */
  async function clickRowAction(row: string, action: string): Promise<void> {
    await browser.waitUntil(
      async () => {
        try {
          await $(row).$(T(action)).click();
          return true;
        } catch {
          return false;
        }
      },
      { timeout: 20000, timeoutMsg: `${action} never became clickable` },
    );
  }

  before(async () => {
    await setupActiveConnection({
      name: "rds-conn",
      endpoint: E2E_ENDPOINT,
      region: "ap-northeast-1",
    });
  });

  after(async () => {
    expectCovered("R33-R35");
    expectCovered("R47");
    // R48 (instance operations) only applies where the instance list renders.
    await expectCoveredIf("R48", ["rds.instances.describe"]);
    expectCovered("R49");
    expectCovered("R50");
  });

  // --- R33-R35: instance lifecycle vs unsupported/readonly emulators ----------

  describe("instances (R33-R35)", () => {
    it("R33: UI creates an instance that becomes available, then deletes it", async function () {
      await gate(this, "R33-R35", {
        on: ["rds.instances.describe", "rds.instances.create"],
      });
      const id = `rds33-${stamp}`;
      await gotoInstances();
      await clickT("instances-create");
      await setValueT("i-id", id);
      await setValueT("i-username", "admin");
      await setValueT("i-password", "password123");
      await clickT("i-save");

      const row = `//tr[.//*[@data-testid="instance-row-${id}"]]`;
      await waitDisplayed(T(`instance-row-${id}`));
      await browser.waitUntil(async () => (await $(row).getText()).includes("available"), {
        timeout: 60000,
        interval: 2000,
        timeoutMsg: `instance ${id} never became available`,
      });

      // Delete via the row action (identifier-confirmation modal).
      await $(row).$(T("instances-delete")).click();
      await setValueT("instances-delete-input", id);
      await clickT("instances-delete-confirm");
      await browser.waitUntil(async () => !(await $(T(`instance-row-${id}`)).isExisting()), {
        timeout: 60000,
        interval: 2000,
        timeoutMsg: `instance ${id} was not removed`,
      });
    });

    it("R34: shows the unsupported banner and hides the create action", async function () {
      await gate(this, "R33-R35", { off: ["rds.instances.describe"] });
      await gotoInstances();
      await waitDisplayed(T("rds-unsupported"));
      expect((await $(T("rds-unsupported")).getText()).length).toBeGreaterThan(10);
      await expect($(T("instances-create"))).not.toBeExisting();
    });

    it("R35: lists instances and surfaces an error when a create is rejected", async function () {
      await gate(this, "R33-R35", {
        on: ["rds.instances.describe"],
        off: ["rds.instances.create"],
      });
      await gotoInstances();
      // The list renders (create action present, no unsupported banner).
      await waitDisplayed(T("instances-create"));
      await expect($(T("rds-unsupported"))).not.toBeExisting();

      await clickT("instances-create");
      await setValueT("i-id", `rds35-${stamp}`);
      await setValueT("i-username", "admin");
      await setValueT("i-password", "password123");
      await clickT("i-save");
      await waitDisplayed(T("error-banner"));
    });
  });

  // --- R47: dashboard --------------------------------------------------------

  describe("dashboard (R47)", () => {
    it("R47: shows summary cards on a describe-capable emulator", async function () {
      await gate(this, "R47", { on: ["rds.instances.describe"] });
      await gotoRdsDashboard();
      await waitDisplayed(T("rds-dash-instances"));
      await waitDisplayed(T("rds-dash-available"));
      await waitDisplayed(T("rds-dash-snapshots"));
      await waitDisplayed(T("rds-dash-create"));
    });

    it("R47: shows the rds-unsupported banner on an unsupported emulator", async function () {
      await gate(this, "R47", { off: ["rds.instances.describe"] });
      await gotoRdsDashboard();
      await waitDisplayed(T("rds-unsupported"));
      await expect($(T("rds-dash-create"))).not.toBeExisting();
    });
  });

  // --- R48: instance operations ----------------------------------------------
  // stop/start/modify and reboot are gated separately: kumo implements the
  // former but not the latter. An unsupported reboot must surface as a normal
  // error banner (the page never shows the unsupported takeover for row ops).

  describe("instance operations (R48)", () => {
    it("R48: stops and starts an instance", async function () {
      await gate(this, "R48", { on: ["rds.instances.create", "rds.instances.stopStart"] });
      const id = `rds48ss-${stamp}`;
      const row = await seedInstanceRow(id);

      for (const action of ["instance-stop", "instance-start"]) {
        await clickRowAction(row, action);
        await expect($(T("error-banner"))).not.toBeExisting();
      }

      await rds.send(
        new DeleteDBInstanceCommand({ DBInstanceIdentifier: id, SkipFinalSnapshot: true }),
      );
    });

    it("R48: surfaces an error banner when stop/start is unsupported", async function () {
      await gate(this, "R48", {
        on: ["rds.instances.create"],
        off: ["rds.instances.stopStart"],
      });
      const id = `rds48ssu-${stamp}`;
      const row = await seedInstanceRow(id);

      await clickRowAction(row, "instance-stop");
      await waitDisplayed(T("error-banner"));

      await rds.send(
        new DeleteDBInstanceCommand({ DBInstanceIdentifier: id, SkipFinalSnapshot: true }),
      );
    });

    it("R48: modifies an instance", async function () {
      await gate(this, "R48", { on: ["rds.instances.create", "rds.instances.modifyApplies"] });
      const id = `rds48-${stamp}`;
      const row = await seedInstanceRow(id);

      // modify allocated storage 20 -> 30.
      await clickRowAction(row, "instance-modify");
      await setValueT("m-storage", "30");
      await clickT("m-save");
      await browser.waitUntil(
        async () => {
          const out = await rds.send(
            new DescribeDBInstancesCommand({ DBInstanceIdentifier: id }),
          );
          return out.DBInstances?.[0]?.AllocatedStorage === 30;
        },
        { timeout: 60000, interval: 2000, timeoutMsg: `storage of ${id} was not modified` },
      );

      await rds.send(
        new DeleteDBInstanceCommand({ DBInstanceIdentifier: id, SkipFinalSnapshot: true }),
      );
    });

    it("R48: modify round-trips where the change is not applied", async function () {
      // floci accepts ModifyDBInstance without error but never applies the new
      // AllocatedStorage; assert the UI round-trips without an error banner.
      await gate(this, "R48", {
        on: ["rds.instances.create"],
        off: ["rds.instances.modifyApplies"],
      });
      const id = `rds48m-${stamp}`;
      const row = await seedInstanceRow(id);

      await clickRowAction(row, "instance-modify");
      await setValueT("m-storage", "30");
      await clickT("m-save");
      await expect($(T("error-banner"))).not.toBeExisting();

      await rds.send(
        new DeleteDBInstanceCommand({ DBInstanceIdentifier: id, SkipFinalSnapshot: true }),
      );
    });

    it("R48: reboots an instance without an error", async function () {
      await gate(this, "R48", {
        on: ["rds.instances.create", "rds.instances.reboot"],
      });
      const id = `rds48r-${stamp}`;
      const row = await seedInstanceRow(id);

      await clickRowAction(row, "instance-reboot");
      await expect($(T("error-banner"))).not.toBeExisting();

      await rds.send(
        new DeleteDBInstanceCommand({ DBInstanceIdentifier: id, SkipFinalSnapshot: true }),
      );
    });

    it("R48: surfaces an error banner when reboot is unsupported", async function () {
      await gate(this, "R48", {
        on: ["rds.instances.create"],
        off: ["rds.instances.reboot"],
      });
      const id = `rds48u-${stamp}`;
      const row = await seedInstanceRow(id);

      await clickRowAction(row, "instance-reboot");
      await waitDisplayed(T("error-banner"));

      await rds.send(
        new DeleteDBInstanceCommand({ DBInstanceIdentifier: id, SkipFinalSnapshot: true }),
      );
    });

    it("R48: surfaces an error banner when an operation is rejected (read-only)", async function () {
      await gate(this, "R48", {
        on: ["rds.instances.describe"],
        off: ["rds.instances.create"],
      });
      await gotoInstances();
      // The list renders (create action present, no unsupported takeover).
      await waitDisplayed(T("instances-create"));
      await expect($(T("rds-unsupported"))).not.toBeExisting();

      // No instances exist here (create is rejected), so drive the same runOp
      // error surface through a create, which this emulator also rejects.
      await clickT("instances-create");
      await setValueT("i-id", `rds48ro-${stamp}`);
      await setValueT("i-username", "admin");
      await setValueT("i-password", "password123");
      await clickT("i-save");
      await waitDisplayed(T("error-banner"));
    });
  });

  // --- R49: snapshots ----------------------------------------------------------

  describe("snapshots (R49)", () => {
    it("R49: creates, restores and deletes a snapshot", async function () {
      await gate(this, "R49", {
        on: ["rds.snapshots.describe", "rds.instances.create", "rds.snapshots.restore"],
      });
      const srcId = `rds49-src-${stamp}`;
      const snapId = `rds49-snap-${stamp}`;
      const restoredId = `rds49-restored-${stamp}`;
      await rds.send(
        new CreateDBInstanceCommand({
          DBInstanceIdentifier: srcId,
          Engine: "mysql",
          DBInstanceClass: "db.t3.micro",
          MasterUsername: "admin",
          MasterUserPassword: "password123",
          AllocatedStorage: 20,
        }),
      );

      // Create the snapshot via the UI.
      await gotoSnapshots();
      await clickT("snapshots-create");
      await setValueT("snap-id-input", snapId);
      await clickT("snap-save");
      await waitDisplayed(T(`snapshot-row-${snapId}`), 60000);

      // Restore to a new instance via the row action.
      const snapRow = `//tr[.//*[@data-testid="snapshot-row-${snapId}"]]`;
      await browser.waitUntil(async () => (await $(snapRow).getText()).includes("available"), {
        timeout: 60000,
        interval: 2000,
        timeoutMsg: `snapshot ${snapId} never became available`,
      });
      await $(snapRow).$(T("snapshot-restore")).click();
      await setValueT("restore-id-input", restoredId);
      await clickT("restore-save");
      await browser.waitUntil(
        async () => {
          const out = await rds.send(
            new DescribeDBInstancesCommand({ DBInstanceIdentifier: restoredId }),
          );
          return (out.DBInstances?.length ?? 0) > 0;
        },
        { timeout: 60000, interval: 2000, timeoutMsg: `restored instance ${restoredId} not found` },
      );

      // Delete the snapshot via the row action (confirmed via the native dialog).
      await stubDialogs();
      await $(snapRow).$(T("snapshots-delete")).click();
      await browser.waitUntil(async () => !(await $(T(`snapshot-row-${snapId}`)).isExisting()), {
        timeout: 60000,
        interval: 2000,
        timeoutMsg: `snapshot ${snapId} was not removed`,
      });

      // cleanup
      await rds.send(
        new DeleteDBInstanceCommand({ DBInstanceIdentifier: restoredId, SkipFinalSnapshot: true }),
      );
      await rds.send(
        new DeleteDBInstanceCommand({ DBInstanceIdentifier: srcId, SkipFinalSnapshot: true }),
      );
    });

    it("R49: renders the snapshot list on a describe-capable emulator without the full lifecycle", async function () {
      // The "partial support" middle case (e.g. floci: describe works, the
      // create/restore lifecycle does not): the list view must render normally
      // — no unsupported takeover — even though the lifecycle test skips.
      await gate(this, "R49", {
        on: ["rds.snapshots.describe"],
        notAll: ["rds.instances.create", "rds.snapshots.restore"],
      });
      await gotoSnapshots();
      await waitDisplayed(T("snapshots-create"));
      await expect($(T("snapshots-unsupported"))).not.toBeExisting();
    });

    it("R49: shows the snapshots-unsupported banner on an unsupported emulator", async function () {
      await gate(this, "R49", { off: ["rds.snapshots.describe"] });
      await gotoSnapshots();
      await waitDisplayed(T("snapshots-unsupported"));
      await expect($(T("snapshots-create"))).not.toBeExisting();
    });
  });

  // --- R50: parameter groups ---------------------------------------------------

  describe("parameter groups (R50)", () => {
    it("R50: creates a group, lists it and shows its parameters", async function () {
      await gate(this, "R50", { on: ["rds.parameterGroups.describe"] });
      const name = `rds50-${stamp}`;
      await gotoParameterGroups();
      await clickT("pgroups-create");
      await setValueT("pg-name", name);
      await setValueT("pg-family", "mysql8.0");
      await setValueT("pg-desc", "e2e parameter group");
      await clickT("pg-save");
      await waitDisplayed(T(`pgroup-row-${name}`), 30000);

      // Click the group to load its parameters.
      await $(T(`pgroup-row-${name}`)).click();
      await waitDisplayed(T("pg-params-table"));

      // Delete is tolerated to fail (spec R50); attempt it best-effort.
      await stubDialogs();
      await $(`//tr[.//*[@data-testid="pgroup-row-${name}"]]`).$(T("pgroups-delete")).click();
    });

    it("R50: shows the parameter-groups-unsupported banner on an unsupported emulator", async function () {
      await gate(this, "R50", { off: ["rds.parameterGroups.describe"] });
      await gotoParameterGroups();
      await waitDisplayed(T("parameter-groups-unsupported"));
      await expect($(T("pgroups-create"))).not.toBeExisting();
    });
  });
});
