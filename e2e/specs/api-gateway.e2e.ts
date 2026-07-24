import {
  type APIGatewayClient,
  CreateResourceCommand,
  CreateRestApiCommand,
  DeleteApiKeyCommand,
  DeleteRestApiCommand,
  GetApiKeysCommand,
  GetMethodCommand,
  GetResourcesCommand,
  GetRestApisCommand,
  GetStagesCommand,
  PutIntegrationCommand,
  PutMethodCommand,
} from "@aws-sdk/client-api-gateway";
import { $, browser, expect } from "@wdio/globals";
import {
  T,
  clickT,
  gotoApiDetail,
  gotoApiKeys,
  gotoApigwDashboard,
  gotoApis,
  setValueT,
  setSelectValue,
  setupActiveConnection,
  waitDisplayed,
} from "../helpers/app";
import { E2E_ENDPOINT, makeApiGatewayClient } from "../helpers/aws";
import { expectCovered, gate } from "../helpers/capabilities";

/**
 * API Gateway requirements (R56-R59). Fixtures are seeded / verified directly
 * through the AWS SDK; the UI is exercised for the behaviour under test.
 *   R56 SDK-seed an API -> the list + dashboard show it; UI create -> SDK verify;
 *       UI delete -> SDK verify gone.
 *   R57 UI create a resource + a MOCK GET method -> SDK GetMethod verifies both.
 *   R58 SDK-seed api+resource+method -> UI create a deployment (stage) -> the
 *       stages tab lists it (+ reference invoke URL) and SDK GetStages confirms.
 *   R59 API-key CRUD, gated on `apigateway.apiKeys`: supported side does UI
 *       create/list/delete + SDK verify; unsupported side asserts the banner.
 */
describe("api-gateway", () => {
  const client: APIGatewayClient = makeApiGatewayClient(E2E_ENDPOINT);
  const stamp = Date.now();
  const createdApis: string[] = [];
  const createdKeys: string[] = [];

  async function seedApi(name: string): Promise<string> {
    const { id } = await client.send(new CreateRestApiCommand({ name }));
    const apiId = id as string;
    createdApis.push(apiId);
    return apiId;
  }

  async function rootResourceId(apiId: string): Promise<string> {
    const res = await client.send(new GetResourcesCommand({ restApiId: apiId }));
    const root = (res.items ?? []).find((r) => r.path === "/");
    return root?.id as string;
  }

  before(async () => {
    await setupActiveConnection({
      name: "apigw-conn",
      endpoint: E2E_ENDPOINT,
      region: "ap-northeast-1",
    });
  });

  after(async () => {
    for (const id of createdApis) {
      try {
        await client.send(new DeleteRestApiCommand({ restApiId: id }));
      } catch {
        /* best effort */
      }
    }
    for (const id of createdKeys) {
      try {
        await client.send(new DeleteApiKeyCommand({ apiKey: id }));
      } catch {
        /* best effort */
      }
    }
    expectCovered("R56");
    expectCovered("R57");
    expectCovered("R58");
    expectCovered("R59");
  });

  it("R56: lists a seeded API, dashboard summarises, UI create + delete round-trip", async () => {
    const seededName = `api56-${stamp}`;
    const seededId = await seedApi(seededName);

    await gotoApis();
    await waitDisplayed(T(`api-link-${seededId}`));

    // Dashboard shows the API count (>=1) and an API-key card.
    await gotoApigwDashboard();
    await waitDisplayed(T("apigw-dash-keys"));
    await browser.waitUntil(
      async () => {
        await gotoApigwDashboard();
        const count = Number((await $(T("apigw-dash-apis")).getText()).replace(/[^\d]/g, ""));
        return count >= 1;
      },
      { timeout: 30000, interval: 2000, timeoutMsg: "dashboard never showed an API count" },
    );

    // UI create -> SDK verify the API now exists.
    const createdName = `api56c-${stamp}`;
    await gotoApis();
    await clickT("apis-create");
    await setValueT("api-name", createdName);
    await clickT("api-save");
    await browser.waitUntil(
      async () => {
        const res = await client.send(new GetRestApisCommand({ limit: 500 }));
        return (res.items ?? []).some((a) => a.name === createdName);
      },
      { timeout: 20000, timeoutMsg: "created API never appeared via SDK" },
    );
    const created = (await client.send(new GetRestApisCommand({ limit: 500 }))).items?.find(
      (a) => a.name === createdName,
    );
    createdApis.push(created?.id as string);

    // UI delete the seeded API -> SDK verify it is gone.
    await gotoApis();
    const box = await waitDisplayed(`[aria-label="${seededName} を選択"]`);
    await box.click();
    await clickT("apis-delete");
    await setValueT("apis-delete-input", seededName);
    await clickT("apis-delete-confirm");
    await browser.waitUntil(
      async () => !(await $(T(`api-link-${seededId}`)).isExisting()),
      { timeout: 20000, timeoutMsg: "deleted API was not removed from the list" },
    );
    const after = await client.send(new GetRestApisCommand({ limit: 500 }));
    expect((after.items ?? []).some((a) => a.id === seededId)).toBe(false);
  });

  it("R57: UI create a resource + a MOCK GET method, SDK verifies both", async () => {
    const apiId = await seedApi(`api57-${stamp}`);

    await gotoApiDetail(apiId);
    // Wait for the resource tree to load the root resource.
    await waitDisplayed(T("resource-row"));

    // Create a child resource "demo" under root (parent select defaults to "/").
    await clickT("resource-create");
    await setValueT("resource-path-part", "demo");
    await clickT("resource-save");
    await browser.waitUntil(
      async () => {
        const res = await client.send(new GetResourcesCommand({ restApiId: apiId }));
        return (res.items ?? []).some((r) => r.path === "/demo");
      },
      { timeout: 20000, timeoutMsg: "created resource never appeared via SDK" },
    );
    const demo = (await client.send(new GetResourcesCommand({ restApiId: apiId }))).items?.find(
      (r) => r.path === "/demo",
    );
    const demoId = demo?.id as string;

    // Create a MOCK GET method on /demo via the UI.
    await clickT("method-create");
    await setSelectValue("method-resource", demoId);
    await setSelectValue("method-http", "GET");
    await setSelectValue("method-kind", "mock");
    await clickT("method-save");

    // SDK GetMethod confirms the method + MOCK integration exist (works on all
    // emulators, including floci where GetResources omits resourceMethods).
    await browser.waitUntil(
      async () => {
        try {
          const m = await client.send(
            new GetMethodCommand({ restApiId: apiId, resourceId: demoId, httpMethod: "GET" }),
          );
          return m.httpMethod === "GET" && m.methodIntegration?.type === "MOCK";
        } catch {
          return false;
        }
      },
      { timeout: 20000, timeoutMsg: "MOCK GET method was not created" },
    );
  });

  it("R58: UI creates a deployment/stage; stages tab + SDK confirm it", async () => {
    // Seed an API with a resource + method so a deployment is valid everywhere.
    const apiId = await seedApi(`api58-${stamp}`);
    const rootId = await rootResourceId(apiId);
    const { id: resId } = await client.send(
      new CreateResourceCommand({ restApiId: apiId, parentId: rootId, pathPart: "demo" }),
    );
    await client.send(
      new PutMethodCommand({
        restApiId: apiId,
        resourceId: resId as string,
        httpMethod: "GET",
        authorizationType: "NONE",
      }),
    );
    await client.send(
      new PutIntegrationCommand({
        restApiId: apiId,
        resourceId: resId as string,
        httpMethod: "GET",
        type: "MOCK",
        requestTemplates: { "application/json": '{"statusCode": 200}' },
      }),
    );

    await gotoApiDetail(apiId);
    await clickT("tab-stages");
    await clickT("stage-deploy");
    await setValueT("deploy-stage-name", "dev");
    await clickT("deploy-save");

    // The stages tab lists the new stage with a reference invoke URL.
    await waitDisplayed(T("stage-name-dev"));
    const invokeUrl = await $(T("invoke-url-dev")).getText();
    expect(invokeUrl).toContain(apiId);
    expect(invokeUrl).toContain("dev");

    // SDK confirms the stage exists.
    await browser.waitUntil(
      async () => {
        const s = await client.send(new GetStagesCommand({ restApiId: apiId }));
        return (s.item ?? []).some((st) => st.stageName === "dev");
      },
      { timeout: 20000, timeoutMsg: "stage was not created" },
    );
  });

  it("R59: API-key CRUD round-trips through the UI (supported)", async function () {
    // Full CRUD, gated on both create/list AND delete support: ministack +
    // localstack. floci creates/lists keys but mis-routes delete to S3, so it
    // takes the partial branch below instead.
    await gate(this, "R59", { on: ["apigateway.apiKeys", "apigateway.apiKeyDelete"] });

    const keyName = `key59-${stamp}`;
    await gotoApiKeys();
    await clickT("api-keys-create");
    await setValueT("key-name", keyName);
    await clickT("key-save");

    // SDK verifies the key now exists; record it for cleanup.
    await browser.waitUntil(
      async () => {
        const res = await client.send(new GetApiKeysCommand({ limit: 500 }));
        return (res.items ?? []).some((k) => k.name === keyName);
      },
      { timeout: 20000, timeoutMsg: "created API key never appeared via SDK" },
    );
    const created = (await client.send(new GetApiKeysCommand({ limit: 500 }))).items?.find(
      (k) => k.name === keyName,
    );
    const keyId = created?.id as string;
    createdKeys.push(keyId);
    await waitDisplayed(T(`apikey-name-${keyId}`));

    // UI delete -> SDK verify gone.
    const box = await waitDisplayed(`[aria-label="${keyName} を選択"]`);
    await box.click();
    await clickT("api-keys-delete");
    await setValueT("api-keys-delete-input", keyName);
    await clickT("api-keys-delete-confirm");
    await browser.waitUntil(
      async () => {
        const res = await client.send(new GetApiKeysCommand({ limit: 500 }));
        return !(res.items ?? []).some((k) => k.id === keyId);
      },
      { timeout: 20000, timeoutMsg: "deleted API key still present via SDK" },
    );
  });

  it("R59: API-key create + list work where delete is unsupported (partial)", async function () {
    // floci: create/list are implemented but DeleteApiKey mis-routes to S3.
    // Mirror the RDS "describe-capable but not full-lifecycle" partial pattern:
    // the page lists keys and a UI create round-trips; delete is not exercised.
    await gate(this, "R59", { on: ["apigateway.apiKeys"], off: ["apigateway.apiKeyDelete"] });

    const keyName = `key59p-${stamp}`;
    await gotoApiKeys();
    await clickT("api-keys-create");
    await setValueT("key-name", keyName);
    await clickT("key-save");

    // SDK verifies the key now exists; record it for best-effort cleanup.
    await browser.waitUntil(
      async () => {
        const res = await client.send(new GetApiKeysCommand({ limit: 500 }));
        return (res.items ?? []).some((k) => k.name === keyName);
      },
      { timeout: 20000, timeoutMsg: "created API key never appeared via SDK" },
    );
    const created = (await client.send(new GetApiKeysCommand({ limit: 500 }))).items?.find(
      (k) => k.name === keyName,
    );
    createdKeys.push(created?.id as string);

    // The key is rendered in the list (no unsupported banner on this emulator).
    await waitDisplayed(T(`apikey-name-${created?.id as string}`));
    await expect($(T("api-gateway-unsupported"))).not.toBeExisting();
  });

  it("R59: API-key page shows the unsupported notice (unsupported)", async function () {
    await gate(this, "R59", { off: ["apigateway.apiKeys"] });

    await gotoApiKeys();
    await waitDisplayed(T("api-gateway-unsupported"));
    await expect($(T("api-keys-create"))).not.toBeExisting();
  });
});
