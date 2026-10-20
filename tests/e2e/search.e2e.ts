import { bookFrame, expect, idb, importAll, test } from "./helpers";

test("search finds book text and opens the PDF page / EPUB chapter it came from", async ({ page }) => {
  await importAll(page);
  await expect.poll(async () => (await idb<{ textIndexed?: boolean }>(page, "docs")).every((d) => d.textIndexed)).toBe(true);

  await page.getByRole("button", { name: "Search" }).first().click();
  await page.getByLabel("Search", { exact: true }).fill("page 3 hello");
  await expect(page.getByRole("tab", { name: /Text/ })).toContainText("1");
  await page.locator(".doc-open", { hasText: "Page 3" }).click();
  await expect(page.locator(".reader-bar.footer")).toContainText("Page 3 / 3");

  await page.getByLabel("Back to library").click();
  await page.getByRole("button", { name: "Search" }).first().click();
  await page.getByLabel("Search", { exact: true }).fill("chapter 2 paragraph 7");
  await page.locator(".doc-open", { hasText: "Chapter Two" }).click();
  await expect(bookFrame(page).locator("h1")).toHaveText("Chapter 2");
});

test("text-based PDFs are not flagged as scanned", async ({ page }) => {
  await importAll(page);
  await expect.poll(async () => (await idb<{ title: string; scanned?: boolean }>(page, "docs")).find((d) => d.title === "Smoke PDF")?.scanned).toBe(false);
});
