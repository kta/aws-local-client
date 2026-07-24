import {
  DeleteDomainCommand,
  DescribeDomainCommand,
  ListDomainNamesCommand,
  type OpenSearchClient,
} from "@aws-sdk/client-opensearch";
import { $, browser, expect } from "@wdio/globals";
import {
  E2E_ENDPOINT,
  T,
  clickT,
  navigateHash,
  setValueT,
  setupActiveConnection,
  waitDisplayed,
} from "../helpers/app";
import { makeOpenSearchClient } from "../helpers/aws";
import { expectCovered, gate } from "../helpers/capabilities";

/**
 * OpenSearch requirements (R87-R88), gated per capability (see
 * helpers/capabilities.ts). Domains describe (`opensearch.domains`) is
 * unsupported on kumo, and domain create (`opensearch.create`) additionally
 * needs a real OpenSearch node — floci only provides one when started with the
 * docker socket mounted. The two are separate gates so the "describe works but
 * create is rejected" middle case (RDS R35 shape) is verified as its own test:
 * the list renders normally while a create surfaces an error banner.
 */
describe("opensearch", () => {
  const os: OpenSearchClient = makeOpenSearchClient(E2E_ENDPOINT);
  const stamp = Date.now() % 100000;
  const domainName = (tag: string) => `nlsd-os-${tag}-${stamp}`;

  async function gotoDashboard(): Promise<void> {
    await navigateHash("#/opensearch");
    await waitDisplayed(T("opensearch-dashboard-heading"));
  }

  async function gotoDomains(): Promise<void> {
    await navigateHash("#/opensearch/domains");
    await waitDisplayed(T("opensearch-domains-heading"));
  }

  before(async () => {
    await setupActiveConnection({
      name: "opensearch-conn",
      endpoint: E2E_ENDPOINT,
      region: "ap-northeast-1",
    });
  });

  after(() => {
    expectCovered("R87-R88");
  });

  // --- R87: domain lifecycle on a create-capable emulator ---------------------

  it("R87: UI creates a domain (SDK-verified), shows its detail, then deletes it", async function () {
    await gate(this, "R87-R88", { on: ["opensearch.domains", "opensearch.create"] });
    const name = domainName("87");

    await gotoDomains();
    await clickT("opensearch-create");
    await setValueT("os-name", name);
    await clickT("os-save");

    // The row appears as soon as CreateDomain returns a (processing) status.
    await waitDisplayed(T(`opensearch-row-${name}`), 60000);

    // SDK back-check: the domain really exists on the emulator.
    const described = await os.send(new DescribeDomainCommand({ DomainName: name }));
    expect(described.DomainStatus?.DomainName).toBe(name);

    // Detail page shows endpoint / status / engine version fields.
    await $(T(`opensearch-row-${name}`)).click();
    await waitDisplayed(T("os-detail-heading"));
    await waitDisplayed(T("os-detail-status"));
    await waitDisplayed(T("os-detail-endpoint"));
    await waitDisplayed(T("os-detail-engine"));

    // Delete via the row action + name-confirmation modal.
    await gotoDomains();
    const row = `//tr[.//*[@data-testid="opensearch-row-${name}"]]`;
    await $(row).$(T("opensearch-delete")).click();
    await setValueT("opensearch-delete-input", name);
    await clickT("opensearch-delete-confirm");
    await browser.waitUntil(
      async () => !(await $(T(`opensearch-row-${name}`)).isExisting()),
      { timeout: 60000, interval: 2000, timeoutMsg: `domain ${name} was not removed` },
    );

    // Best-effort SDK cleanup in case deletion is asynchronous on this emulator.
    await os.send(new DeleteDomainCommand({ DomainName: name })).catch(() => {});
  });

  // --- R88: unsupported emulator (kumo) ---------------------------------------

  it("R88: shows the opensearch-unsupported banner and hides the create action", async function () {
    await gate(this, "R87-R88", { off: ["opensearch.domains"] });

    await gotoDashboard();
    await waitDisplayed(T("opensearch-unsupported"));
    await expect($(T("opensearch-dash-create"))).not.toBeExisting();

    await navigateHash("#/opensearch/domains");
    await waitDisplayed(T("opensearch-unsupported"));
    await expect($(T("opensearch-create"))).not.toBeExisting();
  });

  // --- R88: describe-ok / create-rejected middle case (RDS R35 shape) ---------

  it("R88: lists domains but surfaces an error banner when a create is rejected", async function () {
    await gate(this, "R87-R88", {
      on: ["opensearch.domains"],
      off: ["opensearch.create"],
    });

    await gotoDomains();
    // The list renders normally: create action present, no unsupported takeover.
    await waitDisplayed(T("opensearch-create"));
    await expect($(T("opensearch-unsupported"))).not.toBeExisting();

    await clickT("opensearch-create");
    await setValueT("os-name", domainName("88"));
    await clickT("os-save");
    await waitDisplayed(T("error-banner"));

    // Ensure no half-created domain lingers (create was rejected, but be safe).
    await os
      .send(new ListDomainNamesCommand({}))
      .then((out) =>
        Promise.all(
          (out.DomainNames ?? [])
            .filter((d) => d.DomainName === domainName("88"))
            .map((d) => os.send(new DeleteDomainCommand({ DomainName: d.DomainName }))),
        ),
      )
      .catch(() => {});
  });
});
