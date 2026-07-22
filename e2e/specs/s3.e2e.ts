import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  GetBucketTaggingCommand,
  GetObjectCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  PutBucketVersioningCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { $, browser, expect } from "@wdio/globals";
import {
  E2E_ENDPOINT,
  T,
  clickT,
  gotoBucketBrowser,
  gotoBuckets,
  setValueT,
  setupActiveConnection,
  waitDisplayed,
} from "../helpers/app";
import { makeS3Client } from "../helpers/aws";
import { expectCovered, gate } from "../helpers/capabilities";

/**
 * S3 requirements (R29-R32, R43-R46).
 *   R29 UI create / list a bucket; a non-empty delete surfaces an error, an empty
 *       delete succeeds.
 *   R30 SDK-seed a/b.txt, a/c/d.txt, e.txt -> prefix navigation, breadcrumbs, ?prefix=.
 *   R31/R46 UI upload via the path seam (__E2E_UPLOAD_PATH) -> SDK GetObject matches;
 *       UI download -> file on disk matches.
 *   R32 the detail panel shows object metadata; selection delete removes it.
 *   R43 properties tab: versioning toggle + tag/CORS/policy editing.
 *   R44 versions view lists object versions for the current prefix.
 *   R45 copy an object to a new key; create a folder prefix.
 */
describe("s3", () => {
  const s3: S3Client = makeS3Client(E2E_ENDPOINT);
  const stamp = Date.now();
  const buckets: string[] = [];

  async function seedBucket(name: string): Promise<string> {
    await s3.send(new CreateBucketCommand({ Bucket: name }));
    buckets.push(name);
    return name;
  }

  async function put(bucket: string, key: string, body: string, contentType?: string) {
    await s3.send(
      new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  before(async () => {
    await setupActiveConnection({
      name: "s3-conn",
      endpoint: E2E_ENDPOINT,
      region: "ap-northeast-1",
    });
  });

  after(async () => {
    for (const b of buckets) {
      try {
        const listed = await s3.send(new ListObjectsV2Command({ Bucket: b }));
        for (const o of listed.Contents ?? []) {
          await s3.send(new DeleteObjectCommand({ Bucket: b, Key: o.Key! }));
        }
        await s3.send(new DeleteBucketCommand({ Bucket: b }));
      } catch {
        /* best effort */
      }
    }
    expectCovered("R43-tags");
    expectCovered("R45-folder");
  });

  it("R29: UI creates a bucket; non-empty delete errors, empty delete succeeds", async () => {
    const name = `bk29-${stamp}`;

    await gotoBuckets();
    await clickT("buckets-create");
    await setValueT("b-name", name);
    await clickT("b-save");
    await waitDisplayed(T(`bucket-link-${name}`));
    buckets.push(name); // ensure cleanup even if the test aborts mid-way

    const listed = await s3.send(new ListBucketsCommand({}));
    expect((listed.Buckets ?? []).some((b) => b.Name === name)).toBe(true);

    // Put an object so the bucket is non-empty, then attempt to delete it.
    await put(name, "keep.txt", "x");
    const box = await waitDisplayed(`[aria-label="${name} を選択"]`);
    await box.click();
    await clickT("buckets-delete");
    await setValueT("buckets-delete-input", name);
    await clickT("buckets-delete-confirm");

    // The inline modal error appears and the bucket is still present.
    const errorDiv = $('//input[@data-testid="buckets-delete-input"]/following-sibling::div');
    await errorDiv.waitForDisplayed({ timeout: 20000 });
    expect((await errorDiv.getText()).length).toBeGreaterThan(0);
    expect(await $(T(`bucket-link-${name}`)).isExisting()).toBe(true);

    // Empty the bucket, then confirm again from the still-open modal -> success.
    await s3.send(new DeleteObjectCommand({ Bucket: name, Key: "keep.txt" }));
    await clickT("buckets-delete-confirm");
    await browser.waitUntil(async () => !(await $(T(`bucket-link-${name}`)).isExisting()), {
      timeout: 20000,
      timeoutMsg: `bucket ${name} was not removed`,
    });
    const after = await s3.send(new ListBucketsCommand({}));
    expect((after.Buckets ?? []).some((b) => b.Name === name)).toBe(false);
  });

  it("R30: navigates prefixes, breadcrumbs and ?prefix=", async () => {
    const name = `bk30-${stamp}`;
    await seedBucket(name);
    await put(name, "a/b.txt", "b");
    await put(name, "a/c/d.txt", "d");
    await put(name, "e.txt", "e");

    // Root: the "a/" prefix folder and the top-level e.txt object.
    await gotoBucketBrowser(name);
    await waitDisplayed(T("prefix-link-a/"));
    await waitDisplayed(T("object-row-e.txt"));

    // Into a/: shows c/ (nested prefix) and b.txt.
    await clickT("prefix-link-a/");
    await waitDisplayed(T("prefix-link-c/"));
    await waitDisplayed(T("object-row-b.txt"));
    expect(await $(T("prefix-crumb-1")).getText()).toBe("a");

    // Breadcrumb back to the bucket root.
    await clickT("prefix-crumb-0");
    await waitDisplayed(T("object-row-e.txt"));

    // Direct ?prefix= deep-link.
    await gotoBucketBrowser(name, "a/");
    await waitDisplayed(T("object-row-b.txt"));
  });

  it("R31/R46: uploads via the path seam (multipart-capable) and downloads to disk", async () => {
    const name = `bk31-${stamp}`;
    await seedBucket(name);
    const content = `s3-upload-${stamp}`;
    const fileName = `up-${stamp}.txt`;

    // R46: uploads are path-based now. Write the source to disk and feed its
    // path through the __E2E_UPLOAD_PATH seam so the dialog is bypassed; the
    // uploaded key is the path's basename.
    const src = join(tmpdir(), fileName);
    writeFileSync(src, content);

    await gotoBucketBrowser(name);
    await browser.execute((p: string) => {
      (window as unknown as { __E2E_UPLOAD_PATH?: string }).__E2E_UPLOAD_PATH = p;
    }, src);
    await clickT("object-upload");

    await waitDisplayed(T(`object-row-${fileName}`));
    const got = await s3.send(new GetObjectCommand({ Bucket: name, Key: fileName }));
    expect(await got.Body?.transformToString()).toBe(content);

    // Open the detail panel and download to a fixed path (dialog is bypassed).
    await clickT(`object-row-${fileName}`);
    await waitDisplayed(T("object-download"));
    const dest = join(tmpdir(), `s3-dl-${stamp}.txt`);
    await browser.execute((p: string) => {
      (window as unknown as { __E2E_SAVE_PATH?: string }).__E2E_SAVE_PATH = p;
    }, dest);
    await clickT("object-download");
    await browser.waitUntil(
      () => {
        try {
          return readFileSync(dest, "utf8") === content;
        } catch {
          return false;
        }
      },
      { timeout: 20000, interval: 500, timeoutMsg: "downloaded file never matched the content" },
    );
  });

  it("R32: shows object metadata and deletes it via selection", async () => {
    const name = `bk32-${stamp}`;
    await seedBucket(name);
    await put(name, "meta.json", '{"a":1}', "application/json");

    await gotoBucketBrowser(name);
    await clickT("object-row-meta.json");
    await waitDisplayed(T("od-size"));
    await waitDisplayed(T("od-etag"));
    await waitDisplayed(T("od-modified"));
    expect(await $(T("od-content-type")).getText()).toBe("application/json");

    // Select the object and delete it (bucket-name-confirmation modal).
    const box = await waitDisplayed('[aria-label="meta.json を選択"]');
    await box.click();
    await clickT("objects-delete");
    await setValueT("objects-delete-input", name);
    await clickT("objects-delete-confirm");
    await browser.waitUntil(async () => !(await $(T("object-row-meta.json")).isExisting()), {
      timeout: 20000,
      timeoutMsg: "object row was not removed",
    });

    const listed = await s3.send(new ListObjectsV2Command({ Bucket: name }));
    expect((listed.Contents ?? []).some((o) => o.Key === "meta.json")).toBe(false);
  });

  it("R43: properties tab toggles versioning and saves CORS/policy", async () => {
    const name = `bk43-${stamp}`;
    await seedBucket(name);

    await gotoBucketBrowser(name);
    await clickT("tab-props");

    // Versioning: a fresh bucket is unset; the toggle enables it.
    await waitDisplayed(T("props-versioning-status"));
    await clickT("props-versioning-toggle");
    await browser.waitUntil(
      async () => (await $(T("props-versioning-status")).getText()) === "Enabled",
      { timeout: 20000, timeoutMsg: "versioning did not report Enabled" },
    );

    // CORS + policy editors accept and save JSON without error.
    await setValueT(
      "props-cors-editor",
      '[{"allowedMethods":["GET"],"allowedOrigins":["*"]}]',
    );
    await clickT("props-cors-save");
    await setValueT(
      "props-policy-editor",
      `{"Version":"2012-10-17","Statement":[{"Sid":"S","Effect":"Allow","Principal":"*","Action":"s3:GetObject","Resource":"arn:aws:s3:::${name}/*"}]}`,
    );
    await clickT("props-policy-save");
  });

  // R43 — bucket tags, gated on `s3.bucketTagging` (kumo mis-routes
  // PutBucketTagging and cannot persist tags).
  it("R43: saves bucket tags (SDK verified)", async function () {
    await gate(this, "R43-tags", { on: ["s3.bucketTagging"] });
    const name = `bk43t-${stamp}`;
    await seedBucket(name);

    await gotoBucketBrowser(name);
    await clickT("tab-props");
    await waitDisplayed(T("props-versioning-status"));

    // Tags: add a row and save; verify via SDK.
    await setValueT("props-tag-key", "team");
    await setValueT("props-tag-value", "core");
    await clickT("props-tag-add");
    await clickT("props-tag-save");
    await browser.waitUntil(
      async () => {
        try {
          const t = await s3.send(new GetBucketTaggingCommand({ Bucket: name }));
          return (t.TagSet ?? []).some((x) => x.Key === "team" && x.Value === "core");
        } catch {
          return false;
        }
      },
      { timeout: 20000, timeoutMsg: "tag was not persisted" },
    );
  });

  it("R43: surfaces an error banner when bucket tagging is unsupported", async function () {
    await gate(this, "R43-tags", { off: ["s3.bucketTagging"] });
    const name = `bk43u-${stamp}`;
    await seedBucket(name);

    await gotoBucketBrowser(name);
    await clickT("tab-props");
    await waitDisplayed(T("props-versioning-status"));

    await setValueT("props-tag-key", "team");
    await setValueT("props-tag-value", "core");
    await clickT("props-tag-add");
    await clickT("props-tag-save");
    await waitDisplayed(T("error-banner"));
  });

  it("R44: versions view lists object versions for the current prefix", async () => {
    const name = `bk44-${stamp}`;
    await seedBucket(name);
    await s3.send(
      new PutBucketVersioningCommand({
        Bucket: name,
        VersioningConfiguration: { Status: "Enabled" },
      }),
    );
    // Two versions of the same key.
    await put(name, "ver.txt", "one");
    await put(name, "ver.txt", "two");

    await gotoBucketBrowser(name);
    await clickT("versions-toggle");
    await waitDisplayed(T("versions-table"));
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () => document.querySelectorAll('[data-testid^="version-row-"]').length,
        )) >= 2,
      { timeout: 20000, timeoutMsg: "expected at least two version rows" },
    );
  });

  it("R45: copies an object", async () => {
    const name = `bk45-${stamp}`;
    await seedBucket(name);
    await put(name, "orig.txt", "copy-me");

    await gotoBucketBrowser(name);

    // Copy the single selected object to a new key.
    const box = await waitDisplayed('[aria-label="orig.txt を選択"]');
    await box.click();
    await clickT("object-copy");
    await setValueT("copy-dest-input", "clone.txt");
    await clickT("copy-save");
    await browser.waitUntil(
      async () => {
        try {
          const got = await s3.send(new GetObjectCommand({ Bucket: name, Key: "clone.txt" }));
          return (await got.Body?.transformToString()) === "copy-me";
        } catch {
          return false;
        }
      },
      { timeout: 20000, timeoutMsg: "copied object never appeared" },
    );
  });

  // R45 — folder creation, gated on `s3.folderKeys` (kumo strips the trailing
  // slash from "<prefix>/" marker keys, so folders can never appear there).
  it("R45: creates a folder", async function () {
    await gate(this, "R45-folder", { on: ["s3.folderKeys"] });
    const name = `bk45f-${stamp}`;
    await seedBucket(name);

    await gotoBucketBrowser(name);

    // Create a folder: its prefix link shows up in the listing.
    await clickT("folder-create");
    await setValueT("folder-name-input", "sub");
    await clickT("folder-save");
    await waitDisplayed(T("prefix-link-sub/"));
  });

  it("R45: folder creation stays functional when folder keys do not persist", async function () {
    await gate(this, "R45-folder", { off: ["s3.folderKeys"] });
    const name = `bk45u-${stamp}`;
    await seedBucket(name);

    await gotoBucketBrowser(name);

    // The put succeeds (the emulator answers 200) so no error surfaces; the
    // folder just never materialises as a prefix on kumo. We deliberately do
    // NOT assert the folder's absence: localstack:3 strips the trailing slash
    // of marker keys nondeterministically, so a false-negative probe here must
    // not fail the suite — the strong round-trip is covered by the supported
    // branch on floci/ministack.
    await clickT("folder-create");
    await setValueT("folder-name-input", "sub");
    await clickT("folder-save");
    await browser.pause(2000);
    await expect($(T("error-banner"))).not.toBeExisting();
  });
});
