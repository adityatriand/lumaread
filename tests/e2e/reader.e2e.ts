import { bookFrame, expect, fixture, idb, importAll, row, test, setPrefs } from "./helpers";

test("a plain browser gets only the app-only screen", async ({ browser }) => {
  const web = await browser.newPage();
  await web.goto("/");
  await expect(web.getByText("Open the installed app to read.")).toBeVisible();
  await expect(web.locator("input[type=file]")).toHaveCount(0);
  await web.close();
});

test("imports EPUB and PDF, rejects unsupported and duplicate files", async ({ page }) => {
  await importAll(page);
  await expect(row(page, "Smoke PDF")).toContainText("PDF");
  await expect(row(page, "Smoke Test Book")).toContainText("Test Author");

  await page.setInputFiles("input[type=file]", [fixture("bad.pdf"), fixture("doc.pdf")]);
  await expect(page.getByRole("alert")).toContainText("not a supported EPUB or PDF");
  await expect(page.getByRole("alert")).toContainText("already in your library");
  await expect(page.locator(".doc-row")).toHaveCount(2);
});

test("PDF: renders selectable text and restores page after reload", async ({ page }) => {
  await importAll(page);
  await row(page, "Smoke PDF").click();
  await expect(page.locator(".textLayer").first()).toContainText("Page 1 hello LumaRead");

  await page.getByRole("button", { name: "Next page" }).click();
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.locator(".reader-bar.footer")).toContainText("Page 3 / 3");
  // Progress writes are async; wait until page 3 is stored before reloading
  await expect.poll(async () => (await idb<{ anchor: { page: number } }>(page, "progress")).map((p) => p.anchor.page)).toContain(3);

  await page.reload();
  await row(page, "Smoke PDF").click();
  await expect(page.locator(".reader-bar.footer")).toContainText("Page 3 / 3");
});

test("EPUB: blocks book scripts, navigates chapters, restores location and prefs", async ({ page }) => {
  await importAll(page);
  await setPrefs(page, { layout: "spread" });
  await row(page, "Smoke Test Book").click();
  const book = bookFrame(page);
  await expect(book.locator("h1")).toHaveText("Chapter 1");
  expect(await page.evaluate(() => (window as { __pwned?: number }).__pwned)).toBeUndefined();

  await page.getByLabel("Chapter").selectOption({ label: "Chapter Two" });
  await expect(book.locator("h1")).toHaveText("Chapter 2");

  await page.getByRole("button", { name: "Reading preferences" }).click();
  await page.getByLabel("Sepia").check();
  await expect(page.locator(".reader")).toHaveClass(/theme-sepia/);

  await page.reload();
  await row(page, "Smoke Test Book").click();
  await expect(bookFrame(page).locator("h1")).toHaveText("Chapter 2");
  await expect(page.locator(".reader")).toHaveClass(/theme-sepia/);
});

test("removing a document deletes its stored file", async ({ page }) => {
  await importAll(page);
  page.on("dialog", (d) => d.accept());
  await page.getByLabel("More actions for Smoke PDF").click();
  await page.getByRole("button", { name: "Remove from device" }).click();
  await expect(page.locator(".doc-row")).toHaveCount(1);

  expect(await idb(page, "files")).toHaveLength(1);
});

test("upgrading from DB v1 moves old progress into versioned anchors", async ({ page }) => {
  // Leave the app for a static file so nothing holds the DB open, then replace it with a v1 database
  await page.goto("/lumaread-ico.jpeg");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        indexedDB.deleteDatabase("lumaread");
        const r = indexedDB.open("lumaread", 1);
        r.onupgradeneeded = () => {
          r.result.createObjectStore("docs", { keyPath: "id" }).createIndex("hash", "hash", { unique: true });
          r.result.createObjectStore("files");
        };
        r.onsuccess = () => {
          const t = r.result.transaction(["docs", "files"], "readwrite");
          t.objectStore("docs").put({ id: "d1", title: "Old PDF", format: "pdf", size: 10, hash: "h", addedAt: 1, progress: { location: "2", percent: 0.5 } });
          t.objectStore("files").put(new ArrayBuffer(1), "d1");
          t.oncomplete = () => (r.result.close(), resolve());
        };
      }),
  );
  await page.goto("/");
  await expect(row(page, "Old PDF")).toContainText("50%");
  const [progress] = await idb(page, "progress");
  expect(progress).toMatchObject({ anchor: { v: 1, kind: "pdf", page: 2 }, percent: 0.5, version: 1 });
});
