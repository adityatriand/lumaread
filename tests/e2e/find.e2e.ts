import { bookFrame, expect, idb, importAll, row, setPrefs, test } from "./helpers";

async function indexed(page: import("@playwright/test").Page) {
  await importAll(page);
  await expect.poll(async () => (await idb<{ textIndexed?: boolean }>(page, "docs")).every((d) => d.textIndexed)).toBe(true);
}

test("find in a PDF: counts matches, steps between pages, highlights the match, Escape closes", async ({ page }) => {
  await indexed(page);
  await row(page, "Smoke PDF").click();
  await expect(page.locator(".reader-bar.footer")).toContainText("Page 1 / 3");

  await page.keyboard.press("ControlOrMeta+f");
  const find = page.getByRole("search", { name: "Find in book" });
  await find.getByRole("searchbox").fill("HELLO");
  await expect(find).toContainText("1 / 3");
  await expect(page.locator(".page[data-page-number='1'] .speak-mark")).not.toHaveCount(0);

  await find.getByRole("searchbox").press("Enter");
  await expect(find).toContainText("2 / 3");
  await expect(page.locator(".reader-bar.footer")).toContainText("Page 2 / 3");
  await expect(page.locator(".page[data-page-number='2'] .speak-mark")).not.toHaveCount(0);
  await find.getByRole("button", { name: "Previous match" }).click();
  await expect(page.locator(".reader-bar.footer")).toContainText("Page 1 / 3");

  await find.getByRole("searchbox").fill("nothing like this");
  await expect(find).toContainText("No matches");
  await find.getByRole("searchbox").press("Escape");
  await expect(find).toHaveCount(0);
  await expect(page.locator(".speak-mark")).toHaveCount(0);
});

test("find in an EPUB jumps to the chapter holding the match", async ({ page }) => {
  await indexed(page);
  await setPrefs(page, { layout: "spread" });
  await row(page, "Smoke Test Book").click();
  await expect(bookFrame(page).locator("h1")).toHaveText("Chapter 1");
  await page.getByRole("button", { name: "Find in book" }).click();
  const find = page.getByRole("search", { name: "Find in book" });
  await find.getByRole("searchbox").fill("chapter 2 paragraph 7.");
  await expect(find).toContainText("1 / 1");
  await expect(bookFrame(page).locator("h1")).toHaveText("Chapter 2");
  await expect(page.locator(".book-view svg g.speak-mark")).toHaveCount(1);
});
