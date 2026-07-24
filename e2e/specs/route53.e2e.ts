import {
  CreateHealthCheckCommand,
  CreateHostedZoneCommand,
  DeleteHealthCheckCommand,
  DeleteHostedZoneCommand,
  ListHealthChecksCommand,
  ListHostedZonesCommand,
  ListResourceRecordSetsCommand,
  type Route53Client,
} from "@aws-sdk/client-route-53";
import { $, browser, expect } from "@wdio/globals";
import {
  E2E_ENDPOINT,
  T,
  clickT,
  gotoHealthChecks,
  gotoUntil,
  gotoHostedZoneDetail,
  gotoHostedZones,
  gotoRoute53Dashboard,
  setSelectValue,
  setValueT,
  setupActiveConnection,
  waitDisplayed,
} from "../helpers/app";
import { makeRoute53Client } from "../helpers/aws";
import { expectCovered, gate, markCovered } from "../helpers/capabilities";

/**
 * Route 53 requirements (R96-R98). Fixtures are seeded / verified directly via
 * the AWS SDK; the UI is exercised for the behaviour under test.
 *   R96 UI create / list / delete a hosted zone (SDK verified) + dashboard.
 *   R97 Zone detail: UI create a record, edit it (UPSERT) and delete it, each
 *       confirmed via the SDK.
 *   R98 Health checks: on emulators that implement them, UI create -> SDK sees
 *       it -> UI delete. On emulators that do not (kumo answers 404), the page
 *       shows the route53-unsupported banner (symmetric gate on
 *       route53.healthChecks).
 */
describe("route53", () => {
  const r53: Route53Client = makeRoute53Client(E2E_ENDPOINT);
  const stamp = Date.now();
  const zoneIds: string[] = [];
  const healthCheckIds: string[] = [];

  async function seedZone(name: string): Promise<string> {
    const { HostedZone } = await r53.send(
      new CreateHostedZoneCommand({ Name: name, CallerReference: `nlsd-${name}-${stamp}` }),
    );
    const id = HostedZone?.Id as string;
    zoneIds.push(id);
    return id;
  }

  before(async () => {
    await setupActiveConnection({
      name: "route53-conn",
      endpoint: E2E_ENDPOINT,
      region: "ap-northeast-1",
    });
  });

  after(async () => {
    for (const id of zoneIds) {
      try {
        await r53.send(new DeleteHostedZoneCommand({ Id: id }));
      } catch {
        /* best effort */
      }
    }
    for (const id of healthCheckIds) {
      try {
        await r53.send(new DeleteHealthCheckCommand({ HealthCheckId: id }));
      } catch {
        /* best effort */
      }
    }
    // R96/R97 are unconditional (all four emulators implement hosted zones and
    // record sets); R98 (health checks) is capability-gated with a symmetric
    // unsupported test.
    expectCovered("R96");
    expectCovered("R97");
    expectCovered("R98");
  });

  it("R96: UI creates, lists and deletes a hosted zone", async () => {
    markCovered("R96");
    const name = `t96-${stamp}.example.com`;
    const fqdn = `${name}.`; // Route 53 stores the zone name with a trailing dot.

    await gotoHostedZones();
    await clickT("zones-create");
    await setValueT("zone-name", name);
    await clickT("zone-save");
    await waitDisplayed(T(`zone-link-${fqdn}`));

    // SDK confirms the zone exists.
    const list = await r53.send(new ListHostedZonesCommand({}));
    const created = (list.HostedZones ?? []).find((z) => (z.Name ?? "") === fqdn);
    expect(created).toBeTruthy();
    zoneIds.push(created!.Id as string); // remember for cleanup even though we delete below

    // Delete via the list (name-confirmation modal).
    const box = await waitDisplayed(`[aria-label="${fqdn} を選択"]`);
    await box.click();
    await clickT("zones-delete");
    await setValueT("zones-delete-input", fqdn);
    await clickT("zones-delete-confirm");
    await browser.waitUntil(async () => !(await $(T(`zone-link-${fqdn}`)).isExisting()), {
      timeout: 20000,
      timeoutMsg: `zone ${fqdn} was not removed`,
    });

    // SDK confirms the zone is gone.
    await browser.waitUntil(
      async () => {
        const after = await r53.send(new ListHostedZonesCommand({}));
        return !(after.HostedZones ?? []).some((z) => (z.Name ?? "") === fqdn);
      },
      { timeout: 20000, timeoutMsg: "zone never disappeared via the SDK" },
    );
  });

  it("R96: dashboard summarises zones and the quick action opens the create modal", async () => {
    const name = `t96d-${stamp}.example.com`;
    await seedZone(name);

    await gotoRoute53Dashboard();
    await waitDisplayed(T("route53-dash-zones"));
    await waitDisplayed(T("route53-dash-healthchecks"));

    await browser.waitUntil(
      async () => {
        await gotoRoute53Dashboard();
        const text = await $(T("route53-dash-summary")).getText();
        const count = Number(text.match(/ホストゾーン数\s*(\d[\d,]*)/)?.[1]?.replace(/,/g, ""));
        return count >= 1;
      },
      { timeout: 30000, interval: 2000, timeoutMsg: "dashboard never showed a zone count" },
    );

    await clickT("route53-dash-create-zone");
    await waitDisplayed(T("zone-name"));
  });

  it("R97: zone detail creates, edits (UPSERT) and deletes a record", async () => {
    markCovered("R97");
    const zoneName = `t97-${stamp}.example.com`;
    const zoneId = await seedZone(zoneName);
    const recName = `www.${zoneName}`;
    const recFqdn = `${recName}.`;

    await gotoHostedZoneDetail(zoneId);

    // --- create an A record ---
    await clickT("record-create");
    await setValueT("record-name", recName);
    await setSelectValue("record-type", "A");
    await setValueT("record-values", "1.2.3.4");
    await clickT("record-save");
    await waitDisplayed(T(`record-name-${recFqdn}`));

    await browser.waitUntil(
      async () => {
        const out = await r53.send(new ListResourceRecordSetsCommand({ HostedZoneId: zoneId }));
        return (out.ResourceRecordSets ?? []).some(
          (r) =>
            r.Type === "A" &&
            r.Name === recFqdn &&
            (r.ResourceRecords ?? []).some((rr) => rr.Value === "1.2.3.4"),
        );
      },
      { timeout: 20000, timeoutMsg: "A record never appeared via the SDK" },
    );

    // --- edit the record (UPSERT to a new value) ---
    await clickT(`record-edit-${recFqdn}`);
    await setValueT("record-values", "5.6.7.8");
    await clickT("record-save");
    await browser.waitUntil(
      async () => {
        const out = await r53.send(new ListResourceRecordSetsCommand({ HostedZoneId: zoneId }));
        return (out.ResourceRecordSets ?? []).some(
          (r) =>
            r.Type === "A" &&
            r.Name === recFqdn &&
            (r.ResourceRecords ?? []).some((rr) => rr.Value === "5.6.7.8"),
        );
      },
      { timeout: 20000, timeoutMsg: "record UPSERT never reflected via the SDK" },
    );

    // --- delete the record ---
    await clickT(`record-delete-${recFqdn}`);
    await clickT("record-delete-confirm");
    await browser.waitUntil(async () => !(await $(T(`record-name-${recFqdn}`)).isExisting()), {
      timeout: 20000,
      timeoutMsg: "record row was not removed",
    });
    await browser.waitUntil(
      async () => {
        const out = await r53.send(new ListResourceRecordSetsCommand({ HostedZoneId: zoneId }));
        return !(out.ResourceRecordSets ?? []).some((r) => r.Type === "A" && r.Name === recFqdn);
      },
      { timeout: 20000, timeoutMsg: "record never disappeared via the SDK" },
    );

    // Clean the zone up (no non-default records remain).
    await r53.send(new DeleteHostedZoneCommand({ Id: zoneId })).catch(() => {});
  });

  it("R98: UI creates and deletes a health check", async function () {
    await gate(this, "R98", { on: ["route53.healthChecks"] });
    const target = `10.0.${(stamp >> 8) & 0xff}.${stamp & 0xff}`;

    await gotoHealthChecks();
    await clickT("healthcheck-create");
    await setValueT("hc-target", target);
    await setSelectValue("hc-type", "TCP");
    await setValueT("hc-port", "8080");
    await clickT("hc-save");

    // SDK confirms the health check exists; remember its id for delete + cleanup.
    let id: string | undefined;
    await browser.waitUntil(
      async () => {
        const out = await r53.send(new ListHealthChecksCommand({}));
        const hc = (out.HealthChecks ?? []).find(
          (h) => h.HealthCheckConfig?.IPAddress === target,
        );
        id = hc?.Id;
        return !!id;
      },
      { timeout: 20000, timeoutMsg: "health check never appeared via the SDK" },
    );
    healthCheckIds.push(id!);

    // Delete via the row action.
    await clickT(`healthcheck-delete-${id}`);
    await clickT("healthcheck-delete-confirm");
    await browser.waitUntil(
      async () => {
        const out = await r53.send(new ListHealthChecksCommand({}));
        return !(out.HealthChecks ?? []).some((h) => h.Id === id);
      },
      { timeout: 20000, timeoutMsg: "health check never disappeared via the SDK" },
    );
  });

  it("R98: health checks page shows the unsupported banner when not implemented", async function () {
    await gate(this, "R98", { off: ["route53.healthChecks"] });
    await gotoHealthChecks();
    await waitDisplayed(T("route53-unsupported"));
    await expect($(T("healthcheck-create"))).not.toBeExisting();
  });

  it("R98: seeds a health check via the SDK and lists it in the UI", async function () {
    await gate(this, "R98", { on: ["route53.healthChecks"] });
    const target = `10.1.${(stamp >> 8) & 0xff}.${stamp & 0xff}`;
    const { HealthCheck } = await r53.send(
      new CreateHealthCheckCommand({
        CallerReference: `nlsd-hc-${stamp}`,
        HealthCheckConfig: {
          IPAddress: target,
          Port: 80,
          Type: "TCP",
          RequestInterval: 30,
          FailureThreshold: 3,
        },
      }),
    );
    const id = HealthCheck?.Id as string;
    healthCheckIds.push(id);

    // Eventual consistency: re-navigate until the seeded health check lists.
    await gotoUntil(gotoHealthChecks, `hc-target-${id}`);
    expect(await $(T(`hc-target-${id}`)).getText()).toContain(target);
  });
});
