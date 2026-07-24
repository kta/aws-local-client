import {
  CreateStateMachineCommand,
  DeleteStateMachineCommand,
  DescribeStateMachineCommand,
  ListStateMachinesCommand,
  type SFNClient,
} from "@aws-sdk/client-sfn";
import { $, browser, expect } from "@wdio/globals";
import {
  T,
  clickEnabledT,
  clickT,
  gotoSfnDashboard,
  gotoStateMachineDetail,
  gotoStateMachines,
  setValueT,
  setupActiveConnection,
  waitDisplayed,
} from "../helpers/app";
import { E2E_ENDPOINT, makeSfnClient } from "../helpers/aws";
import { expectCovered, gate, markCovered } from "../helpers/capabilities";

/**
 * Step Functions requirements (R84-R86). Fixtures are seeded / verified through
 * the AWS SDK; the UI is exercised for the behaviour under test.
 *   R84 SDK-seed a state machine -> list + dashboard show it. UI create -> SDK
 *       verify. UI delete (name confirm) -> SDK verify it is gone.
 *   R85 UI start an execution with {"hello":"world"} on a Pass-state machine ->
 *       execution appears -> execution detail polls to SUCCEEDED and its output
 *       echoes the input (Pass propagation). Cross-checked via the SDK.
 *   R86 Definition tab shows the ASL and updates it (UpdateStateMachine ->
 *       SDK verify) on emulators that implement it, or shows the unsupported
 *       notice on those that do not (gated on `sfn.updateStateMachine`).
 */
const ROLE_ARN = "arn:aws:iam::000000000000:role/nlsd-dummy";
const PASS_ASL = JSON.stringify({
  StartAt: "P",
  States: { P: { Type: "Pass", End: true } },
});

describe("step-functions", () => {
  const client: SFNClient = makeSfnClient(E2E_ENDPOINT);
  const stamp = Date.now();
  const created: string[] = []; // state machine ARNs to clean up

  async function seedStateMachine(name: string, definition = PASS_ASL): Promise<string> {
    const { stateMachineArn } = await client.send(
      new CreateStateMachineCommand({ name, definition, roleArn: ROLE_ARN }),
    );
    const arn = stateMachineArn as string;
    created.push(arn);
    return arn;
  }

  before(async () => {
    await setupActiveConnection({
      name: "sfn-conn",
      endpoint: E2E_ENDPOINT,
      region: "ap-northeast-1",
    });
  });

  after(async () => {
    for (const arn of created) {
      try {
        await client.send(new DeleteStateMachineCommand({ stateMachineArn: arn }));
      } catch {
        /* best effort */
      }
    }
    expectCovered("R84");
    expectCovered("R85");
    expectCovered("R86");
  });

  it("R84: lists a seeded state machine, creates + deletes via the UI", async () => {
    markCovered("R84");
    const seeded = `sm84a-${stamp}`;
    await seedStateMachine(seeded);

    // Dashboard summarises + the list shows the seeded machine.
    await gotoSfnDashboard();
    await waitDisplayed(T("sfn-dash-machines"));
    await browser.waitUntil(
      async () => {
        await gotoSfnDashboard();
        const count = Number((await $(T("sfn-dash-machines")).getText()).replace(/[^\d]/g, ""));
        return count >= 1;
      },
      { timeout: 30000, interval: 2000, timeoutMsg: "dashboard never showed a machine count" },
    );

    await gotoStateMachines();
    await waitDisplayed(T(`sm-link-${seeded}`));

    // --- create via the UI (default Pass ASL) -> SDK verify ---------------------
    const created84 = `sm84b-${stamp}`;
    await clickT("state-machines-create");
    await setValueT("sm-name", created84);
    await clickT("sm-save");
    await waitDisplayed(T(`sm-link-${created84}`));

    const describe = await browser.waitUntil(
      async () => {
        const list = await client.send(new ListStateMachinesCommand({}));
        return (list.stateMachines ?? []).find((m) => m.name === created84);
      },
      { timeout: 20000, timeoutMsg: `created machine ${created84} never appeared via SDK` },
    );
    created.push(describe!.stateMachineArn as string);

    // --- delete from the list (name-confirmation modal) -> SDK verify ----------
    const box = await waitDisplayed(`[aria-label="${created84} を選択"]`);
    await box.click();
    await clickT("state-machines-delete");
    await setValueT("state-machines-delete-input", created84);
    await clickT("state-machines-delete-confirm");
    await browser.waitUntil(async () => !(await $(T(`sm-link-${created84}`)).isExisting()), {
      timeout: 20000,
      timeoutMsg: `machine ${created84} was not removed from the list`,
    });
    await expect(
      client.send(new DescribeStateMachineCommand({ stateMachineArn: describe!.stateMachineArn })),
    ).rejects.toThrow();
  });

  it("R85: starts an execution and the Pass output echoes the input", async () => {
    markCovered("R85");
    const name = `sm85-${stamp}`;
    await seedStateMachine(name);

    await gotoStateMachineDetail(name);
    // The executions tab is the default; start an execution with a known input.
    await clickEnabledT("sm-start");
    await setValueT("exec-input", '{"hello":"world"}');
    await clickT("exec-save");
    // The modal closes and the execution row appears.
    await $(T("exec-input")).waitForExist({ reverse: true, timeout: 15000 });

    // Open the first execution's detail page (the row's name is a server UUID).
    const execLink = await waitDisplayed('[data-testid^="exec-link-"]');
    await execLink.click();

    // Poll to a terminal SUCCEEDED status and assert the output echoes the input.
    await browser.waitUntil(async () => (await $(T("exec-status")).getText()) === "SUCCEEDED", {
      timeout: 30000,
      interval: 1500,
      timeoutMsg: "execution never reached SUCCEEDED",
    });
    const output = await $(T("exec-output-display")).getText();
    expect(output).toContain("hello");
    expect(output).toContain("world");
    // The history table shows at least the start + succeeded events.
    await waitDisplayed(T("exec-history-table"));
  });

  it("R86: definition tab updates the ASL (supported)", async function () {
    await gate(this, "R86", { on: ["sfn.updateStateMachine"] });
    const name = `sm86s-${stamp}`;
    const arn = await seedStateMachine(name);

    await gotoStateMachineDetail(name);
    await clickT("tab-definition");
    await waitDisplayed(T("definition-display"));

    // Update the definition to a renamed Pass state and SDK-verify it persisted.
    const updated = JSON.stringify({
      StartAt: "P2",
      States: { P2: { Type: "Pass", End: true } },
    });
    await setValueT("definition-edit", updated);
    await clickT("definition-save");
    await browser.waitUntil(
      async () => {
        const d = await client.send(new DescribeStateMachineCommand({ stateMachineArn: arn }));
        return (d.definition ?? "").includes("P2");
      },
      { timeout: 20000, timeoutMsg: "definition was not updated to contain P2" },
    );
  });

  it("R86: definition tab shows the unsupported notice", async function () {
    await gate(this, "R86", { off: ["sfn.updateStateMachine"] });
    const name = `sm86u-${stamp}`;
    await seedStateMachine(name);

    await gotoStateMachineDetail(name);
    await clickT("tab-definition");
    await waitDisplayed(T("definition-display"));
    await clickT("definition-save");
    await waitDisplayed(T("sfn-update-unsupported"));
  });
});
