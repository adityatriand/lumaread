import { bookFrame, expect, importAll, row, setPrefs, test } from "./helpers";

test("app theme defaults to light; Dark is chosen in Settings and remembered", async ({ page }) => {
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "light");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(247, 247, 251)");

  await page.getByRole("button", { name: "Settings" }).first().click();
  await page.getByRole("button", { name: "Appearance" }).click();
  await page.getByLabel("Dark").check();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(18, 18, 24)");

  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");
});

test("PDF side by side shows the cover alone, then two pages per spread", async ({ page }) => {
  await importAll(page);
  await setPrefs(page, { layout: "spread" });
  await row(page, "Smoke PDF").click();
  await expect(page.locator(".pdfViewer .spread").first()).toBeVisible();
  await expect(page.locator(".reader-bar.footer")).toContainText("Page 1 / 3");
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.locator(".reader-bar.footer")).toContainText("Page 2 / 3");
  // Pages 2 and 3 share one spread, next to each other
  const p2 = (await page.locator(".page[data-page-number='2']").boundingBox())!;
  const p3 = (await page.locator(".page[data-page-number='3']").boundingBox())!;
  expect(Math.abs(p2.y - p3.y)).toBeLessThan(2);
  expect(p3.x).toBeGreaterThan(p2.x + p2.width / 2); // pdf.js overlaps spread page borders by a few px
});

test("PDF page colour follows the reading theme", async ({ page }) => {
  await importAll(page);
  await setPrefs(page, { theme: "dark" });
  await row(page, "Smoke PDF").click();
  await expect(page.locator(".pdfViewer .canvasWrapper canvas").first()).toHaveCSS("filter", /invert/);
});

test("EPUB continuous layout scrolls through chapters", async ({ page }) => {
  await importAll(page);
  await row(page, "Smoke Test Book").click();
  await expect(bookFrame(page).first().locator("h1")).toHaveText("Chapter 1");
  const scroller = page.locator(".epub-view .epub-container");
  await expect.poll(() => scroller.evaluate((el) => el.scrollHeight > el.clientHeight * 2)).toBe(true);
  // Scroll like a reader does (several wheel steps): epub.js swallows the first scroll after it positions the book
  await scroller.hover();
  await expect(async () => {
    await page.mouse.wheel(0, 600);
    await expect(page.locator(".reader-heading")).toContainText("Chapter Two", { timeout: 500 });
  }).toPass({ timeout: 15_000 });
  await expect(page.locator(".epub-view iframe")).toHaveCount(2);
});
