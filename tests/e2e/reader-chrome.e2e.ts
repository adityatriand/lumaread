import { expect, importAll, row, setPrefs, test } from "./helpers";

test("focus mode: the bars show on open, then hide; a tap on the page toggles them", async ({ page }) => {
  await importAll(page);
  await row(page, "Smoke PDF").click();
  const reader = page.locator(".reader");
  await expect(reader).toHaveClass(/bars-on/);
  await expect(reader).not.toHaveClass(/bars-on/, { timeout: 5_000 }); // brief intro, then the book fills the screen
  await expect(page.locator(".reader-bar.footer")).toHaveCSS("opacity", "0");

  await page.locator(".pdf-container").click();
  await expect(reader).toHaveClass(/bars-on/);
  await expect(page.locator(".reader-bar.footer")).toHaveCSS("opacity", "1");
  await page.locator(".pdf-container").click();
  await expect(reader).not.toHaveClass(/bars-on/);
});

test("reading preferences: short layout labels, page colours in one row, closes on a click outside", async ({ page }) => {
  await importAll(page);
  await row(page, "Smoke PDF").click();
  await page.getByRole("button", { name: "Reading preferences" }).click();
  const prefs = page.getByRole("dialog", { name: "Reading preferences" });
  await expect(prefs.getByRole("radio", { name: "Scroll", exact: true })).toBeVisible();
  await expect(prefs.getByRole("radio", { name: "Side", exact: true })).toBeVisible();

  const tops = await Promise.all(["Light", "Dark", "Sepia"].map(async (t) => (await prefs.locator(".theme-option", { hasText: t }).boundingBox())!.y));
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(2);

  // Choosing inside keeps it open; a click on the page closes it; so does the toggle button
  await prefs.getByLabel("Sepia").check();
  await expect(prefs).toBeVisible();
  await page.locator(".pdf-container").click();
  await expect(prefs).toHaveCount(0);
  await page.getByRole("button", { name: "Reading preferences" }).click();
  await expect(prefs).toBeVisible();
  await page.getByRole("button", { name: "Reading preferences" }).click();
  await expect(prefs).toHaveCount(0);
});

test("arrow keys turn PDF pages without clicking into the book first", async ({ page }) => {
  await importAll(page);
  await row(page, "Smoke PDF").click();
  await expect(page.locator(".reader-bar.footer")).toContainText("Page 1 / 3");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".reader-bar.footer")).toContainText("Page 2 / 3");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".reader-bar.footer")).toContainText("Page 1 / 3");
});

test("sepia colours the whole reader and the PDF page itself", async ({ page }) => {
  await importAll(page);
  await setPrefs(page, { theme: "sepia" });
  await row(page, "Smoke PDF").click();
  await expect(page.locator(".reader")).toHaveCSS("background-color", "rgb(246, 239, 223)");
  // Multiplied over the sepia paper: white page pixels become exactly the surrounding colour
  await expect(page.locator(".pdfViewer .canvasWrapper canvas").first()).toHaveCSS("mix-blend-mode", "multiply");
});

test.describe("phone", () => {
  test.use({ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36" });

  test("Swipe layout snaps one PDF page per swipe", async ({ page }) => {
    await importAll(page);
    await setPrefs(page, { layout: "horizontal" });
    await row(page, "Smoke PDF").click();
    const container = page.locator(".pdf-container");
    await expect(container).toHaveClass(/layout-horizontal/);
    await expect(container).toHaveCSS("scroll-snap-type", "x mandatory");
    await expect(page.locator(".pdfViewer .page").first()).toHaveCSS("scroll-snap-stop", "always");

    await page.getByRole("button", { name: "Reading preferences" }).click();
    const prefs = page.getByRole("dialog", { name: "Reading preferences" });
    await expect(prefs.getByRole("radio", { name: "Swipe", exact: true })).toHaveAttribute("aria-checked", "true");
  });
});
