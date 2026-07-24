import {
  type CloudWatchLogsClient,
  CreateLogGroupCommand,
  CreateLogStreamCommand,
  DeleteLogGroupCommand,
  DescribeLogGroupsCommand,
  PutLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import { $, browser, expect } from "@wdio/globals";
import {
  clickT,
  gotoAlarms,
  gotoCloudwatchDashboard,
  gotoLogGroupDetail,
  gotoLogGroups,
  gotoMetrics,
  setSelectValue,
  setupActiveConnection,
  setValueT,
  T,
  waitDisplayed,
} from "../helpers/app";
import { cwQuery, E2E_ENDPOINT, makeCloudWatchLogsClient } from "../helpers/aws";
import { expectCovered, gate } from "../helpers/capabilities";

/**
 * CloudWatch requirements (R80-R83).
 *   R80 Log groups CRUD + dashboard (unconditional — all four emulators).
 *   R81 Log group detail: streams -> events + FilterLogEvents (unconditional).
 *   R82 Metrics: namespace -> metric -> statistics table. Metrics speak the
 *       legacy Query protocol (spec §2.1-1); gated on `cloudwatch.metrics`
 *       (kumo does not route the `monitoring` service). Symmetric unsupported side.
 *   R83 Alarms CRUD, gated on `cloudwatch.alarms` (kumo ×). Symmetric.
 *
 * Log fixtures are seeded/verified with the CloudWatch Logs SDK (JSON protocol,
 * works everywhere). Metrics/alarms are seeded/verified with raw Query HTTP
 * (`cwQuery`, `api/monitoring` UA token) because the SDK's CBOR encoding is
 * rejected by localstack:3.
 */
describe("cloudwatch", () => {
  const logs: CloudWatchLogsClient = makeCloudWatchLogsClient(E2E_ENDPOINT);
  const stamp = Date.now();
  const createdGroups: string[] = [];
  const createdAlarms: string[] = [];

  async function seedLogGroup(name: string): Promise<void> {
    await logs.send(new CreateLogGroupCommand({ logGroupName: name }));
    createdGroups.push(name);
  }

  async function logGroupExists(name: string): Promise<boolean> {
    const out = await logs.send(
      new DescribeLogGroupsCommand({ logGroupNamePrefix: name }),
    );
    return (out.logGroups ?? []).some((g) => g.logGroupName === name);
  }

  before(async () => {
    await setupActiveConnection({
      name: "cloudwatch-conn",
      endpoint: E2E_ENDPOINT,
      region: "ap-northeast-1",
    });
  });

  after(async () => {
    for (const g of createdGroups) {
      await logs.send(new DeleteLogGroupCommand({ logGroupName: g })).catch(() => {});
    }
    for (const name of createdAlarms) {
      await cwQuery("DeleteAlarms", { "AlarmNames.member.1": name }).catch(() => {});
    }
    expectCovered("R82");
    expectCovered("R83");
  });

  it("R80: lists seeded log groups, creates and deletes via the UI, dashboard summarises", async () => {
    const seeded = `/nlsd/lg-seed-${stamp}`;
    const created = `/nlsd/lg-new-${stamp}`;
    await seedLogGroup(seeded);

    // Seeded group shows in the list.
    await gotoLogGroups();
    await waitDisplayed(T(`lg-link-${seeded}`));

    // Create a log group via the UI, verify through the SDK.
    await clickT("lg-create");
    await setValueT("lg-name", created);
    await clickT("lg-save");
    await waitDisplayed(T(`lg-link-${created}`));
    createdGroups.push(created);
    expect(await logGroupExists(created)).toBe(true);

    // Delete it via the name-confirmation modal, verify it is gone.
    const box = await waitDisplayed(`[aria-label="${created} を選択"]`);
    await box.click();
    await clickT("lg-delete");
    await setValueT("lg-delete-input", created);
    await clickT("lg-delete-confirm");
    await browser.waitUntil(async () => !(await $(T(`lg-link-${created}`)).isExisting()), {
      timeout: 20000,
      timeoutMsg: `log group ${created} was not removed from the list`,
    });
    expect(await logGroupExists(created)).toBe(false);

    // Dashboard summary + quick action.
    await gotoCloudwatchDashboard();
    await browser.waitUntil(
      async () => {
        await gotoCloudwatchDashboard();
        const n = Number((await $(T("cw-dash-log-groups")).getText()).replace(/[^\d]/g, ""));
        return n >= 1;
      },
      { timeout: 30000, interval: 2000, timeoutMsg: "dashboard never showed a log-group count" },
    );
    await clickT("cw-dash-create-lg");
    await waitDisplayed(T("lg-name"));
  });

  it("R81: shows a stream's seeded events and filters them", async () => {
    const group = `/nlsd/lg-detail-${stamp}`;
    const stream = "stream-a";
    await seedLogGroup(group);
    await logs.send(
      new CreateLogStreamCommand({ logGroupName: group, logStreamName: stream }),
    );
    await logs.send(
      new PutLogEventsCommand({
        logGroupName: group,
        logStreamName: stream,
        logEvents: [
          { timestamp: Date.now(), message: "hello-from-seed" },
          { timestamp: Date.now(), message: "ERROR something failed" },
        ],
      }),
    );

    await gotoLogGroupDetail(group);
    await clickT(`stream-link-${stream}`);
    await browser.waitUntil(
      async () => (await $(T("log-event-row")).isExisting()),
      { timeout: 20000, timeoutMsg: "stream events never appeared" },
    );
    expect(await $(`//td[contains(text(),"hello-from-seed")]`).isExisting()).toBe(true);

    // FilterLogEvents by pattern.
    await setValueT("log-filter-input", "ERROR");
    await clickT("log-filter-run");
    await browser.waitUntil(
      async () => $(`//td[contains(text(),"ERROR something failed")]`).isExisting(),
      { timeout: 20000, timeoutMsg: "filtered event never appeared" },
    );
  });

  it("R82: metrics namespace -> metric -> statistics reflect a seeded datapoint", async function () {
    await gate(this, "R82", { on: ["cloudwatch.metrics"] });
    const ns = `NLSD/E2E-${stamp}`;
    const value = 123;
    // Seed a datapoint via raw Query PutMetricData (the SDK CBOR path is rejected
    // by localstack:3).
    await cwQuery("PutMetricData", {
      Namespace: ns,
      "MetricData.member.1.MetricName": "Probe",
      "MetricData.member.1.Value": String(value),
      "MetricData.member.1.Dimensions.member.1.Name": "Host",
      "MetricData.member.1.Dimensions.member.1.Value": "h1",
    });

    // The metric shows up in ListMetrics; select its namespace, then the metric.
    await browser.waitUntil(
      async () => {
        await gotoMetrics();
        return browser.execute(
          (sel: string, val: string) => {
            const el = document.querySelector(sel) as HTMLSelectElement | null;
            return !!el && [...el.options].some((o) => o.value === val);
          },
          T("metrics-namespace-select"),
          ns,
        );
      },
      { timeout: 30000, interval: 2000, timeoutMsg: `namespace ${ns} never appeared in metrics` },
    );
    await setSelectValue("metrics-namespace-select", ns);
    await clickT("metric-link-Probe");

    // The statistics table reflects the seeded value.
    await browser.waitUntil(
      async () => {
        const rows = await browser.execute(
          () => document.querySelectorAll('[data-testid="metric-datapoint-row"]').length,
        );
        return rows >= 1;
      },
      { timeout: 30000, interval: 2000, timeoutMsg: "no datapoints appeared for the seeded metric" },
    );
    expect(await $(`//td[contains(text(),"${value}")]`).isExisting()).toBe(true);
  });

  it("R82: metrics page shows the unsupported banner where metrics are unavailable", async function () {
    await gate(this, "R82", { off: ["cloudwatch.metrics"] });
    await gotoMetrics();
    await waitDisplayed(T("cloudwatch-unsupported"));
    await expect($(T("metrics-namespace-select"))).not.toBeExisting();
  });

  it("R83: creates and deletes an alarm via the UI", async function () {
    await gate(this, "R83", { on: ["cloudwatch.alarms"] });
    const name = `nlsd-e2e-alarm-${stamp}`;
    createdAlarms.push(name);

    await gotoAlarms();
    await clickT("alarm-create");
    await setValueT("alarm-name", name);
    await setValueT("alarm-namespace", "NLSD/E2E");
    await setValueT("alarm-metric", "Probe");
    await setValueT("alarm-threshold", "10");
    await clickT("alarm-save");
    await waitDisplayed(`//td[normalize-space()="${name}"]`);

    // Verify via raw Query DescribeAlarms.
    const { body } = await cwQuery("DescribeAlarms");
    expect(body).toContain(name);

    // Delete via the name-confirmation modal.
    const box = await waitDisplayed(`[aria-label="${name} を選択"]`);
    await box.click();
    await clickT("alarm-delete");
    await setValueT("alarm-delete-input", name);
    await clickT("alarm-delete-confirm");
    await browser.waitUntil(
      async () => !(await $(`//td[normalize-space()="${name}"]`).isExisting()),
      { timeout: 20000, timeoutMsg: `alarm ${name} was not removed from the list` },
    );
    const after = await cwQuery("DescribeAlarms");
    expect(after.body).not.toContain(name);
  });

  it("R83: alarms page shows the unsupported banner where alarms are unavailable", async function () {
    await gate(this, "R83", { off: ["cloudwatch.alarms"] });
    await gotoAlarms();
    await waitDisplayed(T("cloudwatch-unsupported"));
    await expect($(T("alarm-create"))).not.toBeExisting();
  });
});
