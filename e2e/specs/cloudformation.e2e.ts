import {
  CreateStackCommand,
  DeleteStackCommand,
  DescribeStacksCommand,
  type CloudFormationClient,
} from "@aws-sdk/client-cloudformation";
import { ListTopicsCommand, type SNSClient } from "@aws-sdk/client-sns";
import { $, browser, expect } from "@wdio/globals";
import {
  E2E_ENDPOINT,
  T,
  clickT,
  gotoCfnDashboard,
  gotoStackDetail,
  gotoStacks,
  navigateHash,
  setValueT,
  setupActiveConnection,
  waitDisplayed,
} from "../helpers/app";
import { makeCfnClient, makeSnsClient } from "../helpers/aws";
import { expectCovered, gate } from "../helpers/capabilities";

/**
 * CloudFormation requirements (R71-R74).
 *
 * Emulator notes (measured 2026-07-22):
 * - ministack / floci / localstack:3 implement CloudFormation and actually
 *   provision the templated resources; kumo is control-plane only (a stack
 *   reaches CREATE_COMPLETE but the SNS topic it declares never appears), so
 *   "the templated resource really exists" is gated behind
 *   `cloudformation.resourceCreation`.
 * - Resources come from DescribeStackResources (not ListStackResources, whose
 *   response kumo returns as non-XML the SDK cannot parse); outputs and the
 *   template body come back on every emulator, but floci does not echo stack
 *   Parameters. R73 therefore asserts resources/outputs/template robustly and
 *   only render-checks the parameters/events tabs.
 */
describe("cloudformation", () => {
  const cfn: CloudFormationClient = makeCfnClient(E2E_ENDPOINT);
  const sns: SNSClient = makeSnsClient(E2E_ENDPOINT);
  const stamp = Date.now();
  const stacks: string[] = []; // stack names to clean up

  /** JSON template declaring a single SNS topic (+ optional Ref output). */
  function topicTemplate(topicName: string): string {
    return JSON.stringify({
      Resources: {
        ProbeTopic: { Type: "AWS::SNS::Topic", Properties: { TopicName: topicName } },
      },
      Outputs: { TopicRef: { Value: { Ref: "ProbeTopic" } } },
    });
  }

  /** Create a stack via the SDK and remember it for cleanup. */
  async function seedStack(name: string, topicName: string): Promise<void> {
    await cfn.send(
      new CreateStackCommand({ StackName: name, TemplateBody: topicTemplate(topicName) }),
    );
    stacks.push(name);
  }

  /** Wait (bounded) for a stack to reach the wanted status via the SDK. */
  async function waitStatus(name: string, wanted: string): Promise<void> {
    await browser.waitUntil(
      async () => {
        try {
          const out = await cfn.send(new DescribeStacksCommand({ StackName: name }));
          const st = out.Stacks?.[0]?.StackStatus;
          if (st?.endsWith("_FAILED")) throw new Error(`stack ${name} failed: ${st}`);
          return st === wanted;
        } catch {
          return false;
        }
      },
      { timeout: 60000, interval: 2000, timeoutMsg: `stack ${name} never reached ${wanted}` },
    );
  }

  async function topicExists(topicName: string): Promise<boolean> {
    const out = await sns.send(new ListTopicsCommand({}));
    return (out.Topics ?? []).some((t) => (t.TopicArn ?? "").endsWith(`:${topicName}`));
  }

  before(async () => {
    await setupActiveConnection({
      name: "cfn-conn",
      endpoint: E2E_ENDPOINT,
      region: "ap-northeast-1",
    });
  });

  after(async () => {
    for (const name of stacks) {
      try {
        await cfn.send(new DeleteStackCommand({ StackName: name }));
      } catch {
        /* best effort */
      }
    }
    expectCovered("R72");
    expectCovered("R74");
  });

  // --- R71: dashboard + stack list -------------------------------------------

  it("R71: dashboard summarises stacks and the list shows a seeded stack", async () => {
    const name = `cfn71-${stamp}`;
    await seedStack(name, `cfn71topic-${stamp}`);
    await waitStatus(name, "CREATE_COMPLETE");

    await gotoCfnDashboard();
    await waitDisplayed(T("cfn-dash-stacks"));
    await waitDisplayed(T("cfn-dash-complete"));
    await waitDisplayed(T("cfn-dash-failed"));
    await waitDisplayed(T("cfn-dash-create"));
    // The seeded stack contributes at least one stack. Bounce through home each
    // poll so the dashboard actually remounts and refetches (re-setting the same
    // hash is a no-op; some emulators surface ListStacks with a short delay).
    await browser.waitUntil(
      async () => {
        await navigateHash("#/");
        await gotoCfnDashboard();
        // The card renders "スタック数<n>"; strip the label before parsing.
        const n = Number((await $(T("cfn-dash-stacks")).getText()).replace(/[^\d]/g, ""));
        return Number.isFinite(n) && n >= 1;
      },
      {
        timeout: 30000,
        interval: 2000,
        timeoutMsg: "dashboard stack count never reflected the seeded stack",
      },
    );

    // The stack appears in the list view.
    await gotoStacks();
    await waitDisplayed(T(`stack-row-${name}`));
  });

  // --- R72: UI create -> CREATE_COMPLETE -> real resource exists --------------

  it("R72: UI creates a stack whose SNS topic is really provisioned", async function () {
    await gate(this, "R72", { on: ["cloudformation.resourceCreation"] });
    const name = `cfn72-${stamp}`;
    const topic = `cfn72topic-${stamp}`;
    stacks.push(name);

    await gotoStacks();
    await clickT("stacks-create");
    await setValueT("cfn-name", name);
    await setValueT("cfn-template", topicTemplate(topic));
    await clickT("cfn-save");
    await waitDisplayed(T(`stack-row-${name}`));

    // Detail page (fresh fetch) reflects CREATE_COMPLETE once the SDK agrees.
    await waitStatus(name, "CREATE_COMPLETE");
    await gotoStackDetail(name);
    await browser.waitUntil(
      async () => (await $(T("stack-detail-status")).getText()) === "CREATE_COMPLETE",
      { timeout: 30000, timeoutMsg: "detail status never showed CREATE_COMPLETE" },
    );

    // SDK back-check: the templated topic actually exists.
    expect(await topicExists(topic)).toBe(true);
  });

  it("R72: stack creation stays functional where resources are not provisioned", async function () {
    await gate(this, "R72", { off: ["cloudformation.resourceCreation"] });
    const name = `cfn72u-${stamp}`;
    stacks.push(name);

    await gotoStacks();
    await clickT("stacks-create");
    await setValueT("cfn-name", name);
    await setValueT("cfn-template", topicTemplate(`cfn72utopic-${stamp}`));
    await clickT("cfn-save");

    // The create round-trips without an error banner and the stack is listed,
    // even though the emulator never provisions the topic.
    await waitDisplayed(T(`stack-row-${name}`));
    await expect($(T("error-banner"))).not.toBeExisting();
  });

  // --- R73: stack detail tabs -------------------------------------------------

  it("R73: detail tabs show resources, outputs, template, parameters and events", async () => {
    const name = `cfn73-${stamp}`;
    const topic = `cfn73topic-${stamp}`;
    await seedStack(name, topic);
    await waitStatus(name, "CREATE_COMPLETE");

    await gotoStackDetail(name);

    // Resources tab (default) — DescribeStackResources works on every emulator.
    await waitDisplayed(T("resource-row-ProbeTopic"));
    expect(await $(T("resources-table")).getText()).toContain("AWS::SNS::Topic");

    // Outputs tab — outputs come back everywhere.
    await clickT("tab-outputs");
    await waitDisplayed(T("output-row-TopicRef"));

    // Template tab — the body is returned everywhere.
    await clickT("tab-template");
    await browser.waitUntil(
      async () => (await $(T("template-body")).getText()).includes("AWS::SNS::Topic"),
      { timeout: 20000, timeoutMsg: "template body never rendered" },
    );

    // Parameters / events tabs: render-check only (floci omits Parameters, and
    // events degrade to a notice on emulators that cannot serve them).
    await clickT("tab-parameters");
    await waitDisplayed(T("parameters-table"));
    await clickT("tab-events");
    await browser.waitUntil(
      async () =>
        (await $(T("events-table")).isExisting()) ||
        (await $(T("events-unsupported")).isExisting()),
      { timeout: 20000, timeoutMsg: "events tab rendered neither the table nor the notice" },
    );
  });

  // --- R74: update then delete, both SDK-verified ------------------------------

  it("R74: UI updates the template then deletes the stack (resource verified)", async function () {
    await gate(this, "R74", { on: ["cloudformation.resourceReplacement"] });
    const name = `cfn74-${stamp}`;
    const topicA = `cfn74a-${stamp}`;
    const topicB = `cfn74b-${stamp}`;
    await seedStack(name, topicA);
    await waitStatus(name, "CREATE_COMPLETE");

    // Update: swap the topic name via the update modal.
    await gotoStackDetail(name);
    await clickT("stack-update");
    await setValueT("cfn-template", topicTemplate(topicB));
    await clickT("cfn-save");
    await waitStatus(name, "UPDATE_COMPLETE");
    expect(await topicExists(topicB)).toBe(true);

    // Delete: name-confirmation modal, then verify removal from the list and SDK.
    await gotoStackDetail(name);
    await clickT("stack-delete");
    await setValueT("stack-delete-input", name);
    await clickT("stack-delete-confirm");
    await browser.waitUntil(
      async () => {
        await navigateHash("#/");
        await gotoStacks();
        return !(await $(T(`stack-row-${name}`)).isExisting());
      },
      {
        timeout: 60000,
        interval: 2000,
        timeoutMsg: `stack ${name} was not removed from the list`,
      },
    );
    await browser.waitUntil(async () => !(await topicExists(topicB)), {
      timeout: 60000,
      interval: 2000,
      timeoutMsg: `topic ${topicB} was not deleted with the stack`,
    });
  });

  it("R74: update and delete stay functional where resources are not provisioned", async function () {
    // Also covers emulators that create resources but do not re-provision on an
    // update-replacement (localstack:3): the update round-trips, but the swapped
    // topic is not asserted.
    await gate(this, "R74", { off: ["cloudformation.resourceReplacement"] });
    const name = `cfn74u-${stamp}`;
    await seedStack(name, `cfn74ua-${stamp}`);
    await waitStatus(name, "CREATE_COMPLETE");

    // Update round-trips without an error banner.
    await gotoStackDetail(name);
    await clickT("stack-update");
    await setValueT("cfn-template", topicTemplate(`cfn74ub-${stamp}`));
    await clickT("cfn-save");
    await expect($(T("error-banner"))).not.toBeExisting();

    // Delete removes the stack from the list.
    await gotoStackDetail(name);
    await clickT("stack-delete");
    await setValueT("stack-delete-input", name);
    await clickT("stack-delete-confirm");
    await browser.waitUntil(
      async () => {
        await navigateHash("#/");
        await gotoStacks();
        return !(await $(T(`stack-row-${name}`)).isExisting());
      },
      {
        timeout: 60000,
        interval: 2000,
        timeoutMsg: `stack ${name} was not removed from the list`,
      },
    );
  });
});
