import {
  DeleteClusterCommand,
  type KafkaClient,
  ListClustersCommand,
} from "@aws-sdk/client-kafka";
import { $, browser, expect } from "@wdio/globals";
import {
  E2E_ENDPOINT,
  T,
  clickT,
  gotoClusterDetail,
  gotoClusters,
  gotoMskDashboard,
  setValueT,
  setupActiveConnection,
  waitDisplayed,
} from "../helpers/app";
import { makeKafkaClient } from "../helpers/aws";
import { expectCovered, gate } from "../helpers/capabilities";

/**
 * MSK requirements (R92-R93), gated on the `kafka.clusters` capability.
 * MSK is implemented by floci (Redpanda) and ministack; it is a Pro feature on
 * localstack:3 and absent on kumo. R92 (supported) drives the full create ->
 * ACTIVE -> bootstrap-brokers -> delete lifecycle; R93 (unsupported) asserts the
 * msk-unsupported banner and the hidden create action. The two sides share the
 * "R92-R93" coverage family so the guard passes on every emulator.
 */
describe("msk", () => {
  const kafka: KafkaClient = makeKafkaClient(E2E_ENDPOINT);
  const stamp = Date.now();

  /** Best-effort SDK cleanup of a named cluster (delete needs the ARN). */
  async function deleteClusterByName(name: string): Promise<void> {
    const out = await kafka.send(new ListClustersCommand({})).catch(() => undefined);
    const arn = out?.ClusterInfoList?.find((c) => c.ClusterName === name)?.ClusterArn;
    if (arn) await kafka.send(new DeleteClusterCommand({ ClusterArn: arn })).catch(() => {});
  }

  before(async () => {
    await setupActiveConnection({
      name: "msk-conn",
      endpoint: E2E_ENDPOINT,
      region: "ap-northeast-1",
    });
  });

  after(() => {
    expectCovered("R92-R93");
  });

  it("R92: creates a cluster, shows its bootstrap brokers, then deletes it", async function () {
    await gate(this, "R92-R93", { on: ["kafka.clusters"] });
    const name = `msk92-${stamp}`;
    await deleteClusterByName(name);

    // Create via the UI.
    await gotoClusters();
    await clickT("msk-create");
    await setValueT("c-name", name);
    await clickT("c-save");

    // The row appears and reaches the ACTIVE badge ("アクティブ").
    const row = `//tr[.//*[@data-testid="cluster-row-${name}"]]`;
    await waitDisplayed(T(`cluster-row-${name}`), 60000);
    await browser.waitUntil(async () => (await $(row).getText()).includes("アクティブ"), {
      timeout: 60000,
      interval: 2000,
      timeoutMsg: `cluster ${name} never became ACTIVE`,
    });

    // SDK back-check: the cluster really exists.
    const listed = await kafka.send(new ListClustersCommand({}));
    expect(listed.ClusterInfoList?.some((c) => c.ClusterName === name)).toBe(true);

    // Detail page shows a non-empty bootstrap broker string.
    await gotoClusterDetail(name);
    await waitDisplayed(T("msk-bootstrap-plaintext"), 30000);
    const brokers = await $(T("msk-bootstrap-plaintext")).getText();
    expect(brokers.length).toBeGreaterThan(0);
    expect(brokers).not.toBe("-");

    // Delete via the row action (name-confirmation modal).
    await gotoClusters();
    await $(row).$(T("msk-delete")).click();
    await setValueT("msk-delete-input", name);
    await clickT("msk-delete-confirm");
    await browser.waitUntil(async () => !(await $(T(`cluster-row-${name}`)).isExisting()), {
      timeout: 60000,
      interval: 2000,
      timeoutMsg: `cluster ${name} was not removed`,
    });

    // SDK back-check: the cluster is gone (or entering DELETING).
    await browser.waitUntil(
      async () => {
        const out = await kafka.send(new ListClustersCommand({}));
        const found = out.ClusterInfoList?.find((c) => c.ClusterName === name);
        return !found || found.State === "DELETING";
      },
      { timeout: 60000, interval: 2000, timeoutMsg: `cluster ${name} was not deleted` },
    );
  });

  it("R93: shows the msk-unsupported banner and hides create on the clusters page", async function () {
    await gate(this, "R92-R93", { off: ["kafka.clusters"] });
    await gotoClusters();
    await waitDisplayed(T("msk-unsupported"));
    expect((await $(T("msk-unsupported")).getText()).length).toBeGreaterThan(10);
    await expect($(T("msk-create"))).not.toBeExisting();
  });

  it("R93: shows the msk-unsupported banner on the dashboard", async function () {
    await gate(this, "R92-R93", { off: ["kafka.clusters"] });
    await gotoMskDashboard();
    await waitDisplayed(T("msk-unsupported"));
    await expect($(T("msk-dash-create"))).not.toBeExisting();
  });
});
