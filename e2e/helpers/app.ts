import { $, $$, browser, expect } from "@wdio/globals";

/**
 * Shared UI flows for the E2E specs, built on the selectors the smoke spec
 * established (data-testid first, aria-label / text as fallback). Each spec
 * drives the real app through these so the requirement-level tests stay
 * readable and the low-level clicking lives in one place.
 */

export const E2E_ENDPOINT = process.env.E2E_ENDPOINT ?? "http://localhost:4566";

/** data-testid selector shorthand. */
export const T = (id: string) => `[data-testid="${id}"]`;

export async function waitDisplayed(selector: string, timeout = 20000) {
  const el = $(selector);
  await el.waitForDisplayed({ timeout });
  return el;
}

export async function clickT(id: string, timeout = 20000) {
  const el = await waitDisplayed(T(id), timeout);
  await el.click();
  return el;
}

export async function setValueT(id: string, value: string, timeout = 20000) {
  const el = await waitDisplayed(T(id), timeout);
  await el.clearValue();
  await el.setValue(value);
  return el;
}

/**
 * Set a <select> value the way React expects. The embedded webkit driver's
 * selectBy* does not reliably fire the controlled-component onChange, so we set
 * the value through the native setter and dispatch a bubbling change event.
 */
export async function setSelectValue(id: string, value: string): Promise<void> {
  await waitDisplayed(T(id));
  // Options may be populated asynchronously (e.g. from listTables); setting a
  // value before its <option> exists silently leaves the select empty on slow
  // runners, so wait for the target option to appear first.
  await browser.waitUntil(
    async () =>
      browser.execute(
        (sel: string, val: string) => {
          const el = document.querySelector(sel) as HTMLSelectElement | null;
          return !!el && [...el.options].some((o) => o.value === val);
        },
        T(id),
        value,
      ),
    { timeout: 20000, timeoutMsg: `option "${value}" never appeared in ${id}` },
  );
  await browser.execute(
    (sel: string, val: string) => {
      const el = document.querySelector(sel) as HTMLSelectElement | null;
      if (!el) throw new Error(`select not found: ${sel}`);
      const setter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value",
      )?.set;
      setter?.call(el, val);
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    T(id),
    value,
  );
}

/** Like setSelectValue but selects the option whose visible text matches. */
export async function setSelectByVisibleText(id: string, text: string): Promise<void> {
  await waitDisplayed(T(id));
  await browser.waitUntil(
    async () =>
      browser.execute(
        (sel: string, txt: string) => {
          const el = document.querySelector(sel) as HTMLSelectElement | null;
          return !!el && [...el.options].some((o) => (o.textContent ?? "").trim() === txt);
        },
        T(id),
        text,
      ),
    { timeout: 20000, timeoutMsg: `option "${text}" never appeared in ${id}` },
  );
  await browser.execute(
    (sel: string, txt: string) => {
      const el = document.querySelector(sel) as HTMLSelectElement | null;
      if (!el) throw new Error(`select not found: ${sel}`);
      const opt = [...el.options].find((o) => (o.textContent ?? "").trim() === txt);
      if (!opt) throw new Error(`option not found: ${txt}`);
      const setter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value",
      )?.set;
      setter?.call(el, opt.value);
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    T(id),
    text,
  );
}

/** A dialog (confirm/prompt) intercepted by the stub, with its message. */
export type CapturedDialog = { type: "confirm" | "prompt"; message: string };

type DialogWindow = Window & {
  __e2eDialogs?: CapturedDialog[];
  __e2eOrigConfirm?: typeof window.confirm;
  __e2eOrigPrompt?: typeof window.prompt;
};

/**
 * Override window.confirm / window.prompt in the webview so destructive flows
 * that gate on them (connection delete, table delete-from-list, item delete)
 * proceed deterministically. Each intercepted dialog's MESSAGE is pushed to
 * window.__e2eDialogs so a flow can assert the dialog was actually shown and
 * carried the expected text (see getDialogs / assertDialogShown).
 *
 * Page navigations reset window state, so callers install the stub right before
 * the click that triggers the dialog; installing also clears the capture buffer
 * so an assertion only sees dialogs from the current flow. restoreDialogs()
 * puts the originals back (called from the afterTest hook).
 */
export async function stubDialogs(promptResponse: string | null = null): Promise<void> {
  await browser.execute((resp: string | null) => {
    const w = window as DialogWindow;
    w.__e2eDialogs = [];
    if (!w.__e2eOrigConfirm) w.__e2eOrigConfirm = window.confirm;
    if (!w.__e2eOrigPrompt) w.__e2eOrigPrompt = window.prompt;
    window.confirm = (message?: string): boolean => {
      w.__e2eDialogs?.push({ type: "confirm", message: message ?? "" });
      return true;
    };
    window.prompt = (message?: string): string | null => {
      w.__e2eDialogs?.push({ type: "prompt", message: message ?? "" });
      return resp;
    };
  }, promptResponse);
}

/** Retrieve the dialogs captured by stubDialogs since it was last installed. */
export async function getDialogs(): Promise<CapturedDialog[]> {
  return browser.execute(() => (window as DialogWindow).__e2eDialogs ?? []);
}

/**
 * Assert a dialog of the given type was captured; when `contains` is given, also
 * assert its message includes that substring. Returns the matching dialog.
 */
export async function assertDialogShown(
  type: CapturedDialog["type"],
  contains?: string,
): Promise<CapturedDialog> {
  const dialogs = await getDialogs();
  const match = dialogs.find((d) => d.type === type);
  if (!match) {
    throw new Error(
      `expected a ${type} dialog to be shown, saw ${JSON.stringify(dialogs)}`,
    );
  }
  if (contains !== undefined) {
    expect(match.message).toContain(contains);
  }
  return match;
}

/** Restore the original window.confirm / window.prompt and clear the buffer. */
export async function restoreDialogs(): Promise<void> {
  await browser.execute(() => {
    const w = window as DialogWindow;
    if (w.__e2eOrigConfirm) {
      window.confirm = w.__e2eOrigConfirm;
      w.__e2eOrigConfirm = undefined;
    }
    if (w.__e2eOrigPrompt) {
      window.prompt = w.__e2eOrigPrompt;
      w.__e2eOrigPrompt = undefined;
    }
    w.__e2eDialogs = [];
  });
}

// --- navigation --------------------------------------------------------------

export async function gotoConnections(): Promise<void> {
  const link = $(T("nav-connections"));
  if (await link.isExisting()) {
    await link.click();
  }
  await waitDisplayed(T("connections-heading"));
}

/** Navigate via the hash router (robust across screens once a connection is active). */
export async function navigateHash(path: string): Promise<void> {
  await browser.execute((p: string) => {
    window.location.hash = p;
  }, path);
}

export async function gotoTables(): Promise<void> {
  await navigateHash("#/dynamodb/tables");
  await waitDisplayed(T("tables-heading"));
  // Wait for the list to settle (count element present).
  await waitDisplayed(T("tables-count"));
}

export async function gotoExplore(table?: string): Promise<void> {
  await navigateHash(table ? `#/dynamodb/explore?table=${encodeURIComponent(table)}` : "#/dynamodb/explore");
  await waitDisplayed(T("explore-table-select"));
}

export async function gotoDashboard(): Promise<void> {
  await navigateHash("#/dynamodb");
  await waitDisplayed(T("dashboard-heading"));
}

export async function gotoPartiql(): Promise<void> {
  await navigateHash("#/dynamodb/partiql");
  await waitDisplayed(T("partiql-statement"));
}

export async function gotoBackups(): Promise<void> {
  await navigateHash("#/dynamodb/backups");
  await waitDisplayed(T("backups-heading"));
}

/** Count DOM nodes matching a data-testid (avoids webkit stale-element flakiness). */
export async function countByTestId(id: string): Promise<number> {
  return browser.execute((sel: string) => document.querySelectorAll(sel).length, T(id));
}

// --- connections -------------------------------------------------------------

export type RegisterOpts = {
  name: string;
  endpoint?: string;
  region?: string;
};

/** Register a connection profile through the connection form. */
export async function registerConnection(opts: RegisterOpts): Promise<void> {
  await gotoConnections();
  await clickT("add-connection");
  await setValueT("conn-name", opts.name);
  await setValueT("conn-endpoint", opts.endpoint ?? E2E_ENDPOINT);
  if (opts.region) await setValueT("conn-region", opts.region);
  await clickT("save-connection");
  await waitDisplayed(T("connection-row"));
}

/** Click "この接続を使う" on the given row index (default: first). Lands on Home. */
export async function useConnection(index = 0): Promise<void> {
  const buttons = await $$(T("use-connection"));
  await buttons[index].waitForClickable({ timeout: 15000 });
  await buttons[index].click();
  await waitDisplayed(T("home-heading"));
}

function rowByName(name: string) {
  return $(
    `//*[@data-testid="connection-row"][.//b[normalize-space()="${name}"]]`,
  );
}

/** Click "この接続を使う" on the row whose name matches. Lands on Home. */
export async function useConnectionByName(name: string): Promise<void> {
  const btn = rowByName(name).$(T("use-connection"));
  await btn.waitForClickable({ timeout: 15000 });
  await btn.click();
  await waitDisplayed(T("home-heading"));
}

/** Delete the connection row whose name matches (window.confirm is stubbed). */
export async function deleteConnectionByName(name: string): Promise<void> {
  await stubDialogs();
  const btn = rowByName(name).$(T("delete-connection"));
  await btn.waitForClickable({ timeout: 15000 });
  await btn.click();
  await browser.waitUntil(async () => !(await rowByName(name).isExisting()), {
    timeout: 15000,
    timeoutMsg: `connection "${name}" was not removed`,
  });
}

/** Open the edit modal for the named connection. */
export async function editConnectionByName(name: string): Promise<void> {
  const btn = rowByName(name).$(T("edit-connection"));
  await btn.waitForClickable({ timeout: 15000 });
  await btn.click();
  await waitDisplayed(T("conn-name"));
}

/** True if a connection row with the given name is present. */
export async function connectionRowExists(name: string): Promise<boolean> {
  return rowByName(name).isExisting();
}

/** Text of the connection row whose name matches (name / endpoint / region line). */
export async function connectionRowText(name: string): Promise<string> {
  return rowByName(name).getText();
}

/** Register a connection and switch to it, ending on Home. */
export async function setupActiveConnection(opts: RegisterOpts): Promise<void> {
  await registerConnection(opts);
  await useConnectionByName(opts.name);
}

/**
 * Delete every registered connection through the UI so a spec can assert the
 * zero-profile state (R14). Independent of the per-session config reset so it
 * works regardless of spec ordering / cross-session leftovers.
 */
export async function connectionRowCount(): Promise<number> {
  return browser.execute(
    (sel: string) => document.querySelectorAll(sel).length,
    T("connection-row"),
  );
}

export async function clearAllConnections(): Promise<void> {
  await gotoConnections();
  await stubDialogs();
  for (let i = 0; i < 50; i++) {
    const before = await connectionRowCount();
    if (before === 0) return;
    await clickT("delete-connection");
    await browser.waitUntil(async () => (await connectionRowCount()) < before, {
      timeout: 10000,
      timeoutMsg: "connection row was not removed",
    });
  }
}

// --- tables ------------------------------------------------------------------

export type UiKey = { name: string; type?: "S" | "N" | "B" };
export type UiGsi = { name: string; pk: UiKey; sk?: UiKey };

export type CreateTableOpts = {
  name: string;
  pk: UiKey;
  sk?: UiKey;
  gsi?: UiGsi;
};

async function setKeyType(typeTestId: string, type: "S" | "N" | "B"): Promise<void> {
  if (type === "S") return; // default
  await setSelectValue(typeTestId, type);
}

/** Create a table through the create-table modal (PK-only, PK+SK, or +1 GSI). */
export async function createTableViaUI(opts: CreateTableOpts): Promise<void> {
  await clickT("tables-create");
  await setValueT("ct-name", opts.name);
  await setValueT("ct-pk-name", opts.pk.name);
  if (opts.pk.type) await setKeyType("ct-pk-type", opts.pk.type);
  if (opts.sk) {
    await setValueT("ct-sk-name", opts.sk.name);
    if (opts.sk.type) await setKeyType("ct-sk-type", opts.sk.type);
  }
  if (opts.gsi) {
    await clickT("ct-add-gsi");
    await setValueT("ct-gsi-name-0", opts.gsi.name);
    await setValueT("ct-gsi-pk-name-0", opts.gsi.pk.name);
    if (opts.gsi.pk.type) await setKeyType("ct-gsi-pk-type-0", opts.gsi.pk.type);
  }
  await clickT("ct-submit");
  // Modal closes and the list reloads; wait for the new row link to appear.
  await waitForTableRow(opts.name);
}

export async function waitForTableRow(name: string, timeout = 30000): Promise<void> {
  await waitDisplayed(T(`table-link-${name}`), timeout);
}

export async function openTableDetail(name: string): Promise<void> {
  await clickT(`table-link-${name}`);
  await waitDisplayed(T("td-tab-overview"));
}

/** Full text of the list row for a table (name + status + keys + index count). */
export function tableRowText(name: string): Promise<string> {
  return $(`//tr[.//a[@data-testid="table-link-${name}"]]`).getText();
}

/**
 * Text of the index-count cell specifically (6th column: checkbox, name, status,
 * PK, SK, index count) so the R4 assertion targets the count, not the whole row.
 */
export function tableIndexCountText(name: string): Promise<string> {
  return $(`//tr[.//a[@data-testid="table-link-${name}"]]/td[6]`).getText();
}

/** Wait until the row's async describe has populated its status cell. */
export async function waitForTableActive(name: string, timeout = 30000): Promise<void> {
  await browser.waitUntil(async () => (await tableRowText(name)).includes("アクティブ"), {
    timeout,
    timeoutMsg: `table ${name} never showed アクティブ status`,
  });
}

/**
 * Delete a table from the list: tick its checkbox, click 削除, then confirm via
 * the name-typed ConfirmDangerModal (the former window.prompt was replaced by the
 * shared modal — the confirm button stays disabled until the name is typed).
 */
export async function deleteTableFromList(name: string): Promise<void> {
  const box = await waitDisplayed(`[aria-label="${name} を選択"]`);
  await box.click();
  await clickT("tables-delete");
  // Confirm stays disabled until the exact table name is typed (R6 list path).
  await setValueT("tables-delete-input", name);
  await clickT("tables-delete-confirm");
  await browser.waitUntil(async () => !(await $(T(`table-link-${name}`)).isExisting()), {
    timeout: 20000,
    timeoutMsg: `table ${name} was not removed from the list`,
  });
}

/** Delete a table from its detail page via the name-confirmation modal. */
export async function deleteTableViaDetail(name: string): Promise<void> {
  await clickT("td-delete");
  await setValueT("td-delete-input", name);
  await clickT("td-delete-confirm");
  await waitDisplayed(T("tables-heading"));
}

export async function openIndexesTab(): Promise<void> {
  await clickT("td-tab-indexes");
  await waitDisplayed(T("td-indexes"));
}

// --- explore / items ---------------------------------------------------------

export async function selectExploreTable(name: string): Promise<void> {
  await setSelectValue("explore-table-select", name);
}

export async function runScan(filter?: {
  attr: string;
  op: "eq" | "contains";
  value: string;
}): Promise<void> {
  // Reset any state left over from a previous test (the ExplorePage stays
  // mounted across in-app navigation): index, mode, and the filter fields.
  await setSelectValue("explore-index-select", "");
  await clickT("explore-mode-scan");
  await clickT("explore-reset");
  if (filter) {
    await setValueT("explore-filter-attr", filter.attr);
    await setSelectValue("explore-filter-op", filter.op);
    await setValueT("explore-filter-value", filter.value);
  }
  await clickT("explore-run");
  await waitForNotLoading();
}

export async function runQuery(opts: {
  pkValue: string;
  sk?: { op: "eq" | "begins_with"; value: string };
  index?: string;
}): Promise<void> {
  await clickT("explore-mode-query");
  // Reset leftover index + key values before configuring this query.
  await setSelectValue("explore-index-select", opts.index ?? "");
  await clickT("explore-reset");
  await setValueT("explore-pk-value", opts.pkValue);
  if (opts.sk) {
    await setSelectValue("explore-sk-op", opts.sk.op);
    await setValueT("explore-sk-value", opts.sk.value);
  }
  await clickT("explore-run");
  await waitForNotLoading();
}

/** Wait until the "読み込み中..." indicator is gone. */
export async function waitForNotLoading(timeout = 20000): Promise<void> {
  await browser.waitUntil(
    async () => browser.execute(() => !document.body.innerText.includes("読み込み中...")),
    { timeout, timeoutMsg: "results still loading" },
  );
}

export async function exploreRowCount(): Promise<number> {
  // Count DOM nodes directly to avoid webkit-driver stale-element flakiness.
  return browser.execute(
    (sel: string) => document.querySelectorAll(sel).length,
    T("explore-row"),
  );
}

export async function waitForRowCount(expected: number, timeout = 20000): Promise<void> {
  let last = -1;
  await browser.waitUntil(
    async () => {
      last = await exploreRowCount();
      return last === expected;
    },
    { timeout, timeoutMsg: `expected exactly ${expected} result rows, last saw ${last}` },
  );
}

export async function waitForRowCountAtLeast(min: number, timeout = 20000): Promise<void> {
  let last = -1;
  await browser.waitUntil(
    async () => {
      last = await exploreRowCount();
      return last >= min;
    },
    { timeout, timeoutMsg: `expected at least ${min} result rows, last saw ${last}` },
  );
}

/** Read the current page number shown by the paginator. */
export async function currentPageNumber(): Promise<number> {
  const el = await waitDisplayed(T("explore-page"));
  return Number(await el.getText());
}

/** Create an item via the editor modal. Text is the JSON body for the current mode. */
export async function createItem(json: string, ddbMode = false): Promise<void> {
  await clickT("explore-create-item");
  if (ddbMode) await clickT("item-ddb-toggle");
  await setValueT("item-json", json);
  await clickT("item-save");
  await waitForModalClosed();
  await waitForNotLoading();
}

/** Open an existing item by clicking its PK link (row index), edit JSON, save. */
export async function editItemAt(rowIndex: number, newJson: string, toggleDdb = false): Promise<void> {
  const links = await $$(T("explore-pk-link"));
  await links[rowIndex].click();
  await waitDisplayed(T("item-json"));
  if (toggleDdb) await clickT("item-ddb-toggle");
  await setValueT("item-json", newJson);
  await clickT("item-save");
  await waitForModalClosed();
  await waitForNotLoading();
}

export async function waitForModalClosed(timeout = 15000): Promise<void> {
  const json = $(T("item-json"));
  await json.waitForExist({ reverse: true, timeout });
}

/** Select the given row indexes and delete them via the actions menu. */
export async function deleteRows(indexes: number[]): Promise<void> {
  const boxes = await $$(T("explore-row-checkbox"));
  for (const i of indexes) await boxes[i].click();
  await clickT("explore-actions");
  await clickT("explore-delete");
  await waitForNotLoading();
}

/** Open the item editor by clicking the PK-link whose text matches. */
export async function openItemByPk(pkText: string): Promise<void> {
  const link = $(
    `//button[@data-testid="explore-pk-link"][normalize-space()="${pkText}"]`,
  );
  await link.waitForClickable({ timeout: 15000 });
  await link.click();
  await waitDisplayed(T("item-json"));
}

/** Tick the checkbox of the row whose PK-link matches, then delete via actions. */
export async function deleteRowByPk(pkText: string): Promise<void> {
  await stubDialogs();
  const box = $(
    `//tr[.//button[@data-testid="explore-pk-link"][normalize-space()="${pkText}"]]//input[@data-testid="explore-row-checkbox"]`,
  );
  await box.waitForClickable({ timeout: 15000 });
  await box.click();
  await clickT("explore-actions");
  await clickT("explore-delete");
  // The item-delete path gates on a window.confirm; verify it was shown (R12).
  await assertDialogShown("confirm");
  await waitForNotLoading();
}

/** Visible PK-link texts of the current explore result page, in row order. */
export async function explorePkTexts(): Promise<string[]> {
  return browser.execute(
    (sel: string) =>
      [...document.querySelectorAll(sel)].map((el) => (el.textContent ?? "").trim()),
    T("explore-pk-link"),
  );
}

/** True if a result row with the given PK-link text is present. */
export function itemRowExists(pkText: string): Promise<boolean> {
  return $(
    `//button[@data-testid="explore-pk-link"][normalize-space()="${pkText}"]`,
  ).isExisting();
}

// --- header (R3 / R17) -------------------------------------------------------

export async function switchConnectionByName(name: string): Promise<void> {
  await setSelectByVisibleText("header-conn-select", name);
}

export async function changeRegionViaHeader(region: string): Promise<void> {
  await setSelectValue("header-region-select", region);
}

// --- SQS / SNS / S3 / RDS navigation (R22-R35) -------------------------------
// Added for the four Phase-2 services. These follow the same hash-router pattern
// as the DynamoDB gotos above; existing helpers are left untouched.

export async function gotoSqsDashboard(): Promise<void> {
  await navigateHash("#/sqs");
  await waitDisplayed(T("sqs-dashboard-heading"));
}

export async function gotoQueues(): Promise<void> {
  await navigateHash("#/sqs/queues");
  await waitDisplayed(T("queues-heading"));
  await waitDisplayed(T("queues-count"));
}

export async function gotoQueueDetail(name: string): Promise<void> {
  await navigateHash(`#/sqs/queues/${encodeURIComponent(name)}`);
  await waitDisplayed(T("tab-messages"));
}

/**
 * Click a button that stays disabled while the page data is still loading
 * (e.g. queue-send is disabled until the queue detail resolves). Slow runners
 * (Windows CI) can reach the click before the fetch finishes, so wait for the
 * enabled state first.
 */
export async function clickEnabledT(id: string, timeout = 20000) {
  const el = await waitDisplayed(T(id), timeout);
  await browser.waitUntil(async () => el.isEnabled(), {
    timeout,
    timeoutMsg: `${id} never became enabled`,
  });
  await el.click();
  return el;
}

export async function gotoSnsDashboard(): Promise<void> {
  await navigateHash("#/sns");
  await waitDisplayed(T("sns-dash-topics"));
}

export async function gotoSnsSubscriptions(): Promise<void> {
  await navigateHash("#/sns/subscriptions");
  await waitDisplayed(T("subscriptions-table"));
}

export async function gotoTopics(): Promise<void> {
  await navigateHash("#/sns/topics");
  await waitDisplayed(T("topics-heading"));
  await waitDisplayed(T("topics-count"));
}

export async function gotoTopicDetail(name: string): Promise<void> {
  await navigateHash(`#/sns/topics/${encodeURIComponent(name)}`);
  await waitDisplayed(T("tab-subs"));
}

export async function gotoBuckets(): Promise<void> {
  await navigateHash("#/s3/buckets");
  await waitDisplayed(T("buckets-heading"));
  await waitDisplayed(T("buckets-count"));
}

export async function gotoBucketBrowser(bucket: string, prefix?: string): Promise<void> {
  const base = `#/s3/buckets/${encodeURIComponent(bucket)}`;
  await navigateHash(prefix ? `${base}?prefix=${encodeURIComponent(prefix)}` : base);
  await waitDisplayed(T("browser-heading"));
  // In-app navigation reuses the BucketBrowser component, so the tab a previous
  // test left active (e.g. プロパティ) persists. Reset to the objects tab so the
  // object list / versions toggle are present for the caller.
  await clickT("tab-objects");
}

export async function gotoInstances(): Promise<void> {
  await navigateHash("#/rds/instances");
  await waitDisplayed(T("instances-heading"));
}

export async function gotoRdsDashboard(): Promise<void> {
  await navigateHash("#/rds");
  await waitDisplayed(T("rds-dashboard-heading"));
}

export async function gotoSnapshots(): Promise<void> {
  await navigateHash("#/rds/snapshots");
  await waitDisplayed(T("snapshots-heading"));
}

export async function gotoParameterGroups(): Promise<void> {
  await navigateHash("#/rds/parameter-groups");
  await waitDisplayed(T("pgroups-heading"));
}

// --- Cognito navigation (R60-R62) --------------------------------------------

export async function gotoCognitoDashboard(): Promise<void> {
  await navigateHash("#/cognito");
  await waitDisplayed(T("cognito-dashboard-heading"));
}

export async function gotoUserPools(): Promise<void> {
  await navigateHash("#/cognito/user-pools");
  await waitDisplayed(T("user-pools-heading"));
}

export async function gotoUserPoolDetail(id: string): Promise<void> {
  await navigateHash(`#/cognito/user-pools/${encodeURIComponent(id)}`);
  await waitDisplayed(T("tab-users"));
}

export { $, $$, browser, expect };
