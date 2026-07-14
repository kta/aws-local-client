import {
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  type Message,
  ReceiveMessageCommand,
  SendMessageCommand,
  type SQSClient,
} from "@aws-sdk/client-sqs";
import { $, browser, expect } from "@wdio/globals";
import {
  E2E_ENDPOINT,
  T,
  clickT,
  gotoQueueDetail,
  gotoQueues,
  setValueT,
  setupActiveConnection,
  waitDisplayed,
} from "../helpers/app";
import { makeSqsClient } from "../helpers/aws";

/**
 * SQS requirements (R22-R25). Fixtures are seeded / verified directly through
 * the AWS SDK; the UI is exercised for the behaviour under test.
 *   R22 SDK-seed two queues (one with messages) -> the list shows them + counts.
 *   R23 UI create -> SDK-verify attributes; UI edit settings -> SDK-verify; UI delete.
 *   R24 UI send a message (with an attribute) -> SDK receive matches body + attr.
 *   R25 SDK-seed messages -> UI poll shows them -> UI delete one (SDK confirms it
 *       is gone) -> UI purge (SDK confirms the queue is empty).
 */
describe("sqs", () => {
  const client: SQSClient = makeSqsClient(E2E_ENDPOINT);
  const stamp = Date.now();
  const created: string[] = []; // queue URLs to clean up

  async function seedQueue(name: string): Promise<string> {
    const { QueueUrl } = await client.send(new CreateQueueCommand({ QueueName: name }));
    const url = QueueUrl as string;
    created.push(url);
    return url;
  }

  async function queueUrl(name: string): Promise<string> {
    const { QueueUrl } = await client.send(new GetQueueUrlCommand({ QueueName: name }));
    return QueueUrl as string;
  }

  before(async () => {
    await setupActiveConnection({
      name: "sqs-conn",
      endpoint: E2E_ENDPOINT,
      region: "ap-northeast-1",
    });
  });

  after(async () => {
    for (const url of created) {
      try {
        await client.send(new DeleteQueueCommand({ QueueUrl: url }));
      } catch {
        /* best effort */
      }
    }
  });

  it("R22: lists SDK-seeded queues with their (approximate) message count", async () => {
    const q1 = `q22a-${stamp}`;
    const q2 = `q22b-${stamp}`;
    const url1 = await seedQueue(q1);
    await seedQueue(q2);
    await client.send(new SendMessageCommand({ QueueUrl: url1, MessageBody: "m1" }));
    await client.send(new SendMessageCommand({ QueueUrl: url1, MessageBody: "m2" }));

    await gotoQueues();
    await waitDisplayed(T(`queue-link-${q1}`));
    await waitDisplayed(T(`queue-link-${q2}`));

    // The approximate message count is eventually consistent; reload the list
    // until the count CELL of the seeded queue shows exactly "2". Asserting the
    // dedicated cell (not the whole row) avoids matching digits in the queue name.
    await browser.waitUntil(
      async () => {
        await gotoQueues();
        return (await $(T(`queue-msgs-${q1}`)).getText()) === "2";
      },
      { timeout: 30000, interval: 2000, timeoutMsg: `queue ${q1} never showed count 2` },
    );
    // The message-free queue reports zero.
    expect(await $(T(`queue-msgs-${q2}`)).getText()).toBe("0");
  });

  it("R23: UI create -> SDK verify attrs, UI edit -> SDK verify, UI delete", async () => {
    const name = `q23-${stamp}`;

    // --- create via the UI with a non-default visibility timeout ---------------
    await gotoQueues();
    await clickT("queues-create");
    await setValueT("q-name", name);
    await setValueT("q-visibility", "45");
    await clickT("q-save");
    await waitDisplayed(T(`queue-link-${name}`));

    const url = await queueUrl(name);
    const attrs1 = await client.send(
      new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ["VisibilityTimeout"] }),
    );
    expect(attrs1.Attributes?.VisibilityTimeout).toBe("45");

    // --- edit the visibility timeout via the settings tab ----------------------
    await gotoQueueDetail(name);
    await clickT("tab-settings");
    await setValueT("qs-visibility", "60");
    await clickT("qs-save");
    await browser.waitUntil(
      async () => {
        const a = await client.send(
          new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ["VisibilityTimeout"] }),
        );
        return a.Attributes?.VisibilityTimeout === "60";
      },
      { timeout: 20000, timeoutMsg: "visibility timeout was not updated to 60" },
    );

    // --- delete from the list (name-confirmation modal) ------------------------
    await gotoQueues();
    const box = await waitDisplayed(`[aria-label="${name} を選択"]`);
    await box.click();
    await clickT("queues-delete");
    await setValueT("queues-delete-input", name);
    await clickT("queues-delete-confirm");
    await browser.waitUntil(async () => !(await $(T(`queue-link-${name}`)).isExisting()), {
      timeout: 20000,
      timeoutMsg: `queue ${name} was not removed from the list`,
    });
    await expect(
      client.send(new GetQueueUrlCommand({ QueueName: name })),
    ).rejects.toThrow();
  });

  it("R24: UI send -> SDK receive matches body and attribute", async () => {
    const name = `q24-${stamp}`;
    const url = await seedQueue(name);

    await gotoQueueDetail(name);
    await clickT("queue-send");
    await setValueT("sm-body", "hello-from-ui");
    await clickT("sm-add-attr");
    await setValueT("sm-attr-name-0", "source");
    await setValueT("sm-attr-value-0", "e2e");
    await clickT("sm-save");
    // Modal closes on success.
    await $(T("sm-body")).waitForExist({ reverse: true, timeout: 15000 });

    let received: Message | undefined;
    for (let i = 0; i < 15 && !received; i++) {
      const res = await client.send(
        new ReceiveMessageCommand({
          QueueUrl: url,
          MaxNumberOfMessages: 1,
          WaitTimeSeconds: 1,
          MessageAttributeNames: ["All"],
        }),
      );
      if (res.Messages && res.Messages.length > 0) received = res.Messages[0];
    }
    expect(received?.Body).toBe("hello-from-ui");
    expect(received?.MessageAttributes?.source?.StringValue).toBe("e2e");
  });

  it("R25: UI poll shows seeded messages, UI delete one, UI purge empties it", async () => {
    const name = `q25-${stamp}`;
    const url = await seedQueue(name);
    await client.send(new SendMessageCommand({ QueueUrl: url, MessageBody: "a" }));
    await client.send(new SendMessageCommand({ QueueUrl: url, MessageBody: "b" }));

    const msgRowCount = () =>
      browser.execute(() => document.querySelectorAll('[data-testid^="msg-row-"]').length);

    await gotoQueueDetail(name);
    await browser.waitUntil(
      async () => {
        await clickT("queue-poll");
        return (await msgRowCount()) >= 2;
      },
      { timeout: 30000, interval: 1500, timeoutMsg: "polled messages never reached 2 rows" },
    );

    // Delete the first message via its checkbox + the delete action.
    const firstBox = $(
      '(//table[@data-testid="messages-table"]//tbody//input[@type="checkbox"])[1]',
    );
    await firstBox.click();
    await clickT("msg-delete");
    await browser.waitUntil(async () => (await msgRowCount()) === 1, {
      timeout: 20000,
      timeoutMsg: "message row was not removed after delete",
    });

    // SDK: exactly one message remains (available + in-flight after the poll).
    const total = async (): Promise<number> => {
      const a = await client.send(
        new GetQueueAttributesCommand({
          QueueUrl: url,
          AttributeNames: [
            "ApproximateNumberOfMessages",
            "ApproximateNumberOfMessagesNotVisible",
          ],
        }),
      );
      return (
        Number(a.Attributes?.ApproximateNumberOfMessages ?? 0) +
        Number(a.Attributes?.ApproximateNumberOfMessagesNotVisible ?? 0)
      );
    };
    await browser.waitUntil(async () => (await total()) === 1, {
      timeout: 20000,
      timeoutMsg: "queue did not settle to exactly one remaining message",
    });

    // Purge via the UI and confirm the queue is empty.
    await clickT("queue-purge");
    await setValueT("queue-purge-input", name);
    await clickT("queue-purge-confirm");
    await browser.waitUntil(async () => (await total()) === 0, {
      timeout: 30000,
      interval: 2000,
      timeoutMsg: "queue was not emptied after purge",
    });
  });
});
