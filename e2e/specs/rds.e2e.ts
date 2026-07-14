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
  countByTestId,
  gotoInstances,
  gotoParameterGroups,
  gotoRdsDashboard,
  gotoSnapshots,
  setValueT,
  setupActiveConnection,
  stubDialogs,
  waitDisplayed,
} from "../helpers/app";
import { isUnsupportedError, makeRdsClient } from "../helpers/aws";

/**
 * RDS requirements (R33-R35), capability-adaptive like the backups suite. The
 * emulator is probed once in `before` (describe / create via the SDK) to pick a
 * branch; the other branches' tests self-skip so the same suite is green on
 * every emulator:
 *   R33 describe + create supported (ministack): UI create -> row available -> UI delete.
 *   R34 describe unsupported (localstack:3): the `rds-unsupported` banner shows and
 *       the create action is absent.
 *   R35 describe supported but create rejected: the list renders and a UI create
 *       surfaces an error banner.
 */
type RdsBranch = "create" | "unsupported" | "readonly";

describe("rds", () => {
  const rds: RDSClient = makeRdsClient(E2E_ENDPOINT);
  const stamp = Date.now();
  let branch: RdsBranch = "unsupported";

  async function probe(): Promise<RdsBranch> {
    try {
      await rds.send(new DescribeDBInstancesCommand({}));
    } catch (e) {
      if (isUnsupportedError(e)) return "unsupported";
      throw e;
    }
    const probeId = `rds-probe-${stamp}`;
    try {
      await rds.send(
        new CreateDBInstanceCommand({
          DBInstanceIdentifier: probeId,
          Engine: "mysql",
          DBInstanceClass: "db.t3.micro",
          MasterUsername: "admin",
          MasterUserPassword: "password123",
          AllocatedStorage: 20,
        }),
      );
      try {
        await rds.send(
          new DeleteDBInstanceCommand({
            DBInstanceIdentifier: probeId,
            SkipFinalSnapshot: true,
          }),
        );
      } catch {
        /* cleanup best effort */
      }
      return "create";
    } catch {
      return "readonly";
    }
  }

  before(async () => {
    branch = await probe();
    await setupActiveConnection({
      name: "rds-conn",
      endpoint: E2E_ENDPOINT,
      region: "ap-northeast-1",
    });
  });

  describe("create-capable emulator (R33)", () => {
    beforeEach(function () {
      if (branch !== "create") this.skip();
    });

    it("R33: UI creates an instance that becomes available, then deletes it", async () => {
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
  });

  describe("unsupported emulator (R34)", () => {
    beforeEach(function () {
      if (branch !== "unsupported") this.skip();
    });

    it("R34: shows the unsupported banner and hides the create action", async () => {
      await gotoInstances();
      await waitDisplayed(T("rds-unsupported"));
      expect((await $(T("rds-unsupported")).getText()).length).toBeGreaterThan(10);
      await expect($(T("instances-create"))).not.toBeExisting();
    });
  });

  describe("read-only emulator (R35)", () => {
    beforeEach(function () {
      if (branch !== "readonly") this.skip();
    });

    it("R35: lists instances and surfaces an error when a create is rejected", async () => {
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

  // R47: dashboard. Renders summary cards when describe is supported
  // (create/readonly), or the rds-unsupported banner when it is not.
  describe("dashboard (R47)", () => {
    it("R47: shows summary cards on a describe-capable emulator", async function () {
      if (branch === "unsupported") this.skip();
      await gotoRdsDashboard();
      await waitDisplayed(T("rds-dash-instances"));
      await waitDisplayed(T("rds-dash-available"));
      await waitDisplayed(T("rds-dash-snapshots"));
      await waitDisplayed(T("rds-dash-create"));
    });

    it("R47: shows the rds-unsupported banner on an unsupported emulator", async function () {
      if (branch !== "unsupported") this.skip();
      await gotoRdsDashboard();
      await waitDisplayed(T("rds-unsupported"));
      await expect($(T("rds-dash-create"))).not.toBeExisting();
    });
  });

  // R48: instance operations (stop/start/reboot/modify). Only ministack fully
  // implements the lifecycle, so these run on the create branch.
  describe("instance operations (R48)", () => {
    beforeEach(function () {
      if (branch !== "create") this.skip();
    });

    it("R48: stops, starts, reboots and modifies an instance", async () => {
      const id = `rds48-${stamp}`;
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

      await gotoInstances();
      const row = `//tr[.//*[@data-testid="instance-row-${id}"]]`;
      await waitDisplayed(T(`instance-row-${id}`));
      await browser.waitUntil(async () => (await $(row).getText()).includes("available"), {
        timeout: 60000,
        interval: 2000,
        timeoutMsg: `instance ${id} never became available`,
      });

      // stop / start / reboot: each op must not raise an error banner. Each op
      // reloads the list and briefly unmounts the row, so wait for the
      // row-scoped button to come back before clicking (slow Windows runners).
      const clickRowAction = async (action: string) => {
        await browser.waitUntil(async () => $(row).$(T(action)).isExisting(), {
          timeout: 20000,
          timeoutMsg: `${action} never reappeared in the ${id} row`,
        });
        await $(row).$(T(action)).click();
      };
      for (const action of ["instance-stop", "instance-start", "instance-reboot"]) {
        await clickRowAction(action);
        await expect($(T("error-banner"))).not.toBeExisting();
      }

      // modify allocated storage 20 -> 30.
      await clickRowAction("instance-modify");
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

      await rds.send(new DeleteDBInstanceCommand({ DBInstanceIdentifier: id, SkipFinalSnapshot: true }));
    });
  });

  // R48: on a describe-capable but create-rejecting emulator (floci), an instance
  // operation that the emulator does not implement must surface as a normal error
  // banner (not the unsupported takeover). floci exposes no instances (create is
  // rejected there), so if a row happens to exist we stop it directly; otherwise
  // we drive the same runOp error surface via a create, which floci also rejects.
  describe("read-only emulator operations (R48)", () => {
    beforeEach(function () {
      if (branch !== "readonly") this.skip();
    });

    it("R48: surfaces an error banner when an operation is rejected", async () => {
      await gotoInstances();
      // The list renders (create action present, no unsupported takeover).
      await waitDisplayed(T("instances-create"));
      await expect($(T("rds-unsupported"))).not.toBeExisting();

      const stopCount = await countByTestId("instance-stop");
      if (stopCount > 0) {
        await clickT("instance-stop");
      } else {
        await clickT("instances-create");
        await setValueT("i-id", `rds48ro-${stamp}`);
        await setValueT("i-username", "admin");
        await setValueT("i-password", "password123");
        await clickT("i-save");
      }
      await waitDisplayed(T("error-banner"));
    });
  });

  // R49: snapshots. Full lifecycle on ministack (create branch); banner on
  // emulators without the snapshot API.
  describe("snapshots (R49)", () => {
    it("R49: creates, restores and deletes a snapshot", async function () {
      if (branch !== "create") this.skip();
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
      await rds.send(new DeleteDBInstanceCommand({ DBInstanceIdentifier: srcId, SkipFinalSnapshot: true }));
    });

    it("R49: shows the snapshots-unsupported banner on an unsupported emulator", async function () {
      if (branch !== "unsupported") this.skip();
      await gotoSnapshots();
      await waitDisplayed(T("snapshots-unsupported"));
      await expect($(T("snapshots-create"))).not.toBeExisting();
    });
  });

  // R50: parameter groups. describe + CRUD on ministack/floci (create/readonly
  // branches); banner on localstack (unsupported branch).
  describe("parameter groups (R50)", () => {
    it("R50: creates a group, lists it and shows its parameters", async function () {
      if (branch === "unsupported") this.skip();
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

    it("R50: shows the parameter-groups-unsupported banner on localstack", async function () {
      if (branch !== "unsupported") this.skip();
      await gotoParameterGroups();
      await waitDisplayed(T("parameter-groups-unsupported"));
      await expect($(T("pgroups-create"))).not.toBeExisting();
    });
  });
});
