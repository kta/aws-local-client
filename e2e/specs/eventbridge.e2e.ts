import {
  DeleteEventBusCommand,
  DeleteRuleCommand,
  DescribeRuleCommand,
  type EventBridgeClient,
  ListEventBusesCommand,
  ListRulesCommand,
  ListTargetsByRuleCommand,
} from "@aws-sdk/client-eventbridge";
import {
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SetQueueAttributesCommand,
  type SQSClient,
} from "@aws-sdk/client-sqs";
import { $, browser, expect } from "@wdio/globals";
import {
  E2E_ENDPOINT,
  T,
  clickT,
  gotoEventBridgeDashboard,
  gotoEventBuses,
  gotoEventRules,
  setValueT,
  setupActiveConnection,
  waitDisplayed,
} from "../helpers/app";
import { makeEventBridgeClient, makeSqsClient } from "../helpers/aws";
import { expectCovered, gate, markCovered } from "../helpers/capabilities";

/**
 * EventBridge requirements (R63-R65). Fixtures are seeded / verified directly
 * through the AWS SDK; the UI is exercised for the behaviour under test.
 *   R63 UI creates / lists / deletes an event bus (verified via the SDK) and the
 *       dashboard summarises bus / rule counts.
 *   R64 UI creates a rule (event pattern), toggles it enabled/disabled, attaches
 *       and removes an SQS target — each step verified via the SDK.
 *   R65 UI "イベントを送信" (PutEvents) is delivered through a matching rule to the
 *       subscribed SQS queue; the SDK receives the event and its detail matches.
 *       Real cross-service delivery works on all four probed emulators
 *       (localstack:3 / floci / ministack / kumo), so R65 is unconditional. The
 *       SNS R28 delivery-retry pattern guards against sporadic fanout drops.
 */
describe("eventbridge", () => {
  const eb: EventBridgeClient = makeEventBridgeClient(E2E_ENDPOINT);
  const sqs: SQSClient = makeSqsClient(E2E_ENDPOINT);
  const stamp = Date.now();
  const buses: string[] = []; // custom bus names to clean up
  const rules: string[] = []; // rule names on the default bus to clean up
  const queues: string[] = []; // queue URLs to clean up

  async function seedQueue(name: string): Promise<{ url: string; arn: string }> {
    const { QueueUrl } = await sqs.send(new CreateQueueCommand({ QueueName: name }));
    const url = QueueUrl as string;
    queues.push(url);
    const attrs = await sqs.send(
      new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ["QueueArn"] }),
    );
    const arn = attrs.Attributes?.QueueArn as string;
    // Allow EventBridge to deliver to the queue (some emulators enforce policy).
    await sqs.send(
      new SetQueueAttributesCommand({
        QueueUrl: url,
        Attributes: {
          Policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Principal: { Service: "events.amazonaws.com" },
                Action: "sqs:SendMessage",
                Resource: arn,
              },
            ],
          }),
        },
      }),
    );
    return { url, arn };
  }

  before(async () => {
    await setupActiveConnection({
      name: "eb-conn",
      endpoint: E2E_ENDPOINT,
      region: "ap-northeast-1",
    });
  });

  after(async () => {
    // Coverage guard: R63/R65 are unconditional; R64 (rule CRUD + targets) is
    // unconditional and its enable/disable toggle is capability-gated with a
    // symmetric unsupported-side test, so every requirement is verified on
    // every emulator.
    expectCovered("R63");
    expectCovered("R64");
    expectCovered("R65");
    for (const name of rules) {
      try {
        await eb.send(new DeleteRuleCommand({ Name: name, Force: true }));
      } catch {
        /* best effort */
      }
    }
    for (const name of buses) {
      try {
        // Best effort: the R63 test deletes its bus via the UI; this clears any
        // bus a failed run left behind.
        await eb.send(new DeleteEventBusCommand({ Name: name }));
      } catch {
        /* best effort */
      }
    }
    for (const url of queues) {
      try {
        await sqs.send(new DeleteQueueCommand({ QueueUrl: url }));
      } catch {
        /* best effort */
      }
    }
  });

  it("R63: UI creates, lists and deletes an event bus", async () => {
    markCovered("R63");
    const name = `bus63-${stamp}`;
    buses.push(name);

    await gotoEventBuses();
    await clickT("buses-create");
    await setValueT("bus-name", name);
    await clickT("bus-save");
    await waitDisplayed(T(`bus-row-${name}`));

    // The SDK confirms the bus exists.
    await browser.waitUntil(
      async () => {
        const list = await eb.send(new ListEventBusesCommand({}));
        return (list.EventBuses ?? []).some((b) => b.Name === name);
      },
      { timeout: 20000, timeoutMsg: "bus never appeared via the SDK" },
    );

    // Delete via the list (name-confirmation modal).
    const box = await waitDisplayed(`[aria-label="${name} を選択"]`);
    await box.click();
    await clickT("buses-delete");
    await setValueT("buses-delete-input", name);
    await clickT("buses-delete-confirm");
    await browser.waitUntil(async () => !(await $(T(`bus-row-${name}`)).isExisting()), {
      timeout: 20000,
      timeoutMsg: `bus ${name} was not removed`,
    });

    // The SDK confirms it is gone.
    await browser.waitUntil(
      async () => {
        const list = await eb.send(new ListEventBusesCommand({}));
        return !(list.EventBuses ?? []).some((b) => b.Name === name);
      },
      { timeout: 20000, timeoutMsg: "bus never disappeared via the SDK" },
    );
  });

  it("R63: dashboard summarises buses and the quick action opens the create modal", async () => {
    await gotoEventBridgeDashboard();
    await waitDisplayed(T("eb-dash-buses"));
    await waitDisplayed(T("eb-dash-rules"));

    // The bus-count card reflects at least the built-in default bus.
    await browser.waitUntil(
      async () => {
        await gotoEventBridgeDashboard();
        const text = await $(T("eb-dash-buses")).getText();
        return Number(text.replace(/[^\d]/g, "")) >= 1;
      },
      { timeout: 30000, interval: 2000, timeoutMsg: "dashboard never showed a bus count" },
    );

    // The quick action navigates to the buses page with the create modal open.
    await clickT("eb-dash-create");
    await waitDisplayed(T("bus-name"));
  });

  it("R64: UI creates a rule and manages an SQS target", async () => {
    markCovered("R64");
    const ruleName = `rule64-${stamp}`;
    const queueName = `q64-${stamp}`;
    rules.push(ruleName);
    const { arn: queueArn } = await seedQueue(queueName);

    // Create the rule (event-pattern mode is the default) on the default bus.
    await gotoEventRules();
    await clickT("rules-create");
    await setValueT("rule-name", ruleName);
    await setValueT("rule-pattern", '{"source":["nlsd.e2e"]}');
    await clickT("rule-save");
    await waitDisplayed(T(`rule-row-${ruleName}`));

    // The SDK confirms the rule exists on the default bus.
    await browser.waitUntil(
      async () => {
        const list = await eb.send(new ListRulesCommand({ EventBusName: "default" }));
        return (list.Rules ?? []).some((r) => r.Name === ruleName);
      },
      { timeout: 20000, timeoutMsg: "rule never appeared via the SDK" },
    );

    // Select the rule row to reveal the targets panel, then add an SQS target.
    await clickT(`rule-row-${ruleName}`);
    await setValueT("target-arn", queueArn);
    await clickT("target-add");
    let targetId = "";
    await browser.waitUntil(
      async () => {
        const t = await eb.send(
          new ListTargetsByRuleCommand({ Rule: ruleName, EventBusName: "default" }),
        );
        const match = (t.Targets ?? []).find((x) => x.Arn === queueArn);
        if (match) targetId = match.Id as string;
        return !!match;
      },
      { timeout: 20000, timeoutMsg: "target never appeared via the SDK" },
    );

    // Remove the target via its row action -> the SDK confirms removal.
    await clickT(`target-remove-${targetId}`);
    await browser.waitUntil(
      async () => {
        const t = await eb.send(
          new ListTargetsByRuleCommand({ Rule: ruleName, EventBusName: "default" }),
        );
        return !(t.Targets ?? []).some((x) => x.Arn === queueArn);
      },
      { timeout: 20000, timeoutMsg: "target never disappeared via the SDK" },
    );

    // Delete the rule via the list (name-confirmation modal).
    await clickT(`rule-delete-${ruleName}`);
    await setValueT("rule-delete-input", ruleName);
    await clickT("rule-delete-confirm");
    await browser.waitUntil(async () => !(await $(T(`rule-row-${ruleName}`)).isExisting()), {
      timeout: 20000,
      timeoutMsg: `rule ${ruleName} was not removed`,
    });
    await browser.waitUntil(
      async () => {
        const list = await eb.send(new ListRulesCommand({ EventBusName: "default" }));
        return !(list.Rules ?? []).some((r) => r.Name === ruleName);
      },
      { timeout: 20000, timeoutMsg: "rule never disappeared via the SDK" },
    );
  });

  it("R64: UI toggles a rule enabled/disabled", async function () {
    // Rule enable/disable is capability-gated: ministack/floci/localstack apply
    // it, kumo answers InvalidAction ("DisableRule is not valid for this
    // endpoint"). The unsupported side is covered by the symmetric test below.
    await gate(this, "R64", { on: ["eventbridge.ruleState"] });
    const ruleName = `rule64t-${stamp}`;
    rules.push(ruleName);

    await gotoEventRules();
    await clickT("rules-create");
    await setValueT("rule-name", ruleName);
    await setValueT("rule-pattern", '{"source":["nlsd.e2e"]}');
    await clickT("rule-save");
    await waitDisplayed(T(`rule-row-${ruleName}`));

    // Toggle to disabled -> the SDK reflects DISABLED.
    await clickT(`rule-toggle-${ruleName}`);
    await browser.waitUntil(
      async () => {
        const d = await eb.send(
          new DescribeRuleCommand({ Name: ruleName, EventBusName: "default" }),
        );
        return d.State === "DISABLED";
      },
      { timeout: 20000, timeoutMsg: "rule was not disabled via the SDK" },
    );
    // Toggle back to enabled.
    await clickT(`rule-toggle-${ruleName}`);
    await browser.waitUntil(
      async () => {
        const d = await eb.send(
          new DescribeRuleCommand({ Name: ruleName, EventBusName: "default" }),
        );
        return d.State === "ENABLED";
      },
      { timeout: 20000, timeoutMsg: "rule was not re-enabled via the SDK" },
    );
  });

  it("R64: surfaces an error when rule enable/disable is unsupported", async function () {
    // Symmetric unsupported branch (kumo): clicking the toggle raises the
    // emulator's InvalidAction error in the page error banner and the rule stays
    // ENABLED via the SDK — the app does not silently pretend it toggled.
    await gate(this, "R64", { off: ["eventbridge.ruleState"] });
    const ruleName = `rule64u-${stamp}`;
    rules.push(ruleName);

    await gotoEventRules();
    await clickT("rules-create");
    await setValueT("rule-name", ruleName);
    await setValueT("rule-pattern", '{"source":["nlsd.e2e"]}');
    await clickT("rule-save");
    await waitDisplayed(T(`rule-row-${ruleName}`));

    await clickT(`rule-toggle-${ruleName}`);
    await waitDisplayed(T("error-banner"));
    // The SDK confirms the rule was never actually disabled.
    const d = await eb.send(new DescribeRuleCommand({ Name: ruleName, EventBusName: "default" }));
    expect(d.State).toBe("ENABLED");
  });

  it("R65: UI PutEvents is delivered through a matching rule to the SQS target", async () => {
    markCovered("R65");
    const ruleName = `rule65-${stamp}`;
    const queueName = `q65-${stamp}`;
    rules.push(ruleName);
    const { url, arn: queueArn } = await seedQueue(queueName);

    // Rule with an event pattern that matches the event we will send.
    await gotoEventRules();
    await clickT("rules-create");
    await setValueT("rule-name", ruleName);
    await setValueT("rule-pattern", '{"source":["nlsd.e2e"]}');
    await clickT("rule-save");
    await waitDisplayed(T(`rule-row-${ruleName}`));

    // Attach the SQS queue as a target.
    await clickT(`rule-row-${ruleName}`);
    await setValueT("target-arn", queueArn);
    await clickT("target-add");
    await browser.waitUntil(
      async () => {
        const t = await eb.send(
          new ListTargetsByRuleCommand({ Rule: ruleName, EventBusName: "default" }),
        );
        return (t.Targets ?? []).some((x) => x.Arn === queueArn);
      },
      { timeout: 20000, timeoutMsg: "target never attached via the SDK" },
    );

    // Send the event through the UI. Some emulators drop a single fanout on slow
    // runners, so retry the UI PutEvents up to 3 times (mirrors SNS R28).
    const marker = `evt-${stamp}`;
    const detail = JSON.stringify({ marker });
    let delivered: string | undefined;
    for (let attempt = 0; attempt < 3 && !delivered; attempt++) {
      await clickT("rules-put-events");
      await setValueT("pe-source", "nlsd.e2e");
      await setValueT("pe-detail-type", "e2eEvent");
      await setValueT("pe-detail", detail);
      await clickT("pe-save");
      await waitDisplayed(T("put-events-result"));
      for (let i = 0; i < 10 && !delivered; i++) {
        const res = await sqs.send(
          new ReceiveMessageCommand({
            QueueUrl: url,
            MaxNumberOfMessages: 10,
            WaitTimeSeconds: 1,
            VisibilityTimeout: 0,
          }),
        );
        for (const m of res.Messages ?? []) {
          if (m.Body?.includes(marker)) {
            delivered = m.Body;
            break;
          }
        }
      }
    }
    expect(delivered).toBeDefined();
    // The delivered envelope carries our detail JSON.
    expect(delivered).toContain(marker);
  });
});
