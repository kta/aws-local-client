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
  setValueT,
  setupActiveConnection,
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
});
