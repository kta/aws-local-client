import {
  BatchWriteItemCommand,
  type BatchWriteItemCommandOutput,
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
  GetItemCommand,
  ListTablesCommand,
  waitUntilTableExists,
  type AttributeValue,
  type CreateTableCommandInput,
  type WriteRequest,
} from "@aws-sdk/client-dynamodb";

/**
 * Emulator seeding/cleanup helpers for the E2E suite.
 *
 * These talk to the same DynamoDB-compatible emulator the app under test uses,
 * but directly via the AWS SDK (bypassing the UI). Used to set up fixtures that
 * would be impractical to create by hand — e.g. the 51+ items R9 (pagination)
 * needs — so the specs can focus on exercising the UI.
 *
 * The endpoint comes from E2E_ENDPOINT (default http://localhost:4566), matching
 * the connection the specs register in the app.
 */
export const E2E_ENDPOINT = process.env.E2E_ENDPOINT ?? "http://localhost:4566";
export const E2E_REGION = process.env.E2E_REGION ?? "ap-northeast-1";

export function makeClient(endpoint = E2E_ENDPOINT, region = E2E_REGION): DynamoDBClient {
  return new DynamoDBClient({
    endpoint,
    region,
    credentials: { accessKeyId: "dummy", secretAccessKey: "dummy" },
  });
}

export type AttrType = "S" | "N" | "B";
export type SimpleKey = { name: string; type: AttrType };
export type SimpleGsi = { name: string; pk: SimpleKey; sk?: SimpleKey };

export type CreateTableSpec = {
  tableName: string;
  pk: SimpleKey;
  sk?: SimpleKey;
  gsis?: SimpleGsi[];
};

function attrDefs(spec: CreateTableSpec): CreateTableCommandInput["AttributeDefinitions"] {
  const seen = new Map<string, AttrType>();
  const add = (k?: SimpleKey) => {
    if (k) seen.set(k.name, k.type);
  };
  add(spec.pk);
  add(spec.sk);
  for (const g of spec.gsis ?? []) {
    add(g.pk);
    add(g.sk);
  }
  return [...seen].map(([AttributeName, t]) => ({ AttributeName, AttributeType: t }));
}

/**
 * Create a table (idempotent: an existing table with the same name is deleted
 * first) and wait until it is ACTIVE so subsequent seeding/UI calls see it.
 */
export async function createTable(
  spec: CreateTableSpec,
  client = makeClient(),
): Promise<void> {
  await deleteTable(spec.tableName, client);

  const keySchema = [
    { AttributeName: spec.pk.name, KeyType: "HASH" as const },
    ...(spec.sk ? [{ AttributeName: spec.sk.name, KeyType: "RANGE" as const }] : []),
  ];

  await client.send(
    new CreateTableCommand({
      TableName: spec.tableName,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: attrDefs(spec),
      KeySchema: keySchema,
      GlobalSecondaryIndexes:
        spec.gsis && spec.gsis.length > 0
          ? spec.gsis.map((g) => ({
              IndexName: g.name,
              KeySchema: [
                { AttributeName: g.pk.name, KeyType: "HASH" as const },
                ...(g.sk ? [{ AttributeName: g.sk.name, KeyType: "RANGE" as const }] : []),
              ],
              Projection: { ProjectionType: "ALL" as const },
            }))
          : undefined,
    }),
  );

  await waitUntilTableExists({ client, maxWaitTime: 60 }, { TableName: spec.tableName });
}

/** Delete a table if it exists; resolves quietly when it does not. */
export async function deleteTable(tableName: string, client = makeClient()): Promise<void> {
  try {
    await client.send(new DeleteTableCommand({ TableName: tableName }));
    // Best-effort wait for the delete to settle so a re-create does not race.
    for (let i = 0; i < 30; i++) {
      const { TableNames } = await client.send(new ListTablesCommand({}));
      if (!TableNames?.includes(tableName)) return;
      await new Promise((r) => setTimeout(r, 500));
    }
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === "ResourceNotFoundException") return;
    throw e;
  }
}

/** DynamoDB-JSON item, e.g. { pk: { S: "a" }, n: { N: "1" } }. */
export type SeedItem = Record<string, AttributeValue>;

/** Put items in batches of 25 (the BatchWriteItem limit). */
export async function putItems(
  tableName: string,
  items: SeedItem[],
  client = makeClient(),
): Promise<void> {
  for (let i = 0; i < items.length; i += 25) {
    const chunk = items.slice(i, i + 25);
    const requests: WriteRequest[] = chunk.map((Item) => ({ PutRequest: { Item } }));
    let unprocessed: Record<string, WriteRequest[]> | undefined = {
      [tableName]: requests,
    };
    // Retry any unprocessed items a few times.
    for (let attempt = 0; attempt < 5 && unprocessed && Object.keys(unprocessed).length > 0; attempt++) {
      const res: BatchWriteItemCommandOutput = await client.send(
        new BatchWriteItemCommand({ RequestItems: unprocessed }),
      );
      unprocessed = res.UnprocessedItems;
      if (unprocessed && Object.keys(unprocessed).length > 0) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  }
}

/** True if a table with the given name currently exists on the emulator. */
export async function tableExists(tableName: string, client = makeClient()): Promise<boolean> {
  const { TableNames } = await client.send(new ListTablesCommand({}));
  return TableNames?.includes(tableName) ?? false;
}

/** Fetch a single item by key (DynamoDB JSON), or undefined if absent. */
export async function getItem(
  tableName: string,
  key: SeedItem,
  client = makeClient(),
): Promise<SeedItem | undefined> {
  try {
    const res = await client.send(new GetItemCommand({ TableName: tableName, Key: key }));
    return res.Item as SeedItem | undefined;
  } catch (e) {
    if ((e as { name?: string }).name === "ResourceNotFoundException") return undefined;
    throw e;
  }
}

/**
 * Create a table and seed `count` items with a numeric-suffixed string PK.
 * Used by R9 to guarantee >50 rows for pagination without going through the UI.
 */
export async function seedItems(
  spec: CreateTableSpec,
  count: number,
  makeItem: (i: number) => SeedItem,
  client = makeClient(),
): Promise<void> {
  await createTable(spec, client);
  const items = Array.from({ length: count }, (_, i) => makeItem(i));
  await putItems(spec.tableName, items, client);
}
