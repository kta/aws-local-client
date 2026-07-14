import {
  CreateTopicCommand,
  DeleteTopicCommand,
  ListSubscriptionsByTopicCommand,
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
  gotoTopicDetail,
  gotoTopics,
  setSelectValue,
  setValueT,
  setupActiveConnection,
  waitDisplayed,
} from "../helpers/app";
import { makeSnsClient, makeSqsClient } from "../helpers/aws";

/**
 * SNS requirements (R26-R28).
 *   R26 UI create / list / delete a topic (verified via the SDK).
 *   R27 UI add an SQS subscription -> the row appears -> UI unsubscribe.
 *   R28 UI publish -> the SDK receives the SNS envelope on the subscribed queue,
 *       and envelope.Message equals what was published.
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
    let delivered: string | undefined;
    for (let i = 0; i < 20 && !delivered; i++) {
      const res = await sqs.send(
        new ReceiveMessageCommand({ QueueUrl: url, MaxNumberOfMessages: 1, WaitTimeSeconds: 1 }),
      );
      const body = res.Messages?.[0]?.Body;
      if (body) {
        try {
          delivered = (JSON.parse(body) as { Message?: string }).Message;
        } catch {
          delivered = body; // raw-delivery fallback (not used here)
        }
      }
    }
    expect(delivered).toBe(message);
  });
});
