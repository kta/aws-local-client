import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
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

/**
 * S3 requirements (R29-R32).
 *   R29 UI create / list a bucket; a non-empty delete surfaces an error, an empty
 *       delete succeeds.
 *   R30 SDK-seed a/b.txt, a/c/d.txt, e.txt -> prefix navigation, breadcrumbs, ?prefix=.
 *   R31 UI upload (file input) -> SDK GetObject matches; UI download -> file on disk
 *       matches.
 *   R32 the detail panel shows object metadata; selection delete removes it.
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

  it("R31: uploads via the file input and downloads to disk", async () => {
    const name = `bk31-${stamp}`;
    await seedBucket(name);
    const content = `s3-upload-${stamp}`;
    const fileName = "up.txt";

    await gotoBucketBrowser(name);

    // Synthesize a File on the hidden file input and fire change (the embedded
    // webkit driver cannot drive a native file picker).
    await browser.execute(
      (sel: string, fname: string, body: string) => {
        const input = document.querySelector(sel) as HTMLInputElement | null;
        if (!input) throw new Error(`file input not found: ${sel}`);
        const dt = new DataTransfer();
        dt.items.add(new File([body], fname, { type: "text/plain" }));
        input.files = dt.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      },
      T("object-upload-input"),
      fileName,
      content,
    );

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
});
