import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CreateFunctionCommand,
  DeleteFunctionCommand,
  DeleteLayerVersionCommand,
  GetFunctionCommand,
  GetFunctionConfigurationCommand,
  type LambdaClient,
  ListLayerVersionsCommand,
} from "@aws-sdk/client-lambda";
import { $, browser, expect } from "@wdio/globals";
import {
  E2E_ENDPOINT,
  T,
  clickT,
  gotoUntil,
  navigateHash,
  setValueT,
  setupActiveConnection,
  waitDisplayed,
} from "../helpers/app";
import { makeLambdaClient } from "../helpers/aws";
import { expectCovered, gate, markCovered } from "../helpers/capabilities";
import { buildHandlerZip } from "../helpers/lambdaZip";

/**
 * Lambda requirements (R51-R55). Fixtures are seeded / verified through the AWS
 * SDK; the UI is exercised for the behaviour under test (spec §3.1).
 *   R51 Dashboard summarises functions / layers / total code size.
 *   R52 Functions list (SDK seed), UI create (zip path seam) -> SDK verify, UI delete.
 *   R53 Detail tabs: overview, config edit -> SDK verify, code re-upload -> sha changes.
 *   R54 Test tab: invoke -> status/payload/logs (gated lambda.invoke; kumo shows error).
 *   R55 Layers: UI publish (zip seam) -> SDK verify, delete (gated lambda.layers).
 */
async function gotoLambdaDashboard(): Promise<void> {
  await navigateHash("#/lambda");
  await waitDisplayed(T("lambda-dashboard-heading"));
}
async function gotoFunctions(): Promise<void> {
  await navigateHash("#/lambda/functions");
  await waitDisplayed(T("functions-heading"));
}
async function gotoFunctionDetail(name: string): Promise<void> {
  await navigateHash(`#/lambda/functions/${encodeURIComponent(name)}`);
  await waitDisplayed(T("tab-overview"));
}
async function gotoLayers(): Promise<void> {
  await navigateHash("#/lambda/layers");
  await waitDisplayed(T("layers-heading"));
}

const ROLE = "arn:aws:iam::000000000000:role/nlsd-dummy";

describe("lambda", () => {
  const client: LambdaClient = makeLambdaClient(E2E_ENDPOINT);
  const stamp = Date.now();
  const createdFns: string[] = [];
  const createdLayers: string[] = [];

  // Two distinct fixture zips so a code re-upload changes CodeSha256.
  const zipV1 = join(tmpdir(), `nlsd-lambda-v1-${stamp}.zip`);
  const zipV2 = join(tmpdir(), `nlsd-lambda-v2-${stamp}.zip`);

  async function seedFunction(name: string): Promise<void> {
    await client.send(
      new CreateFunctionCommand({
        FunctionName: name,
        Runtime: "python3.12",
        Role: ROLE,
        Handler: "index.handler",
        Code: { ZipFile: buildHandlerZip() },
      }),
    );
    createdFns.push(name);
  }

  async function waitActive(name: string): Promise<void> {
    await browser.waitUntil(
      async () => {
        const got = await client.send(new GetFunctionCommand({ FunctionName: name }));
        return got.Configuration?.State === "Active";
      },
      { timeout: 60000, interval: 2000, timeoutMsg: `function ${name} never became Active` },
    );
  }

  async function setUploadPath(path: string): Promise<void> {
    await browser.execute((p: string) => {
      (window as unknown as { __E2E_UPLOAD_PATH?: string }).__E2E_UPLOAD_PATH = p;
    }, path);
  }

  before(async () => {
    writeFileSync(zipV1, buildHandlerZip());
    // A different handler body -> different CodeSha256.
    writeFileSync(
      zipV2,
      buildHandlerZip("index.py", 'def handler(event, context):\n    return {"v": 2, "echo": event}\n'),
    );
    await setupActiveConnection({
      name: "lambda-conn",
      endpoint: E2E_ENDPOINT,
      region: "ap-northeast-1",
    });
  });

  after(async () => {
    for (const name of createdFns) {
      await client.send(new DeleteFunctionCommand({ FunctionName: name })).catch(() => {});
    }
    for (const name of createdLayers) {
      try {
        const versions = await client.send(new ListLayerVersionsCommand({ LayerName: name }));
        for (const v of versions.LayerVersions ?? []) {
          if (v.Version !== undefined) {
            await client
              .send(
                new DeleteLayerVersionCommand({ LayerName: name, VersionNumber: v.Version }),
              )
              .catch(() => {});
          }
        }
      } catch {
        /* best effort */
      }
    }
    expectCovered("R51");
    expectCovered("R52");
    expectCovered("R53");
    expectCovered("R54");
    expectCovered("R55");
  });

  it("R51: dashboard summarises functions and the create quick action opens the modal", async () => {
    markCovered("R51");
    const name = `fn51-${stamp}`;
    await seedFunction(name);

    await gotoLambdaDashboard();
    await waitDisplayed(T("lambda-dash-functions"));
    await waitDisplayed(T("lambda-dash-layers"));
    await waitDisplayed(T("lambda-dash-codesize"));
    await browser.waitUntil(
      async () => {
        await gotoLambdaDashboard();
        const count = Number((await $(T("lambda-dash-functions")).getText()).replace(/[^\d]/g, ""));
        return count >= 1;
      },
      { timeout: 30000, interval: 2000, timeoutMsg: "dashboard never showed a function count" },
    );

    await clickT("lambda-dash-create");
    await waitDisplayed(T("fn-name"));
  });

  it("R52: lists a seeded function, UI-creates one (SDK verify) and deletes it", async () => {
    markCovered("R52");
    const seeded = `fn52a-${stamp}`;
    await seedFunction(seeded);

    // The emulator can be eventually consistent; re-navigate until the seeded
    // function surfaces on the freshly fetched list.
    await gotoUntil(gotoFunctions, `fn-link-${seeded}`);

    // --- UI create via the zip path seam --------------------------------------
    const created = `fn52b-${stamp}`;
    await clickT("lambda-create");
    await setValueT("fn-name", created);
    await setValueT("fn-handler", "index.handler");
    await setUploadPath(zipV1);
    await clickT("fn-zip");
    await waitDisplayed(T("fn-zip-name"));
    await clickT("fn-save");
    await waitDisplayed(T(`fn-link-${created}`));
    createdFns.push(created);

    // SDK verify the created function's configuration.
    const got = await client.send(new GetFunctionCommand({ FunctionName: created }));
    expect(got.Configuration?.Runtime).toBe("python3.12");
    expect(got.Configuration?.Handler).toBe("index.handler");
    expect(got.Configuration?.Role).toBe(ROLE);

    // --- UI delete (name-confirmation modal) ----------------------------------
    const box = await waitDisplayed(`[aria-label="${created} を選択"]`);
    await box.click();
    await clickT("functions-delete");
    await setValueT("lambda-delete-input", created);
    await clickT("lambda-delete-confirm");
    await browser.waitUntil(async () => !(await $(T(`fn-link-${created}`)).isExisting()), {
      timeout: 20000,
      timeoutMsg: `function ${created} was not removed from the list`,
    });
    await expect(
      client.send(new GetFunctionCommand({ FunctionName: created })),
    ).rejects.toThrow();
  });

  it("R53: detail overview, config edit (SDK verify) and code re-upload (sha changes)", async () => {
    markCovered("R53");
    const name = `fn53-${stamp}`;
    await seedFunction(name);
    await waitActive(name);

    await gotoFunctionDetail(name);
    // Overview
    await waitDisplayed(T("fn-ov-runtime"));
    expect(await $(T("fn-ov-runtime")).getText()).toContain("python3.12");
    expect(await $(T("fn-ov-handler")).getText()).toContain("index.handler");

    // Config: change memory + add an env var, then SDK-verify.
    await clickT("tab-config");
    await setValueT("fn-cfg-memory", "256");
    await clickT("fn-cfg-env-add");
    await setValueT("fn-cfg-env-key-0", "STAGE");
    await setValueT("fn-cfg-env-value-0", "e2e");
    await clickT("fn-cfg-save");
    await browser.waitUntil(
      async () => {
        const cfg = await client.send(
          new GetFunctionConfigurationCommand({ FunctionName: name }),
        );
        return cfg.MemorySize === 256 && cfg.Environment?.Variables?.STAGE === "e2e";
      },
      { timeout: 30000, interval: 2000, timeoutMsg: "config update was not applied" },
    );
    await waitActive(name);

    // Code: capture the current sha, re-upload a different zip, verify it changed.
    const before = (await client.send(new GetFunctionConfigurationCommand({ FunctionName: name })))
      .CodeSha256;
    await gotoFunctionDetail(name);
    await clickT("tab-code");
    await waitDisplayed(T("fn-code-sha"));
    await setUploadPath(zipV2);
    await clickT("fn-code-zip");
    await waitDisplayed(T("fn-code-zip-name"));
    await clickT("fn-code-upload");
    await browser.waitUntil(
      async () => {
        const cfg = await client.send(
          new GetFunctionConfigurationCommand({ FunctionName: name }),
        );
        return !!cfg.CodeSha256 && cfg.CodeSha256 !== before;
      },
      { timeout: 30000, interval: 2000, timeoutMsg: "CodeSha256 did not change after re-upload" },
    );
  });

  it("R54: test tab invokes the function and shows status, payload and logs", async function () {
    await gate(this, "R54", { on: ["lambda.invoke"] });
    const name = `fn54-${stamp}`;
    await seedFunction(name);
    await waitActive(name);

    await gotoFunctionDetail(name);
    await clickT("tab-test");
    await setValueT("fn-test-payload", '{"key":"value"}');
    await clickT("fn-invoke");

    await browser.waitUntil(async () => $(T("fn-invoke-status")).isExisting(), {
      timeout: 30000,
      timeoutMsg: "invoke result never appeared",
    });
    expect(await $(T("fn-invoke-status")).getText()).toBe("200");
    expect(await $(T("fn-invoke-payload")).getText()).toContain("echo");
    expect(await $(T("fn-invoke-payload")).getText()).toContain("value");
    expect((await $(T("fn-invoke-logs")).getText()).length).toBeGreaterThan(0);
  });

  it("R54: shows an error banner when invoke is unsupported", async function () {
    await gate(this, "R54", { off: ["lambda.invoke"] });
    const name = `fn54u-${stamp}`;
    await seedFunction(name);

    await gotoFunctionDetail(name);
    await clickT("tab-test");
    await setValueT("fn-test-payload", "{}");
    await clickT("fn-invoke");
    await waitDisplayed(T("error-banner"));
    await expect($(T("fn-invoke-status"))).not.toBeExisting();
  });

  it("R55: publishes a layer via the UI (SDK verify) and deletes it", async function () {
    await gate(this, "R55", { on: ["lambda.layers"] });
    const layerName = `layer55-${stamp}`;

    await gotoLayers();
    await clickT("layer-publish");
    await setValueT("layer-name", layerName);
    await setUploadPath(zipV1);
    await clickT("layer-zip");
    await waitDisplayed(T("layer-zip-name"));
    await clickT("layer-save");
    await waitDisplayed(T(`layer-name-${layerName}`));
    createdLayers.push(layerName);

    // SDK verify the published version exists.
    const versions = await client.send(new ListLayerVersionsCommand({ LayerName: layerName }));
    expect((versions.LayerVersions ?? []).length).toBeGreaterThan(0);

    // UI delete the version (name-confirmation modal).
    const box = await waitDisplayed(`[aria-label="${layerName} を選択"]`);
    await box.click();
    await clickT("layers-delete");
    await setValueT("layer-delete-input", layerName);
    await clickT("layer-delete-confirm");
    await browser.waitUntil(
      async () => !(await $(T(`layer-name-${layerName}`)).isExisting()),
      { timeout: 20000, timeoutMsg: `layer ${layerName} was not removed` },
    );
  });

  it("R55: shows the unsupported banner when the layers API is unavailable", async function () {
    await gate(this, "R55", { off: ["lambda.layers"] });
    await gotoLayers();
    await waitDisplayed(T("lambda-layers-unsupported"));
    await expect($(T("layer-publish"))).not.toBeExisting();
  });
});
