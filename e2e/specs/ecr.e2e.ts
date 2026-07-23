import {
  CreateRepositoryCommand,
  DeleteRepositoryCommand,
  DescribeRepositoriesCommand,
  type ECRClient,
} from "@aws-sdk/client-ecr";
import { $, browser, expect } from "@wdio/globals";
import {
  E2E_ENDPOINT,
  T,
  clickT,
  gotoRepositories,
  gotoRepositoryDetail,
  setValueT,
  setupActiveConnection,
  waitDisplayed,
} from "../helpers/app";
import { makeEcrClient } from "../helpers/aws";
import { expectCovered, gate } from "../helpers/capabilities";

/**
 * ECR requirements (R78-R79), gated per capability (see helpers/capabilities.ts).
 * Emulators implement different subsets: localstack CE has no ECR at all
 * (ecr.repositories ×), floci only creates repositories when started with the
 * docker socket mounted (ecr.create). Every family has supported- and
 * unsupported-side tests, and the `after` coverage guard fails when a capability
 * combination would leave a family unverified.
 *
 * Image push is out of scope, so the detail image list is asserted empty (R79).
 */
describe("ecr", () => {
  const ecr: ECRClient = makeEcrClient(E2E_ENDPOINT);
  const stamp = Date.now();
  const seeded: string[] = [];

  /** Click a row-scoped action, retrying through the list reload remount. */
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
      name: "ecr-conn",
      endpoint: E2E_ENDPOINT,
      region: "ap-northeast-1",
    });
  });

  after(async () => {
    // Best-effort cleanup of SDK-seeded repositories (floci spawns a real
    // registry container per repo — force delete removes it).
    for (const name of seeded) {
      await ecr
        .send(new DeleteRepositoryCommand({ repositoryName: name, force: true }))
        .catch(() => {});
    }
    expectCovered("R78");
    expectCovered("R79");
  });

  // --- R78: repository CRUD vs unsupported emulators --------------------------

  describe("repositories (R78)", () => {
    it("R78: UI creates a repository, copies its URI, then deletes it", async function () {
      await gate(this, "R78", { on: ["ecr.repositories", "ecr.create"] });
      const name = `ecr78-${stamp}`;
      await gotoRepositories();
      await clickT("ecr-create");
      await setValueT("ecr-name", name);
      await clickT("ecr-save");

      const row = `//tr[.//*[@data-testid="ecr-row-${name}"]]`;
      await waitDisplayed(T(`ecr-row-${name}`));

      // SDK back-check: the repository actually exists.
      const out = await ecr.send(
        new DescribeRepositoriesCommand({ repositoryNames: [name] }),
      );
      expect(out.repositories?.[0]?.repositoryName).toBe(name);

      // The URI copy action is present and clickable (clipboard content is not
      // asserted — the webview may deny clipboard access).
      await clickRowAction(row, "ecr-copy-uri");
      await expect($(T("error-banner"))).not.toBeExisting();

      // Delete via the row action (name-confirmation modal + force option).
      await clickRowAction(row, "ecr-delete");
      await clickT("ecr-delete-force");
      await setValueT("ecr-delete-input", name);
      await clickT("ecr-delete-confirm");
      await browser.waitUntil(async () => !(await $(T(`ecr-row-${name}`)).isExisting()), {
        timeout: 30000,
        interval: 1000,
        timeoutMsg: `repository ${name} was not removed`,
      });

      // SDK back-check: the repository is gone.
      await browser.waitUntil(
        async () => {
          try {
            await ecr.send(new DescribeRepositoriesCommand({ repositoryNames: [name] }));
            return false;
          } catch {
            return true;
          }
        },
        { timeout: 30000, interval: 1000, timeoutMsg: `repository ${name} still exists` },
      );
    });

    it("R78: shows the unsupported banner and hides the create action", async function () {
      await gate(this, "R78", { off: ["ecr.repositories"] });
      await gotoRepositories();
      await waitDisplayed(T("ecr-unsupported"));
      expect((await $(T("ecr-unsupported")).getText()).length).toBeGreaterThan(10);
      await expect($(T("ecr-create"))).not.toBeExisting();
    });

    it("R78: lists repositories and surfaces an error when a create is rejected", async function () {
      // Partial-support middle case (describe works, create rejected): the list
      // renders normally — no unsupported takeover — even though create fails.
      await gate(this, "R78", { on: ["ecr.repositories"], off: ["ecr.create"] });
      await gotoRepositories();
      await waitDisplayed(T("ecr-create"));
      await expect($(T("ecr-unsupported"))).not.toBeExisting();

      await clickT("ecr-create");
      await setValueT("ecr-name", `ecr78m-${stamp}`);
      await clickT("ecr-save");
      await waitDisplayed(T("error-banner"));
    });
  });

  // --- R79: repository detail image list -------------------------------------

  describe("images (R79)", () => {
    it("R79: shows an empty image list for a repository", async function () {
      await gate(this, "R79", { on: ["ecr.repositories", "ecr.create"] });
      const name = `ecr79-${stamp}`;
      await ecr.send(new CreateRepositoryCommand({ repositoryName: name }));
      seeded.push(name);

      await gotoRepositoryDetail(name);
      // Push is out of scope, so the image table renders empty.
      await waitDisplayed(T("ecr-images-empty"));
    });

    it("R79: shows the unsupported banner on the detail page", async function () {
      await gate(this, "R79", { off: ["ecr.repositories"] });
      await gotoRepositoryDetail(`ecr79u-${stamp}`);
      await waitDisplayed(T("ecr-unsupported"));
    });
  });
});
