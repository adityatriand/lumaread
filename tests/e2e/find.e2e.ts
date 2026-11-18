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
  await expect(page.locator(".page[data-page-number='1'] .find-current")).not.toHaveCount(0);
  await expect(page.locator(".page[data-page-number='1'] .find-mark")).not.toHaveCount(0);

  const results = find.getByRole("list", { name: "Matches" });
  await expect(results.getByRole("listitem")).toHaveCount(3);
  await results.getByRole("button").nth(2).click();
  await expect(results).toHaveCount(0);
  await expect(find).toContainText("3 / 3");
  await expect(page.locator(".reader-bar.footer")).toContainText("Page 3 / 3");
  await find.getByRole("button", { name: "Show matches" }).click();
  await expect(results).toBeVisible();
  await results.getByRole("button").first().click();

  await find.getByRole("searchbox").press("Enter");
  await expect(find).toContainText("2 / 3");
  await expect(page.locator(".reader-bar.footer")).toContainText("Page 2 / 3");
  await expect(page.locator(".page[data-page-number='2'] .find-current")).not.toHaveCount(0);
  await find.getByRole("button", { name: "Previous match" }).click();
  await expect(page.locator(".reader-bar.footer")).toContainText("Page 1 / 3");

  await find.getByRole("searchbox").fill("nothing like this");
  await expect(find).toContainText("No matches");
  await find.getByRole("searchbox").press("Escape");
  await expect(find).toHaveCount(0);
  await expect(page.locator(".find-current")).toHaveCount(0);
  await expect(page.locator(".find-mark")).toHaveCount(0);
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
  await expect(page.locator(".book-view svg g.find-current")).toHaveCount(1);
  await expect(page.locator(".book-view svg g.find-mark")).toHaveCount(1);
});

test("⌘F / Ctrl+F inside an EPUB chapter opens find and tints every match", async ({ page }) => {
  await indexed(page);
  await setPrefs(page, { layout: "spread" });
  await row(page, "Smoke Test Book").click();
  await expect(bookFrame(page).locator("h1")).toHaveText("Chapter 1");
  await bookFrame(page).locator("body").click();
  await page.keyboard.press("ControlOrMeta+f");
  const box = page.getByRole("search", { name: "Find in book" }).getByRole("searchbox");
  await expect(box).toBeFocused();
  await box.fill("paragraph");
  await expect.poll(() => page.locator(".book-view svg g.find-mark").count()).toBeGreaterThan(1);
  await box.press("Escape");
  await expect(page.locator(".book-view svg g.find-mark")).toHaveCount(0);
});
