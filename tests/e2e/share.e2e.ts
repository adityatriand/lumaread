import { expect, importAll, invokedCalls, row, selectText, test, type Invoked } from "./helpers";
import type { Page } from "@playwright/test";

async function highlightAndOpenShare(page: Page) {
  await importAll(page);
  await row(page, "Smoke PDF").click();
  await expect(page.locator(".textLayer").first()).toContainText("hello LumaRead");
  await selectText(page, ".page[data-page-number='1'] .textLayer", "hello LumaRead");
  await page.getByRole("button", { name: "Share quote" }).click();
  return page.getByRole("dialog", { name: "Share quote" });
}

const previewSize = (page: Page) =>
  page.locator(".card-preview img").evaluate(async (img: HTMLImageElement) => (await img.decode(), [img.naturalWidth, img.naturalHeight]));

test("desktop: quote card renders as a story or square image and saves as PNG", async ({ page }) => {
  const dialog = await highlightAndOpenShare(page);
  await expect(dialog.locator(".card-preview img")).toBeVisible();
  expect(await previewSize(page)).toEqual([1080, 1920]);
  await expect(dialog.getByRole("button", { name: /Share to Stories/ })).toHaveCount(0);

  await dialog.getByRole("radio", { name: "Square" }).click();
  await dialog.getByRole("radio", { name: "Night" }).click();
  await expect.poll(() => previewSize(page)).toEqual([1080, 1080]);

  await dialog.getByRole("button", { name: "Save image" }).click();
  await expect(dialog.getByRole("status")).toHaveText("Image saved.");
  const calls = await invokedCalls(page);
  expect(calls.find((c) => c.cmd === "plugin:dialog|save")?.args).toMatchObject({ options: { defaultPath: "lumaread-quote-square.png" } });
  // write_file sends raw bytes; the recorder decodes them as text, so check the PNG signature text
  expect(String(calls.find((c) => c.cmd === "plugin:fs|write_file")?.args)).toContain("PNG");
});

test.describe("Android", () => {
  test.use({ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36" });

  test("shares the card through the native share sheet with a caption", async ({ page }) => {
    const dialog = await highlightAndOpenShare(page);
    await dialog.getByRole("button", { name: /Share to Stories, WhatsApp/ }).click();
    await expect.poll(async () => (await invokedCalls(page)).some((c) => c.cmd === "plugin:quoteshare|share_image")).toBe(true);
    const call = (await invokedCalls(page)).find((c) => c.cmd === "plugin:quoteshare|share_image") as Invoked & {
      args: { payload: { base64: string; fileName: string; text: string } };
    };
    expect(call.args.payload.fileName).toBe("lumaread-quote-story.png");
    expect(call.args.payload.text).toBe("“hello LumaRead” — Smoke PDF");
    expect(Buffer.from(call.args.payload.base64, "base64").subarray(1, 4).toString()).toBe("PNG");
  });
});
