import type { Frame, Page } from "@playwright/test";
import { choose, expect, fixture, idb, row, selectText, setPrefs, test } from "./helpers";

// Nav document in a subfolder (text/nav.xhtml), links relative to it — epub.js alone fails with "No Section Found"
const bookFrameWith = async (page: Page, text: string): Promise<Frame> => {
  await expect.poll(async () => {
    for (const f of page.frames()) if (f !== page.mainFrame() && (await f.locator("h1").first().textContent().catch(() => ""))?.includes(text)) return true;
    return false;
  }).toBe(true);
  for (const f of page.frames()) if (f !== page.mainFrame() && (await f.locator("h1").first().textContent().catch(() => ""))?.includes(text)) return f;
  throw new Error(text);
};

for (const layout of ["continuous", "spread"]) {
  test(`EPUB (${layout}): chapter picker, in-book links, chapter names and the selection toolbar`, async ({ page }) => {
    await setPrefs(page, { layout });
    await page.setInputFiles("input[type=file]", fixture("Nested Nav.epub"));
    await row(page, "Nested Nav").click();
    await expect(page.locator(".reader-heading")).toContainText("Contents");

    await choose(page, "Chapter", "Chapter Two: Middle");
    await expect(page.locator(".reader-heading")).toContainText("Chapter Two: Middle");
    await bookFrameWith(page, "Chapter Two");

    await choose(page, "Chapter", "Contents");
    const contents = await bookFrameWith(page, "Contents");
    await contents.getByRole("link", { name: "Chapter One: Start" }).click();
    await expect(page.locator(".reader-heading")).toContainText("Chapter One: Start");

    const chapter = await bookFrameWith(page, "Chapter One");
    await selectText(chapter, "body", "Chapter One paragraph 2");
    await expect(page.getByRole("toolbar", { name: "Selection actions" })).toBeVisible();
  });
}

for (const layout of ["continuous", "spread"]) {
  test(`EPUB (${layout}): page colour follows every switch, including back to an earlier one`, async ({ page }) => {
    await setPrefs(page, { layout });
    await page.setInputFiles("input[type=file]", fixture("Nested Nav.epub"));
    await row(page, "Nested Nav").click();
    await expect(page.locator(".reader-heading")).toContainText("Contents"); // named on open, not "Section 1"
    const frame = await bookFrameWith(page, "Contents");
    const bodyBg = () => frame.evaluate(() => getComputedStyle(document.body).backgroundColor);

    await page.getByRole("button", { name: "Reading preferences" }).click();
    for (const [label, rgb] of [["Sepia", "rgb(246, 239, 223)"], ["Light", "rgb(255, 255, 255)"], ["Dark", "rgb(22, 22, 29)"], ["Sepia", "rgb(246, 239, 223)"]]) {
      await page.getByLabel(label, { exact: true }).check();
      await expect.poll(bodyBg).toBe(rgb);
    }
  });
}

test("EPUB shows stable page numbers, counted once and reused", async ({ page }) => {
  await page.setInputFiles("input[type=file]", fixture("Nested Nav.epub"));
  await row(page, "Nested Nav").click();
  await expect(page.locator(".reader-heading")).toContainText(/Contents · Page 1 \/ \d+/);
  await choose(page, "Chapter", "Chapter Two: Middle");
  await expect(page.locator(".reader-heading")).toContainText(/Chapter Two: Middle · Page \d+ \/ \d+/);
  // Counted pages are stored with the book, so the next open doesn't recount
  await expect.poll(async () => !!(await idb<{ epubLocations?: string }>(page, "docs"))[0]?.epubLocations).toBe(true);
});
