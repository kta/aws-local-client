import {
  CreateCacheClusterCommand,
  DeleteCacheClusterCommand,
  DescribeReplicationGroupsCommand,
  type ElastiCacheClient,
} from "@aws-sdk/client-elasticache";
import { $, browser, expect } from "@wdio/globals";
import {
  E2E_ENDPOINT,
  T,
  clickT,
  gotoCaches,
  gotoElastiCacheDashboard,
  setValueT,
  setupActiveConnection,
  waitDisplayed,
} from "../helpers/app";
import { makeElastiCacheClient } from "../helpers/aws";
import { expectCovered, gate } from "../helpers/capabilities";

/**
 * ElastiCache requirements (R68-R70), gated on the `elasticache.describe`
 * capability (localstack:3 is Pro-only and rejects describe). The unified list
 * merges DescribeReplicationGroups (redis/valkey) and DescribeCacheClusters
 * (memcached). Each family has a supported- and an unsupported-side test; the
 * `after` coverage guard fails if a capability combination leaves one
 * unverified.
 */
describe("elasticache", () => {
  const ec: ElastiCacheClient = makeElastiCacheClient(E2E_ENDPOINT);
  const stamp = Date.now();

  before(async () => {
    await setupActiveConnection({
      name: "elasticache-conn",
      endpoint: E2E_ENDPOINT,
      region: "ap-northeast-1",
    });
  });

  after(() => {
    expectCovered("R68");
    expectCovered("R69");
    expectCovered("R70");
  });

  // --- R68: dashboard + unified list -----------------------------------------

  describe("dashboard and list (R68)", () => {
    it("R68: shows summary cards and the SDK-seeded cache in the merged list", async function () {
      await gate(this, "R68", { on: ["elasticache.describe"] });
      const id = `ec68-${stamp}`;
      // Seed a standalone memcached cluster (in-process on ministack).
      await ec.send(
        new CreateCacheClusterCommand({
          CacheClusterId: id,
          Engine: "memcached",
          CacheNodeType: "cache.t3.micro",
          NumCacheNodes: 1,
        }),
      );

      await gotoElastiCacheDashboard();
      await waitDisplayed(T("elasticache-dash-total"));
      await waitDisplayed(T("elasticache-dash-memcached"));

      await gotoCaches();
      await waitDisplayed(T(`cache-row-${id}`), 60000);

      // cleanup
      await ec.send(new DeleteCacheClusterCommand({ CacheClusterId: id })).catch(() => {});
    });

    it("R68: shows the elasticache-unsupported banner on an unsupported emulator", async function () {
      await gate(this, "R68", { off: ["elasticache.describe"] });
      await gotoElastiCacheDashboard();
      await waitDisplayed(T("elasticache-unsupported"));
      await expect($(T("elasticache-dash-create"))).not.toBeExisting();
    });
  });

  // --- R69: create (redis replication group) with endpoint, then delete ------

  describe("create and delete (R69)", () => {
    it("R69: UI creates a redis cache, shows its endpoint, then deletes it", async function () {
      await gate(this, "R69", { on: ["elasticache.describe"] });
      const id = `ec69-${stamp}`;
      await gotoCaches();
      await clickT("caches-create");
      await setValueT("c-id", id);
      // engine defaults to redis (→ CreateReplicationGroup)
      await clickT("c-save");

      const row = `//tr[.//*[@data-testid="cache-row-${id}"]]`;
      await waitDisplayed(T(`cache-row-${id}`), 60000);
      // Endpoint (address:port) appears once the group is available.
      await browser.waitUntil(async () => /:\d+/.test(await $(row).getText()), {
        timeout: 60000,
        interval: 2000,
        timeoutMsg: `cache ${id} never showed an endpoint`,
      });

      // SDK back-check: the replication group actually exists.
      const desc = await ec.send(
        new DescribeReplicationGroupsCommand({ ReplicationGroupId: id }),
      );
      expect((desc.ReplicationGroups ?? []).length).toBeGreaterThan(0);

      // Delete via the row action (id-confirmation modal).
      await $(row).$(T("caches-delete")).click();
      await setValueT("caches-delete-input", id);
      await clickT("caches-delete-confirm");
      await browser.waitUntil(async () => !(await $(T(`cache-row-${id}`)).isExisting()), {
        timeout: 60000,
        interval: 2000,
        timeoutMsg: `cache ${id} was not removed`,
      });
    });
  });

  // --- R70: unsupported symmetry ---------------------------------------------

  describe("unsupported (R70)", () => {
    it("R70: shows the unsupported banner and hides the create action", async function () {
      await gate(this, "R70", { off: ["elasticache.describe"] });
      await gotoCaches();
      await waitDisplayed(T("elasticache-unsupported"));
      expect((await $(T("elasticache-unsupported")).getText()).length).toBeGreaterThan(10);
      await expect($(T("caches-create"))).not.toBeExisting();
    });

    it("R70: renders the caches list on a describe-capable emulator", async function () {
      await gate(this, "R70", { on: ["elasticache.describe"] });
      await gotoCaches();
      await waitDisplayed(T("caches-create"));
      await expect($(T("elasticache-unsupported"))).not.toBeExisting();
    });
  });
});
