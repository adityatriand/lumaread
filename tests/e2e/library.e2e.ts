import { expect, fixture, idb, row, test } from "./helpers";

test("titles come from 'Title - Author' filenames and can be edited", async ({ page }) => {
  await page.setInputFiles("input[type=file]", fixture("Scanned Sample - LumaRead Tests.pdf"));
  await expect(row(page, "Scanned Sample")).toContainText("LumaRead Tests");

  await page.getByLabel("More actions for Scanned Sample").click();
  await page.getByRole("button", { name: "Edit details" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit details" });
  await expect(dialog).toContainText("Imported from “Scanned Sample - LumaRead Tests.pdf”");
  await dialog.getByLabel("Title").fill("Buku Contoh");
  await dialog.getByLabel("Author").fill("Penulis");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(row(page, "Buku Contoh")).toContainText("Penulis");
});

test("scanned PDF: detected, OCR progress shown, recognised words become selectable", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setInputFiles("input[type=file]", fixture("Scanned Sample - LumaRead Tests.pdf"));
  await expect.poll(async () => (await idb<{ scanned?: boolean }>(page, "docs"))[0]?.scanned, { timeout: 30_000 }).toBe(true);

  await row(page, "Scanned Sample").click();
  const status = page.getByRole("status").filter({ hasText: /Recogni/ });
  await expect(status).toBeVisible();
  await expect(page.locator(".page[data-page-number='1'] .ocrLayer")).toContainText(/Selamat membaca/i, { timeout: 60_000 });
  await expect(page.locator(".ocr-status")).toContainText(/of 2 pages|All pages recognized/, { timeout: 60_000 });
});
