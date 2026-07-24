import {
  CreateClusterCommand,
  DeleteClusterCommand,
  DeregisterTaskDefinitionCommand,
  DescribeClustersCommand,
  DescribeServicesCommand,
  DescribeTaskDefinitionCommand,
  DescribeTasksCommand,
  type ECSClient,
  ListTasksCommand,
  RegisterTaskDefinitionCommand,
  StopTaskCommand,
} from "@aws-sdk/client-ecs";
import { $, browser, expect } from "@wdio/globals";
import {
  T,
  clickT,
  gotoClusterDetail,
  gotoClusters,
  gotoEcsDashboard,
  gotoTaskDefinitions,
  setValueT,
  setupActiveConnection,
  waitDisplayed,
} from "../helpers/app";
import { E2E_ENDPOINT, makeEcsClient } from "../helpers/aws";
import {
  expectCovered,
  expectCoveredIf,
  expectCoveredUnless,
  gate,
} from "../helpers/capabilities";

/**
 * ECS requirements (R75-R77), gated on the `ecs.clusters` capability. The ECS
 * control plane is Pro-only on localstack:3 (it reports ListClusters as
 * unsupported) while ministack / floci implement it, so every supported-side
 * test gates `on: ["ecs.clusters"]` and has an `off`-side counterpart that
 * asserts the shared `ecs-unsupported` banner. The `after` coverage guard fails
 * if a capability combination leaves a requirement family unverified.
 *
 * RunTask (R77) starts a REAL lightweight container on ministack/floci, so the
 * task test always stops the task and deletes the cluster it created — the
 * spec's "always Stop + delete" rule — including via the SDK cleanup in `after`.
 */
const CONTAINER_DEFS = JSON.stringify([
  {
    name: "app",
    image: "public.ecr.aws/docker/library/busybox:stable",
    memory: 128,
    essential: true,
    command: ["sleep", "60"],
  },
]);

describe("ecs", () => {
  const ecs: ECSClient = makeEcsClient(E2E_ENDPOINT);
  const stamp = Date.now();
  // Clusters created during the run, torn down (with their tasks) in `after`.
  const createdClusters = new Set<string>();

  /** Seed a cluster + a busybox task definition through the SDK. */
  async function seedClusterWithTaskDef(cluster: string, family: string): Promise<string> {
    await ecs.send(new CreateClusterCommand({ clusterName: cluster }));
    createdClusters.add(cluster);
    const reg = await ecs.send(
      new RegisterTaskDefinitionCommand({
        family,
        containerDefinitions: [
          {
            name: "app",
            image: "public.ecr.aws/docker/library/busybox:stable",
            memory: 128,
            essential: true,
            command: ["sleep", "60"],
          },
        ],
      }),
    );
    return reg.taskDefinition?.taskDefinitionArn ?? "";
  }

  before(async () => {
    await setupActiveConnection({
      name: "ecs-conn",
      endpoint: E2E_ENDPOINT,
      region: "ap-northeast-1",
    });
  });

  after(async () => {
    await expectCoveredIf("R75", ["ecs.clusters"]);
    // The banner test only runs where the ECS control plane is unsupported.
    await expectCoveredUnless("R75-banner", ["ecs.clusters"]);
    // R76 always has a runnable side: task definitions are either listable
    // (supported test) or not (unsupported-banner test), so it is covered on
    // every emulator.
    expectCovered("R76");
    // R77 (cluster detail) is only meaningful where the ECS control plane
    // exists; on kumo the services/tasks unsupported-note tests cover it, on
    // ministack/floci the real service/task flows do.
    await expectCoveredIf("R77", ["ecs.clusters"]);
    // Tear down every cluster this suite created, stopping any running task
    // first so no container leaks on ministack / floci.
    for (const cluster of createdClusters) {
      try {
        const { taskArns } = await ecs.send(new ListTasksCommand({ cluster }));
        for (const taskArn of taskArns ?? []) {
          await ecs.send(new StopTaskCommand({ cluster, task: taskArn })).catch(() => {});
        }
      } catch {
        /* ignore */
      }
      await ecs.send(new DeleteClusterCommand({ cluster })).catch(() => {});
    }
  });

  // --- R75: clusters + dashboard ---------------------------------------------

  describe("clusters (R75)", () => {
    it("R75: UI creates a cluster, lists it, then deletes it", async function () {
      await gate(this, "R75", { on: ["ecs.clusters"] });
      const name = `ecs75-${stamp}`;
      createdClusters.add(name);

      await gotoClusters();
      await clickT("ecs-cluster-create");
      await setValueT("ecs-cluster-name", name);
      await clickT("ecs-cluster-save");

      await waitDisplayed(T(`ecs-cluster-row-${name}`), 30000);
      // SDK back-check: the cluster is really ACTIVE.
      await browser.waitUntil(
        async () => {
          const out = await ecs.send(new DescribeClustersCommand({ clusters: [name] }));
          return out.clusters?.[0]?.status === "ACTIVE";
        },
        { timeout: 30000, interval: 1000, timeoutMsg: `cluster ${name} never became ACTIVE` },
      );

      // Delete via the selection + name-confirmation modal.
      await $(`[aria-label="${name} を選択"]`).click();
      await clickT("ecs-cluster-delete");
      await setValueT("ecs-cluster-delete-input", name);
      await clickT("ecs-cluster-delete-confirm");
      await browser.waitUntil(async () => !(await $(T(`ecs-cluster-row-${name}`)).isExisting()), {
        timeout: 30000,
        interval: 1000,
        timeoutMsg: `cluster ${name} was not removed`,
      });
      createdClusters.delete(name);
    });

    it("R75: dashboard shows summary cards on a control-plane-capable emulator", async function () {
      await gate(this, "R75", { on: ["ecs.clusters"] });
      await gotoEcsDashboard();
      await waitDisplayed(T("ecs-dash-clusters"));
      await waitDisplayed(T("ecs-dash-services"));
      await waitDisplayed(T("ecs-dash-tasks"));
      await waitDisplayed(T("ecs-dash-create"));
    });

    it("R75: shows the ecs-unsupported banner when the control plane is unsupported", async function () {
      // Symmetric unsupported branch (localstack:3). The dashboard and the
      // clusters page both take over with the shared banner and hide create.
      await gate(this, "R75-banner", { off: ["ecs.clusters"] });
      await gotoEcsDashboard();
      await waitDisplayed(T("ecs-unsupported"));
      await expect($(T("ecs-dash-create"))).not.toBeExisting();

      await gotoClusters();
      await waitDisplayed(T("ecs-unsupported"));
      await expect($(T("ecs-cluster-create"))).not.toBeExisting();
    });
  });

  // --- R76: task definitions --------------------------------------------------

  describe("task definitions (R76)", () => {
    it("R76: registers a task definition, shows its detail, then deregisters it", async function () {
      // Gate on the LIST capability, not just the control plane: kumo routes
      // RegisterTaskDefinition but not ListTaskDefinitions, so the task-defs
      // page shows its unsupported banner there (covered by the off-side test).
      await gate(this, "R76", { on: ["ecs.taskDefinitions"] });
      const family = `ecs76-${stamp}`;

      await gotoTaskDefinitions();
      await clickT("ecs-taskdef-register");
      await setValueT("ecs-taskdef-family", family);
      await setValueT("ecs-taskdef-json", CONTAINER_DEFS);
      await clickT("ecs-taskdef-save");

      const rowId = `ecs-taskdef-row-${family}:1`;
      await waitDisplayed(T(rowId), 30000);

      // SDK back-check: the revision really registered with the busybox container.
      const described = await ecs.send(
        new DescribeTaskDefinitionCommand({ taskDefinition: `${family}:1` }),
      );
      expect(described.taskDefinition?.family).toBe(family);
      expect(
        (described.taskDefinition?.containerDefinitions ?? []).some((c) => c.name === "app"),
      ).toBe(true);

      // Open the revision detail and confirm the busybox container is shown.
      await clickT(rowId);
      await waitDisplayed(T("ecs-taskdef-detail"));
      await waitDisplayed(T("ecs-container-row-app"));
      // Close the detail modal (Escape) before deregistering.
      await browser.keys(["Escape"]);

      // Deregister via the family-name-confirmation modal.
      await clickT(`ecs-taskdef-deregister-${family}:1`);
      await setValueT("ecs-taskdef-deregister-input", family);
      await clickT("ecs-taskdef-deregister-confirm");

      // Best-effort SDK cleanup of the revision.
      await ecs
        .send(new DeregisterTaskDefinitionCommand({ taskDefinition: `${family}:1` }))
        .catch(() => {});
    });

    it("R76: shows the ecs-unsupported banner when task definitions are unlistable", async function () {
      // Symmetric branch: localstack:3 (no ECS control plane) AND kumo
      // (control-plane-partial: no ListTaskDefinitions) both take over the page
      // with the shared banner and hide the register action.
      await gate(this, "R76", { off: ["ecs.taskDefinitions"] });
      await gotoTaskDefinitions();
      await waitDisplayed(T("ecs-unsupported"));
      await expect($(T("ecs-taskdef-register"))).not.toBeExisting();
    });
  });

  // --- R77: cluster detail (services + tasks) --------------------------------

  describe("cluster detail (R77)", () => {
    it("R77: creates a service, edits its desired count, then deletes it", async function () {
      // Gate on ListServices: kumo routes CreateService but not ListServices, so
      // the created service never appears (covered by the services-note test).
      await gate(this, "R77", { on: ["ecs.clusters", "ecs.services"] });
      const cluster = `ecs77s-${stamp}`;
      const family = `ecs77sf-${stamp}`;
      const service = `svc-${stamp}`;
      await seedClusterWithTaskDef(cluster, family);

      await gotoClusterDetail(cluster);
      await clickT("ecs-tab-services");
      await clickT("ecs-service-create");
      await setValueT("csvc-name", service);
      await setValueT("csvc-desired", "0");
      await clickT("csvc-save");

      // The service row appears; then bump the desired count to a DIFFERENT
      // value via its edit modal and confirm the change actually applied.
      await waitDisplayed(T(`ecs-service-edit-${service}`), 30000);
      await clickT(`ecs-service-edit-${service}`);
      await setValueT("ecs-service-desired", "1");
      await clickT("ecs-service-desired-save");
      await browser.waitUntil(
        async () => {
          const out = await ecs.send(
            new DescribeServicesCommand({ cluster, services: [service] }),
          );
          return out.services?.[0]?.desiredCount === 1;
        },
        {
          timeout: 30000,
          interval: 1000,
          timeoutMsg: `service ${service} desiredCount was not updated to 1`,
        },
      );

      // Delete the service (name-confirmation modal).
      await clickT(`ecs-service-delete-${service}`);
      await setValueT("ecs-service-delete-input", service);
      await clickT("ecs-service-delete-confirm");
      await browser.waitUntil(
        async () => !(await $(T(`ecs-service-edit-${service}`)).isExisting()),
        { timeout: 30000, interval: 1000, timeoutMsg: `service ${service} was not removed` },
      );
    });

    it("R77: runs a task and stops it", async function () {
      // Functional gate: RunTask must materialize a task ListTasks returns.
      // kumo (no ListTasks) and any control-plane-only emulator are excluded and
      // covered by the tasks-note test instead.
      await gate(this, "R77", { on: ["ecs.runTask"] });
      const cluster = `ecs77t-${stamp}`;
      const family = `ecs77tf-${stamp}`;
      await seedClusterWithTaskDef(cluster, family);

      await gotoClusterDetail(cluster);
      await clickT("ecs-tab-tasks");
      await clickT("ecs-task-run");
      // The task-definition select defaults to the only registered family.
      await clickT("ecs-task-run-confirm");

      // The started task should appear in the list (any status).
      await browser.waitUntil(
        async () => {
          await clickT("ecs-task-refresh");
          const { taskArns } = await ecs.send(new ListTasksCommand({ cluster }));
          return (taskArns?.length ?? 0) > 0;
        },
        { timeout: 60000, interval: 2000, timeoutMsg: "run task never appeared" },
      );

      const testid = await $(`[data-testid^="ecs-task-row-"]`).getAttribute("data-testid");
      const id = (testid ?? "").replace("ecs-task-row-", "");
      const arn = (await ecs.send(new ListTasksCommand({ cluster })).catch(() => undefined))
        ?.taskArns?.[0];
      // Stop the task through the UI, then SDK-verify the UI action actually
      // moved it to a STOPPED desired-status (before any cleanup masks it).
      await clickT(`ecs-task-stop-${id}`);
      if (arn) {
        await browser.waitUntil(
          async () => {
            const out = await ecs.send(new DescribeTasksCommand({ cluster, tasks: [arn] }));
            const t = out.tasks?.[0];
            return t?.desiredStatus === "STOPPED" || t?.lastStatus === "STOPPED";
          },
          {
            timeout: 30000,
            interval: 1000,
            timeoutMsg: "UI stop did not move the task to STOPPED",
          },
        );
      }

      // Stop every remaining task via the SDK so no container leaks.
      const { taskArns } = await ecs.send(new ListTasksCommand({ cluster }));
      for (const taskArn of taskArns ?? []) {
        await ecs.send(new StopTaskCommand({ cluster, task: taskArn })).catch(() => {});
      }
    });

    it("R77: shows the services-unsupported note where ListServices is unsupported", async function () {
      // Symmetric middle case (kumo): the control plane exists but ListServices
      // is unroutable, so the services tab shows its inline unsupported note and
      // hides the create action rather than the whole-page banner.
      await gate(this, "R77", { on: ["ecs.clusters"], off: ["ecs.services"] });
      const cluster = `ecs77us-${stamp}`;
      const family = `ecs77usf-${stamp}`;
      await seedClusterWithTaskDef(cluster, family);
      await gotoClusterDetail(cluster);
      await clickT("ecs-tab-services");
      await waitDisplayed(T("ecs-services-unsupported"));
      await expect($(T("ecs-service-create"))).not.toBeExisting();
    });

    it("R77: shows the tasks-unsupported note where ListTasks is unsupported", async function () {
      // Symmetric middle case (kumo): ListTasks is unroutable, so the tasks tab
      // shows its inline unsupported note and hides the run action.
      await gate(this, "R77", { on: ["ecs.clusters"], off: ["ecs.tasks"] });
      const cluster = `ecs77ut-${stamp}`;
      const family = `ecs77utf-${stamp}`;
      await seedClusterWithTaskDef(cluster, family);
      await gotoClusterDetail(cluster);
      await clickT("ecs-tab-tasks");
      await waitDisplayed(T("ecs-tasks-unsupported"));
      await expect($(T("ecs-task-run"))).not.toBeExisting();
    });
  });
});
