import {
  CreateTopicCommand,
  DeleteTopicCommand,
  GetTopicAttributesCommand,
  ListSubscriptionsByTopicCommand,
  ListTagsForResourceCommand,
  ListTopicsCommand,
  type SNSClient,
  SubscribeCommand,
} from "@aws-sdk/client-sns";
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
  gotoSnsDashboard,
  gotoSnsSubscriptions,
  gotoTopicDetail,
  gotoTopics,
  setSelectValue,
  setValueT,
  setupActiveConnection,
  waitDisplayed,
} from "../helpers/app";
import { makeSnsClient, makeSqsClient } from "../helpers/aws";

/**
 * SNS requirements (R26-R28, R39-R42). Fixtures are seeded / verified directly
 * through the AWS SDK; the UI is exercised for the behaviour under test.
 *   R26 UI create / list / delete a topic (verified via the SDK).
 *   R27 UI add an SQS subscription -> the row appears -> UI unsubscribe.
 *   R28 UI publish -> the SDK receives the SNS envelope on the subscribed queue,
 *       and envelope.Message equals what was published.
 *   R39 Dashboard at /sns summarises seeded topics; the create quick action opens
 *       the create modal on the topics page.
 *   R40 The cross-topic subscriptions list shows an SDK-seeded subscription and
 *       can unsubscribe it (SDK confirms it is gone).
 *   R41 UI edits a topic's DisplayName -> the SDK reflects it.
 *   R42 UI adds a topic tag (SDK verifies), then removes it (SDK verifies).
 */
describe("sns", () => {
  const sns: SNSClient = makeSnsClient(E2E_ENDPOINT);
  const sqs: SQSClient = makeSqsClient(E2E_ENDPOINT);
  const stamp = Date.now();
  const topics: string[] = []; // topic ARNs
  const queues: string[] = []; // queue URLs

  async function seedTopic(name: string): Promise<string> {
    const { TopicArn } = await sns.send(new CreateTopicCommand({ Name: name }));
    const arn = TopicArn as string;
    topics.push(arn);
    return arn;
  }

  async function seedQueue(name: string): Promise<{ url: string; arn: string }> {
    const { QueueUrl } = await sqs.send(new CreateQueueCommand({ QueueName: name }));
    const url = QueueUrl as string;
    queues.push(url);
    const attrs = await sqs.send(
      new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ["QueueArn"] }),
    );
    return { url, arn: attrs.Attributes?.QueueArn as string };
  }

  before(async () => {
    await setupActiveConnection({
      name: "sns-conn",
      endpoint: E2E_ENDPOINT,
      region: "ap-northeast-1",
    });
  });

  after(async () => {
    for (const arn of topics) {
      try {
        await sns.send(new DeleteTopicCommand({ TopicArn: arn }));
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

  it("R26: UI creates, lists and deletes a topic", async () => {
    const name = `t26-${stamp}`;

    await gotoTopics();
    await clickT("topics-create");
    await setValueT("t-name", name);
    await clickT("t-save");
    await waitDisplayed(T(`topic-link-${name}`));

    const list = await sns.send(new ListTopicsCommand({}));
    expect((list.Topics ?? []).some((t) => (t.TopicArn ?? "").endsWith(`:${name}`))).toBe(true);
    // Remember it for cleanup even though we delete it below.
    topics.push((list.Topics ?? []).find((t) => (t.TopicArn ?? "").endsWith(`:${name}`))!.TopicArn!);

    // Delete via the list (name-confirmation modal).
    const box = await waitDisplayed(`[aria-label="${name} を選択"]`);
    await box.click();
    await clickT("topics-delete");
    await setValueT("topics-delete-input", name);
    await clickT("topics-delete-confirm");
    await browser.waitUntil(async () => !(await $(T(`topic-link-${name}`)).isExisting()), {
      timeout: 20000,
      timeoutMsg: `topic ${name} was not removed`,
    });

    const after = await sns.send(new ListTopicsCommand({}));
    expect((after.Topics ?? []).some((t) => (t.TopicArn ?? "").endsWith(`:${name}`))).toBe(false);
  });

  it("R27: UI adds an SQS subscription, shows it, then unsubscribes", async () => {
    const topicName = `t27-${stamp}`;
    const queueName = `t27q-${stamp}`;
    await seedTopic(topicName);
    const { url } = await seedQueue(queueName);

    await gotoTopicDetail(topicName);
    await clickT("tab-subs");
    await clickT("sub-add");
    await setSelectValue("sub-queue-select", url);
    await clickT("sub-save");
    await waitDisplayed(T(`sub-row-${queueName}`));

    const arn = topics[topics.length - 1];
    await browser.waitUntil(
      async () => {
        const subs = await sns.send(new ListSubscriptionsByTopicCommand({ TopicArn: arn }));
        return (subs.Subscriptions ?? []).some((s) => (s.Endpoint ?? "").endsWith(`:${queueName}`));
      },
      { timeout: 20000, timeoutMsg: "subscription never appeared via the SDK" },
    );

    // Unsubscribe via the row action (name-confirmation modal).
    await $(T(`sub-row-${queueName}`)).$(T("sub-remove")).click();
    await setValueT("sub-remove-input", queueName);
    await clickT("sub-remove-confirm");
    await browser.waitUntil(async () => !(await $(T(`sub-row-${queueName}`)).isExisting()), {
      timeout: 20000,
      timeoutMsg: "subscription row was not removed",
    });
  });

  it("R28: UI publish is delivered to the subscribed SQS queue", async () => {
    const topicName = `t28-${stamp}`;
    const queueName = `t28q-${stamp}`;
    const topicArn = await seedTopic(topicName);
    const { url, arn: queueArn } = await seedQueue(queueName);

    // Allow SNS to deliver to the queue (some emulators enforce the policy).
    await sqs.send(
      new SetQueueAttributesCommand({
        QueueUrl: url,
        Attributes: {
          Policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Principal: { AWS: "*" },
                Action: "sqs:SendMessage",
                Resource: queueArn,
                Condition: { ArnEquals: { "aws:SourceArn": topicArn } },
              },
            ],
          }),
        },
      }),
    );
    await sns.send(
      new SubscribeCommand({ TopicArn: topicArn, Protocol: "sqs", Endpoint: queueArn }),
    );

    const message = `published-${stamp}`;
    await gotoTopicDetail(topicName);
    await clickT("tab-publish");
    await setValueT("pub-message", message);
    await clickT("pub-save");
    await waitDisplayed(T("publish-result"));

    // The queue should receive an SNS envelope whose Message field matches.
    // VisibilityTimeout: 0 keeps an inspected message visible for the next
    // poll, so one slow/odd receive cannot hide the delivery (Windows runners).
    let delivered: string | undefined;
    for (let i = 0; i < 30 && !delivered; i++) {
      const res = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: url,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 1,
          VisibilityTimeout: 0,
        }),
      );
      for (const m of res.Messages ?? []) {
        if (!m.Body) continue;
        try {
          delivered = (JSON.parse(m.Body) as { Message?: string }).Message ?? m.Body;
        } catch {
          delivered = m.Body; // raw-delivery fallback (not used here)
        }
        if (delivered) break;
      }
    }
    expect(delivered).toBe(message);
  });

  it("R39: dashboard summarises seeded topics and quick action opens the create modal", async () => {
    const name = `t39-${stamp}`;
    await seedTopic(name);

    // The dashboard is reachable at /sns and shows summary cards.
    await gotoSnsDashboard();
    await waitDisplayed(T("sns-dash-topics"));
    await waitDisplayed(T("sns-dash-subs"));
    await waitDisplayed(T("sns-dash-fifo"));
    await waitDisplayed(T("sns-dash-create"));

    // The topic-count card eventually reflects the seeded topic.
    await browser.waitUntil(
      async () => {
        await gotoSnsDashboard();
        const text = await $(T("dashboard-summary")).getText();
        const count = Number(text.match(/トピック数\s*(\d[\d,]*)/)?.[1]?.replace(/,/g, ""));
        return count >= 1;
      },
      { timeout: 30000, interval: 2000, timeoutMsg: "dashboard never showed a topic count" },
    );

    // The quick action navigates to the topics page with the create modal open.
    await clickT("sns-dash-create");
    await waitDisplayed(T("t-name"));
  });

  it("R40: cross-topic list shows a seeded subscription and can unsubscribe it", async () => {
    const topicName = `t40-${stamp}`;
    const queueName = `t40q-${stamp}`;
    const topicArn = await seedTopic(topicName);
    const { arn: queueArn } = await seedQueue(queueName);
    await sns.send(
      new SubscribeCommand({ TopicArn: topicArn, Protocol: "sqs", Endpoint: queueArn }),
    );

    // The seeded subscription appears in the cross-topic list.
    await gotoSnsSubscriptions();
    await waitDisplayed(T(`gsub-row-${topicName}`));

    // Unsubscribe via the row action (endpoint-name confirmation modal).
    await $(T(`gsub-row-${topicName}`)).$(T("gsub-remove")).click();
    await setValueT("gsub-remove-input", queueName);
    await clickT("gsub-remove-confirm");
    await browser.waitUntil(async () => !(await $(T(`gsub-row-${topicName}`)).isExisting()), {
      timeout: 20000,
      timeoutMsg: "subscription row was not removed",
    });

    // The SDK confirms the subscription is gone from the topic.
    await browser.waitUntil(
      async () => {
        const subs = await sns.send(new ListSubscriptionsByTopicCommand({ TopicArn: topicArn }));
        return !(subs.Subscriptions ?? []).some((s) => (s.Endpoint ?? "").endsWith(`:${queueName}`));
      },
      { timeout: 20000, timeoutMsg: "subscription never disappeared via the SDK" },
    );
  });

  it("R41: edits a topic's DisplayName and the SDK reflects it", async () => {
    const topicName = `t41-${stamp}`;
    const topicArn = await seedTopic(topicName);

    await gotoTopicDetail(topicName);
    await clickT("tab-attrs");
    const display = `disp-${stamp}`;
    await setValueT("attr-display-name", display);
    await clickT("attr-save");

    await browser.waitUntil(
      async () => {
        const attrs = await sns.send(new GetTopicAttributesCommand({ TopicArn: topicArn }));
        return attrs.Attributes?.DisplayName === display;
      },
      { timeout: 20000, timeoutMsg: "DisplayName was not updated via the SDK" },
    );
  });

  it("R42: adds a topic tag (SDK verified), then removes it", async () => {
    const topicName = `t42-${stamp}`;
    const topicArn = await seedTopic(topicName);

    await gotoTopicDetail(topicName);
    await clickT("tab-tags");

    // Add a tag via the UI, then confirm it via the SDK.
    await clickT("tag-add");
    await setValueT("tag-key-input", "env");
    await setValueT("tag-value-input", "prod");
    await clickT("tag-save");
    await waitDisplayed(T("tag-remove-env"));
    await browser.waitUntil(
      async () => {
        const t = await sns.send(new ListTagsForResourceCommand({ ResourceArn: topicArn }));
        return (t.Tags ?? []).some((x) => x.Key === "env" && x.Value === "prod");
      },
      { timeout: 20000, timeoutMsg: "tag never appeared via the SDK" },
    );

    // Remove the tag via the UI, then confirm removal via the SDK.
    await clickT("tag-remove-env");
    await browser.waitUntil(async () => !(await $(T("tag-remove-env")).isExisting()), {
      timeout: 20000,
      timeoutMsg: "removed tag never disappeared",
    });
    await browser.waitUntil(
      async () => {
        const t = await sns.send(new ListTagsForResourceCommand({ ResourceArn: topicArn }));
        return !(t.Tags ?? []).some((x) => x.Key === "env");
      },
      { timeout: 20000, timeoutMsg: "tag never cleared via the SDK" },
    );
  });
});
