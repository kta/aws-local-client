import {
  DeleteParameterCommand,
  GetParameterCommand,
  GetParameterHistoryCommand,
  ParameterNotFound,
  PutParameterCommand,
  type SSMClient,
} from "@aws-sdk/client-ssm";
import { $, browser, expect } from "@wdio/globals";
import {
  E2E_ENDPOINT,
  T,
  clickT,
  navigateHash,
  setSelectValue,
  setValueT,
  setupActiveConnection,
  waitDisplayed,
} from "../helpers/app";
import { makeSsmClient } from "../helpers/aws";

/**
 * Systems Manager Parameter Store requirements (R94-R95). Fixtures are seeded /
 * verified directly through the AWS SDK; the UI is exercised for the behaviour
 * under test. SSM Parameter Store is supported on all four emulators (measured),
 * so these tests run unconditionally without capability gates.
 *   R94 UI create String/StringList/SecureString (SDK-verify) -> prefix filter
 *       narrows the list to a path prefix -> UI delete (SDK-verify it is gone).
 *   R95 detail masks a SecureString value then reveals it (WithDecryption),
 *       overwrite via the UI bumps the version, and the history table lists v1
 *       and v2.
 */
describe("ssm", () => {
  const client: SSMClient = makeSsmClient(E2E_ENDPOINT);
  const stamp = Date.now();
  const created: string[] = []; // parameter names to clean up

  async function seedParameter(
    name: string,
    value: string,
    type: "String" | "StringList" | "SecureString",
  ): Promise<void> {
    await client.send(new PutParameterCommand({ Name: name, Value: value, Type: type }));
    created.push(name);
  }

  async function gotoParameters(): Promise<void> {
    await navigateHash("#/ssm/parameters");
    await waitDisplayed(T("parameters-heading"));
    await waitDisplayed(T("parameters-count"));
  }

  async function gotoParameterDetail(name: string): Promise<void> {
    await navigateHash(`#/ssm/parameters/${encodeURIComponent(name)}`);
    await waitDisplayed(T("param-detail-heading"));
  }

  before(async () => {
    await setupActiveConnection({
      name: "ssm-conn",
      endpoint: E2E_ENDPOINT,
      region: "ap-northeast-1",
    });
  });

  after(async () => {
    for (const name of created) {
      try {
        await client.send(new DeleteParameterCommand({ Name: name }));
      } catch {
        /* best effort */
      }
    }
  });

  it("R94: UI creates typed params (SDK verified), prefix filter narrows the list, UI delete removes it", async () => {
    const prefix = `/e2e-ssm-${stamp}`;
    const other = `/other-ssm-${stamp}/x`;
    const plain = `${prefix}/plain`;
    const list = `${prefix}/list`;
    const secure = `${prefix}/secret`;

    // A parameter under a DIFFERENT prefix that the filter must exclude.
    await seedParameter(other, "outsider", "String");

    // --- UI create: String / StringList / SecureString -------------------------
    const createViaUi = async (
      name: string,
      type: "String" | "StringList" | "SecureString",
      value: string,
    ) => {
      await gotoParameters();
      await clickT("params-create");
      await setValueT("param-name", name);
      await setSelectValue("param-type", type);
      await setValueT("param-value", value);
      await clickT("param-save");
      await waitDisplayed(T(`param-link-${name}`));
      created.push(name);
    };

    await createViaUi(plain, "String", "plain-value");
    await createViaUi(list, "StringList", "a,b,c");
    await createViaUi(secure, "SecureString", "s3cret-value");

    // --- SDK verify each parameter's type and value ----------------------------
    const getParam = async (name: string, decrypt = false) =>
      client.send(new GetParameterCommand({ Name: name, WithDecryption: decrypt }));

    const p1 = await getParam(plain);
    expect(p1.Parameter?.Type).toBe("String");
    expect(p1.Parameter?.Value).toBe("plain-value");

    const p2 = await getParam(list);
    expect(p2.Parameter?.Type).toBe("StringList");
    expect(p2.Parameter?.Value).toBe("a,b,c");

    const p3 = await getParam(secure, true);
    expect(p3.Parameter?.Type).toBe("SecureString");
    expect(p3.Parameter?.Value).toBe("s3cret-value");

    // --- prefix filter narrows the list to the shared prefix -------------------
    await gotoParameters();
    // Without the filter the outsider is present.
    await waitDisplayed(T(`param-link-${other}`));
    await setValueT("ssm-prefix-filter", prefix);
    await clickT("ssm-prefix-apply");
    // The three prefixed params remain; the outsider disappears.
    await browser.waitUntil(async () => !(await $(T(`param-link-${other}`)).isExisting()), {
      timeout: 20000,
      timeoutMsg: "prefix filter did not exclude the outsider parameter",
    });
    await waitDisplayed(T(`param-link-${plain}`));
    await waitDisplayed(T(`param-link-${list}`));
    await waitDisplayed(T(`param-link-${secure}`));

    // --- UI delete (name confirmation) -> SDK verifies it is gone --------------
    const box = await waitDisplayed(`[aria-label="${plain} を選択"]`);
    await box.click();
    await clickT("params-delete");
    await setValueT("params-delete-input", plain);
    await clickT("params-delete-confirm");
    await browser.waitUntil(async () => !(await $(T(`param-link-${plain}`)).isExisting()), {
      timeout: 20000,
      timeoutMsg: `parameter ${plain} was not removed from the list`,
    });
    await expect(client.send(new GetParameterCommand({ Name: plain }))).rejects.toThrow(
      ParameterNotFound,
    );
  });

  it("R95: masks a SecureString then reveals it, overwrite bumps the version, history lists v1 and v2", async () => {
    const name = `/e2e-ssm-hist-${stamp}/pw`;
    // Seed version 1 directly through the SDK.
    await seedParameter(name, "secret-v1", "SecureString");

    await gotoParameterDetail(name);

    // --- masked by default, revealed on toggle (WithDecryption) ----------------
    const value = await waitDisplayed(T("ssm-value"));
    expect(await value.getText()).not.toContain("secret-v1");
    await clickT("ssm-value-toggle");
    await browser.waitUntil(async () => (await $(T("ssm-value")).getText()).includes("secret-v1"), {
      timeout: 20000,
      timeoutMsg: "SecureString value was not revealed after toggle",
    });

    // --- overwrite the value via the UI -> version bumps to 2 ------------------
    await setValueT("ssm-update-value", "secret-v2");
    await clickT("ssm-update-save");
    await browser.waitUntil(
      async () => {
        const got = await client.send(
          new GetParameterCommand({ Name: name, WithDecryption: true }),
        );
        return got.Parameter?.Version === 2 && got.Parameter?.Value === "secret-v2";
      },
      { timeout: 20000, timeoutMsg: "parameter was not overwritten to version 2" },
    );

    // --- version history table lists both v1 and v2 ----------------------------
    await gotoParameterDetail(name);
    await waitDisplayed(T("ssm-history-table"));
    await waitDisplayed(T("ssm-history-row-2"));
    await waitDisplayed(T("ssm-history-row-1"));

    // SDK cross-check: history holds exactly two versions.
    const hist = await client.send(
      new GetParameterHistoryCommand({ Name: name, WithDecryption: true }),
    );
    const versions = (hist.Parameters ?? []).map((p) => p.Version).sort();
    expect(versions).toEqual([1, 2]);
  });
});
