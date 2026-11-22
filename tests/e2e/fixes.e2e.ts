import type { Frame, Page } from "@playwright/test";
import { expect, fixture, row, test } from "./helpers";

// A publisher sheet, the kind that kept sepia paper white and dark text black.
const PUBLISHER = "html body{background:#ffffff;color:#000000}html body p,html body h1,html body div{color:#111111;background-color:#ffffff}";

async function openChapter(page: Page): Promise<Frame> {
  await page.setInputFiles("input[type=file]", fixture("Nested Nav.epub"));
  await row(page, "Nested Nav").click();
  await expect(page.locator(".reader-heading")).toContainText("Contents");
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    if ((await frame.locator("h1").first().textContent().catch(() => ""))?.includes("Contents")) return frame;
  }
  throw new Error("book frame missing");
}

async function dressAsPublisher(frame: Frame) {
  await frame.evaluate((css) => {
    const style = document.createElement("style");
    style.id = "publisher";
    style.textContent = css;
    document.head.appendChild(style);
  }, PUBLISHER);
}

function ink(frame: Frame) {
  return frame.evaluate(() => {
    const el = document.querySelector("h1")!;
    const text = getComputedStyle(el);
    return { text: text.color, paper: getComputedStyle(document.body).backgroundColor, block: text.backgroundColor };
  });
}

async function choosePageColor(page: Page, label: string) {
  const prefs = page.getByRole("dialog", { name: "Reading preferences" });
  if (!(await prefs.isVisible())) await page.getByRole("button", { name: "Reading preferences" }).click();
  await prefs.getByLabel(label, { exact: true }).check();
}

for (const [name, agent] of [
  ["desktop", undefined],
  ["phone", "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36"],
] as const) {
  test.describe(name, () => {
    if (agent) test.use({ userAgent: agent });

    test("sepia and dark recolor the chapter, not only the frame", async ({ page }) => {
      const frame = await openChapter(page);
      await dressAsPublisher(frame);
      await choosePageColor(page, "Sepia");
      await expect.poll(() => ink(frame)).toEqual({
        text: "rgb(67, 52, 34)",
        paper: "rgb(246, 239, 223)",
        block: "rgba(0, 0, 0, 0)",
      });
      await expect(page.locator(".book-view iframe").first()).toHaveCSS("background-color", "rgb(246, 239, 223)");

      await choosePageColor(page, "Dark");
      await expect.poll(() => ink(frame)).toEqual({
        text: "rgb(230, 230, 238)",
        paper: "rgb(22, 22, 29)",
        block: "rgba(0, 0, 0, 0)",
      });
      await expect(page.locator(".book-view iframe").first()).toHaveCSS("background-color", "rgb(22, 22, 29)");

      await choosePageColor(page, "Light");
      await expect.poll(() => ink(frame)).toEqual({
        text: "rgb(31, 31, 46)",
        paper: "rgb(255, 255, 255)",
        block: "rgba(0, 0, 0, 0)",
      });
    });
  });
}

test("the page slider turns the book while the pointer is still down", async ({ page }) => {
  await page.setInputFiles("input[type=file]", fixture("Nested Nav.epub"));
  await row(page, "Nested Nav").click();
  await expect(page.locator(".reader-heading")).toContainText(/Page 1 \/ /);
  const slider = page.getByRole("slider", { name: "Page" });
  await expect(slider).toBeVisible();
  const box = (await slider.boundingBox())!;
  const x = box.x + box.width / 2;
  await page.mouse.move(x, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(x, box.y + box.height - 12, { steps: 30 });
  await expect(page.locator(".reader-heading")).toContainText(/Page (?!1 )\d+ \/ /, { timeout: 10_000 });
  await page.mouse.up();
});

test("splash shows the name under the logo, then leaves", async ({ page }) => {
  await page.reload({ waitUntil: "commit" });
  const word = page.locator(".splash-word");
  await expect(word).toHaveText("LumaRead");
  const below = await page.evaluate(() => {
    const w = document.querySelector(".splash-word")!.getBoundingClientRect();
    const i = document.querySelector(".splash-mark img")!.getBoundingClientRect();
    return w.top - i.bottom >= 28 && w.width > 40;
  });
  expect(below).toBe(true);
  const motion = await page.locator("head style").first().evaluate((el) => el.innerHTML.includes("@keyframes splash-letter"));
  expect(motion).toBe(true);
  await expect(page.locator("#splash")).toHaveCount(0);
});
