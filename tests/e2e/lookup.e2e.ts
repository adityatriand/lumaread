import { bookFrame, expect, importAll, row, selectText, test } from "./helpers";

test("lookup shows an offline definition and an on-device translation", async ({ page }) => {
  test.setTimeout(60_000); // first use loads the ~21 MB model into the worker
  await importAll(page);
  await row(page, "Smoke Test Book").click();
  await expect(bookFrame(page).locator("h1")).toHaveText("Chapter 1");
  const frame = page.frames().find((f) => f !== page.mainFrame())!;

  await selectText(frame, "body", "paragraph");
  await page.getByRole("button", { name: "Translate" }).click();
  const panel = page.getByRole("dialog", { name: "Translation and dictionary" });
  await expect(panel).toContainText("English dictionary");
  await expect(panel.locator(".senses li").first()).toContainText("noun");
  await expect(panel).toContainText("English → Indonesian");
  await expect(panel.locator(".lookup-result")).not.toBeEmpty({ timeout: 45_000 });
  console.log("paragraph →", await panel.locator(".lookup-result").innerText());

  await panel.getByRole("button", { name: "Swap languages" }).click();
  await expect(panel).toContainText("Indonesian → English");
  await expect(panel.locator(".lookup-result")).not.toBeEmpty({ timeout: 45_000 });
  await panel.getByRole("button", { name: "Close" }).click();
  await expect(panel).toHaveCount(0);
});
