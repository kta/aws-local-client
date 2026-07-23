import {
  CreateSecretCommand,
  DeleteSecretCommand,
  DescribeSecretCommand,
  GetSecretValueCommand,
  type SecretsManagerClient,
  TagResourceCommand,
} from "@aws-sdk/client-secrets-manager";
import { $, browser, expect } from "@wdio/globals";
import {
  E2E_ENDPOINT,
  T,
  clickEnabledT,
  clickT,
  gotoSecretDetail,
  gotoSecrets,
  setValueT,
  setupActiveConnection,
  waitDisplayed,
} from "../helpers/app";
import { makeSecretsManagerClient } from "../helpers/aws";
import { expectCovered, gate } from "../helpers/capabilities";

/**
 * Secrets Manager requirements (R66-R67). Fixtures are seeded / verified
 * directly through the AWS SDK; the UI is exercised for the behaviour under test.
 *   R66 SDK-seed a secret -> the list shows it. UI create -> SDK-verify.
 *       UI delete (immediate/recovery choice, name confirmation) -> row gone +
 *       SDK confirms the secret is scheduled for deletion.
 *   R67 Detail: value masked by default, reveal toggle shows it; UI put a new
 *       version -> SDK-verify the value + the versions table shows two versions;
 *       tags add/remove (gated on `secretsmanager.tags`, symmetric).
 */
describe("secrets-manager", () => {
  const client: SecretsManagerClient = makeSecretsManagerClient(E2E_ENDPOINT);
  const stamp = Date.now();
  const created: string[] = []; // secret names to force-delete on teardown

  async function seedSecret(name: string, secretString: string): Promise<void> {
    await client.send(new CreateSecretCommand({ Name: name, SecretString: secretString }));
    created.push(name);
  }

  before(async () => {
    await setupActiveConnection({
      name: "secrets-conn",
      endpoint: E2E_ENDPOINT,
      region: "ap-northeast-1",
    });
  });

  after(async () => {
    for (const name of created) {
      try {
        await client.send(
          new DeleteSecretCommand({ SecretId: name, ForceDeleteWithoutRecovery: true }),
        );
      } catch {
        /* best effort */
      }
    }
    expectCovered("R67-tags");
  });

  it("R66: lists a seeded secret, UI-creates one (SDK verify), UI-deletes (recovery)", async () => {
    const seeded = `sm66-seed-${stamp}`;
    await seedSecret(seeded, '{"k":"seed"}');

    await gotoSecrets();
    await waitDisplayed(T(`secret-link-${seeded}`));

    // --- UI create -> SDK verify --------------------------------------------
    const name = `sm66-create-${stamp}`;
    await clickT("secrets-create");
    await setValueT("cs-name", name);
    await setValueT("cs-value", '{"user":"admin"}');
    await setValueT("cs-description", "created from UI");
    await clickT("cs-save");
    await waitDisplayed(T(`secret-link-${name}`));
    created.push(name);

    const got = await client.send(new GetSecretValueCommand({ SecretId: name }));
    expect(got.SecretString).toBe('{"user":"admin"}');

    // --- UI delete (recovery-window choice, name confirmation) --------------
    const box = await waitDisplayed(`[aria-label="${name} を選択"]`);
    await box.click();
    await clickT("secrets-delete");
    // Recovery mode is the default; type the name to enable the confirm.
    await setValueT("secrets-delete-input", name);
    await clickT("secrets-delete-confirm");
    await browser.waitUntil(async () => !(await $(T(`secret-link-${name}`)).isExisting()), {
      timeout: 20000,
      timeoutMsg: `secret ${name} was not removed from the list`,
    });

    // The secret is scheduled for deletion (DeletedDate set), not yet gone.
    const desc = await client.send(new DescribeSecretCommand({ SecretId: name }));
    expect(desc.DeletedDate).toBeDefined();
  });

  it("R67: value is masked by default and the toggle reveals it", async () => {
    const name = `sm67-val-${stamp}`;
    await seedSecret(name, '{"password":"s3cret-val"}');

    await gotoSecretDetail(name);
    // Masked until the reveal toggle is clicked.
    expect(await $(T("secret-value")).getText()).not.toContain("s3cret-val");

    await clickEnabledT("secret-value-toggle");
    await browser.waitUntil(
      async () => (await $(T("secret-value")).getText()).includes("s3cret-val"),
      { timeout: 15000, timeoutMsg: "secret value was not revealed" },
    );
  });

  it("R67: UI put creates a new version (SDK verify) and the versions table shows two", async () => {
    const name = `sm67-ver-${stamp}`;
    await seedSecret(name, '{"v":1}');

    await gotoSecretDetail(name);
    await clickEnabledT("secret-put");
    await setValueT("sv-value", '{"v":2}');
    await clickT("sv-save");
    // Modal closes on success.
    await $(T("sv-value")).waitForExist({ reverse: true, timeout: 15000 });

    // SDK: the current value is the new one.
    await browser.waitUntil(
      async () => {
        const got = await client.send(new GetSecretValueCommand({ SecretId: name }));
        return got.SecretString === '{"v":2}';
      },
      { timeout: 20000, timeoutMsg: "new secret version was not stored" },
    );

    // The versions table lists at least two versions after the put.
    await browser.waitUntil(
      async () => {
        await gotoSecretDetail(name);
        return (
          (await browser.execute(
            () => document.querySelectorAll('[data-testid^="version-row-"]').length,
          )) >= 2
        );
      },
      { timeout: 20000, interval: 1500, timeoutMsg: "versions table never showed two versions" },
    );
  });

  it("R67: tags tab lists, adds and removes a tag", async function () {
    await gate(this, "R67-tags", { on: ["secretsmanager.tags"] });
    const name = `sm67-tag-${stamp}`;
    await seedSecret(name, "{}");
    await client.send(new TagResourceCommand({ SecretId: name, Tags: [{ Key: "env", Value: "prod" }] }));

    await gotoSecretDetail(name);
    // Existing SDK-seeded tag is listed with a remove button.
    await waitDisplayed(T("tag-remove-env"));

    // Add a tag via the UI, then confirm via the SDK.
    await clickT("tag-add");
    await setValueT("tag-key-input", "team");
    await setValueT("tag-value-input", "core");
    await clickT("tag-save");
    await browser.waitUntil(
      async () => {
        const desc = await client.send(new DescribeSecretCommand({ SecretId: name }));
        return (desc.Tags ?? []).some((t) => t.Key === "team");
      },
      { timeout: 20000, timeoutMsg: "added tag was not stored" },
    );

    // Remove the seeded tag via the UI.
    await clickT("tag-remove-env");
    await browser.waitUntil(async () => !(await $(T("tag-remove-env")).isExisting()), {
      timeout: 20000,
      timeoutMsg: "removed tag never disappeared",
    });
  });

  it("R67: tag add shows the error banner on emulators without tag support", async function () {
    await gate(this, "R67-tags", { off: ["secretsmanager.tags"] });
    const name = `sm67-tagu-${stamp}`;
    await seedSecret(name, "{}");

    // Tag listing works everywhere (DescribeSecret), but the mutation fails on
    // emulators lacking TagResource -> the UI surfaces an error banner.
    await gotoSecretDetail(name);
    await clickT("tag-add");
    await setValueT("tag-key-input", "team");
    await setValueT("tag-value-input", "core");
    await clickT("tag-save");
    await waitDisplayed(T("error-banner"));
  });
});
