import {
  AdminCreateUserCommand,
  type CognitoIdentityProviderClient,
  CreateUserPoolCommand,
  DeleteUserPoolCommand,
  ListGroupsCommand,
  ListUserPoolClientsCommand,
  ListUserPoolsCommand,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { $, browser, expect } from "@wdio/globals";
import {
  T,
  clickT,
  gotoCognitoDashboard,
  gotoUserPoolDetail,
  gotoUserPools,
  setValueT,
  setupActiveConnection,
  waitDisplayed,
} from "../helpers/app";
import { E2E_ENDPOINT, makeCognitoClient } from "../helpers/aws";
import { expectCovered, expectCoveredIf, gate } from "../helpers/capabilities";

/**
 * Cognito requirements (R60-R62), gated per capability (see
 * helpers/capabilities.ts). localstack:3 CE answers every cognito-idp action
 * with a "pro feature" error, so the whole service falls back to the
 * cognito-unsupported banner there. kumo implements user pools + app clients +
 * admin create/delete user, but NOT groups or admin password/enable/disable
 * (InvalidAction) — those are gated separately so every emulator stays green.
 *
 *   R60 UI creates a pool -> SDK-verify -> UI delete; unsupported emulators show
 *       the cognito-unsupported banner with the create action hidden.
 *   R61 Users tab: UI AdminCreateUser -> SDK-verify -> set password + toggle
 *       enable/disable -> UI delete. Password/toggle gated on adminUserState.
 *   R62 App clients + groups tabs: create/list/delete each; groups gated on
 *       cognito.groups (kumo shows the groups-unsupported notice).
 */
describe("cognito", () => {
  const cog: CognitoIdentityProviderClient = makeCognitoClient(E2E_ENDPOINT);
  const stamp = Date.now();
  const createdPoolIds: string[] = [];

  /** Create a pool via the SDK and return its id (tracked for cleanup). */
  async function seedPool(name: string): Promise<string> {
    const { UserPool } = await cog.send(new CreateUserPoolCommand({ PoolName: name }));
    const id = UserPool?.Id as string;
    createdPoolIds.push(id);
    return id;
  }

  before(async () => {
    await setupActiveConnection({
      name: "cognito-conn",
      endpoint: E2E_ENDPOINT,
      region: "ap-northeast-1",
    });
  });

  after(async () => {
    for (const id of createdPoolIds) {
      try {
        await cog.send(new DeleteUserPoolCommand({ UserPoolId: id }));
      } catch {
        /* best effort */
      }
    }
    expectCovered("R60");
    // R61/R62 exercise the pool detail page, which only exists where user pools
    // are supported; otherwise R60's unsupported banner is the only assertion.
    await expectCoveredIf("R61", ["cognito.userPools"]);
    await expectCoveredIf("R62", ["cognito.userPools"]);
  });

  // --- R60: pool lifecycle vs the unsupported banner --------------------------

  describe("user pools (R60)", () => {
    it("R60: UI creates a pool that the SDK sees, then deletes it", async function () {
      await gate(this, "R60", { on: ["cognito.userPools"] });
      const name = `pool60-${stamp}`;

      await gotoUserPools();
      await clickT("pools-create");
      await setValueT("cp-name", name);
      await clickT("cp-save");
      await waitDisplayed(T(`pool-link-${name}`));

      // SDK cross-check: the pool exists.
      await browser.waitUntil(
        async () => {
          const out = await cog.send(new ListUserPoolsCommand({ MaxResults: 60 }));
          return (out.UserPools ?? []).some((p) => p.Name === name);
        },
        { timeout: 20000, timeoutMsg: `pool ${name} was not created` },
      );

      // Delete from the list (name-confirmation modal).
      const box = await waitDisplayed(`[aria-label="${name} を選択"]`);
      await box.click();
      await clickT("pools-delete");
      await setValueT("pools-delete-input", name);
      await clickT("pools-delete-confirm");
      await browser.waitUntil(async () => !(await $(T(`pool-link-${name}`)).isExisting()), {
        timeout: 20000,
        timeoutMsg: `pool ${name} was not removed from the list`,
      });

      await browser.waitUntil(
        async () => {
          const out = await cog.send(new ListUserPoolsCommand({ MaxResults: 60 }));
          return !(out.UserPools ?? []).some((p) => p.Name === name);
        },
        { timeout: 20000, timeoutMsg: `pool ${name} still exists after delete` },
      );
    });

    it("R60: shows the cognito-unsupported banner and hides create", async function () {
      await gate(this, "R60", { off: ["cognito.userPools"] });
      await gotoUserPools();
      await waitDisplayed(T("cognito-unsupported"));
      await expect($(T("pools-create"))).not.toBeExisting();

      // The dashboard shows the same takeover banner.
      await gotoCognitoDashboard();
      await waitDisplayed(T("cognito-unsupported"));
      await expect($(T("cognito-dash-create"))).not.toBeExisting();
    });
  });

  // --- R61: users tab --------------------------------------------------------

  describe("users (R61)", () => {
    it("R61: creates a user via the UI, lists it, then deletes it", async function () {
      await gate(this, "R61", { on: ["cognito.userPools"] });
      const poolId = await seedPool(`pool61-${stamp}`);
      const username = `u61-${stamp}`;

      await gotoUserPoolDetail(poolId);
      await clickT("user-create");
      await setValueT("cu-username", username);
      await setValueT("cu-email", `${username}@example.com`);
      await clickT("cu-save");
      await waitDisplayed(T(`user-row-${username}`));

      // SDK cross-check: the user exists.
      const out = await cog.send(new ListUsersCommand({ UserPoolId: poolId }));
      expect((out.Users ?? []).some((u) => u.Username === username)).toBe(true);

      // Delete via the row action (username-confirmation modal).
      await clickT(`user-delete-${username}`);
      await setValueT("user-delete-input", username);
      await clickT("user-delete-confirm");
      await browser.waitUntil(async () => !(await $(T(`user-row-${username}`)).isExisting()), {
        timeout: 20000,
        timeoutMsg: `user ${username} was not removed`,
      });
    });

    it("R61: sets a password and toggles enable/disable", async function () {
      await gate(this, "R61", { on: ["cognito.userPools", "cognito.adminUserState"] });
      const poolId = await seedPool(`pool61s-${stamp}`);
      const username = `u61s-${stamp}`;
      await cog.send(
        new AdminCreateUserCommand({
          UserPoolId: poolId,
          Username: username,
          MessageAction: "SUPPRESS",
        }),
      );

      await gotoUserPoolDetail(poolId);
      await waitDisplayed(T(`user-row-${username}`));

      // Set a permanent password: the modal closes without an error banner.
      await clickT(`user-set-password-${username}`);
      await setValueT("sp-password", "PermPass123!");
      await clickT("sp-save");
      await $(T("sp-password")).waitForExist({ reverse: true, timeout: 15000 });
      await expect($(T("error-banner"))).not.toBeExisting();

      // Disable then re-enable; the row reflects the state each time.
      await clickT(`user-disable-${username}`);
      // The data-testid sits on the <tr> itself, so select the row directly.
      const row = `//tr[@data-testid="user-row-${username}"]`;
      // The row briefly detaches while the list refetches after the toggle;
      // tolerate a transiently missing element instead of throwing.
      const rowText = async () => $(row).getText().catch(() => "");
      await browser.waitUntil(async () => (await rowText()).includes("無効"), {
        timeout: 20000,
        timeoutMsg: `user ${username} never showed 無効`,
      });
      await clickT(`user-enable-${username}`);
      await browser.waitUntil(async () => (await rowText()).includes("有効"), {
        timeout: 20000,
        timeoutMsg: `user ${username} never showed 有効`,
      });
    });

    it("R61: surfaces an error banner when set-password is unsupported", async function () {
      await gate(this, "R61", {
        on: ["cognito.userPools"],
        off: ["cognito.adminUserState"],
      });
      const poolId = await seedPool(`pool61u-${stamp}`);
      const username = `u61u-${stamp}`;
      await cog.send(
        new AdminCreateUserCommand({
          UserPoolId: poolId,
          Username: username,
          MessageAction: "SUPPRESS",
        }),
      );

      await gotoUserPoolDetail(poolId);
      await clickT(`user-set-password-${username}`);
      await setValueT("sp-password", "PermPass123!");
      await clickT("sp-save");
      await waitDisplayed(T("error-banner"));
    });
  });

  // --- R62: app clients + groups ---------------------------------------------

  describe("app clients & groups (R62)", () => {
    it("R62: app clients tab creates, lists and deletes a client", async function () {
      await gate(this, "R62", { on: ["cognito.userPools"] });
      const poolId = await seedPool(`pool62c-${stamp}`);
      const clientName = `client62-${stamp}`;

      await gotoUserPoolDetail(poolId);
      await clickT("tab-app-clients");
      await clickT("client-create");
      await setValueT("cc-name", clientName);
      await clickT("cc-save");
      await waitDisplayed(T(`client-row-${clientName}`));

      // SDK cross-check.
      const out = await cog.send(new ListUserPoolClientsCommand({ UserPoolId: poolId, MaxResults: 60 }));
      expect((out.UserPoolClients ?? []).some((c) => c.ClientName === clientName)).toBe(true);

      // Delete via the row action (name-confirmation modal).
      await clickT(`client-delete-${clientName}`);
      await setValueT("clients-delete-input", clientName);
      await clickT("clients-delete-confirm");
      await browser.waitUntil(async () => !(await $(T(`client-row-${clientName}`)).isExisting()), {
        timeout: 20000,
        timeoutMsg: `client ${clientName} was not removed`,
      });
    });

    it("R62: groups tab creates and lists a group", async function () {
      await gate(this, "R62", { on: ["cognito.userPools", "cognito.groups"] });
      const poolId = await seedPool(`pool62g-${stamp}`);
      const groupName = `group62-${stamp}`;

      await gotoUserPoolDetail(poolId);
      await clickT("tab-groups");
      await clickT("group-create");
      await setValueT("cg-name", groupName);
      await setValueT("cg-desc", "e2e group");
      await clickT("cg-save");
      await waitDisplayed(T(`group-row-${groupName}`));

      // SDK cross-check.
      const out = await cog.send(new ListGroupsCommand({ UserPoolId: poolId }));
      expect((out.Groups ?? []).some((g) => g.GroupName === groupName)).toBe(true);
    });

    it("R62: groups tab shows the unsupported notice when groups are unsupported", async function () {
      await gate(this, "R62", {
        on: ["cognito.userPools"],
        off: ["cognito.groups"],
      });
      const poolId = await seedPool(`pool62gu-${stamp}`);

      await gotoUserPoolDetail(poolId);
      await clickT("tab-groups");
      await waitDisplayed(T("cognito-groups-unsupported"));
      await expect($(T("group-create"))).not.toBeExisting();
    });
  });
});
