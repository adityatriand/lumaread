import { bookFrame, expect, idb, importAll, invokedCalls, row, selectText, test, setPrefs } from "./helpers";

test("PDF: highlight a selection, keep it after reload, edit its note", async ({ page }) => {
  await importAll(page);
  await row(page, "Smoke PDF").click();
  await expect(page.locator(".textLayer").first()).toContainText("hello LumaRead");

  await selectText(page, ".page[data-page-number='1'] .textLayer", "hello LumaRead");
  const selected = await page.evaluate(() => document.getSelection()!.getRangeAt(0).getBoundingClientRect().toJSON());
  await page.getByRole("button", { name: "Highlight green" }).click();
  await expect(page.locator(".page[data-page-number='1'] .hl.hl-green")).toHaveCount(1);
  // The painted box must sit on the selected words, not drift by the canvas inset
  const painted = (await page.locator(".page[data-page-number='1'] .hl").boundingBox())!;
  expect(Math.abs(painted.x - selected.x)).toBeLessThan(2);
  expect(Math.abs(painted.y - selected.y)).toBeLessThan(2);
  expect(Math.abs(painted.width - selected.width)).toBeLessThan(3);

  const [saved] = await idb<{ anchor: { page: number; quote: { exact: string } }; label: string }>(page, "annotations");
  expect(saved).toMatchObject({ anchor: { page: 1, quote: { exact: "hello LumaRead" } }, label: "p. 1" });

  await page.reload();
  await row(page, "Smoke PDF").click();
  await expect(page.locator(".page[data-page-number='1'] .hl.hl-green")).toHaveCount(1);

  const box = (await page.locator(".page[data-page-number='1'] .hl").first().boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByRole("dialog", { name: "Edit highlight" }).getByRole("textbox").fill("Greeting line");
  await page.getByRole("button", { name: "Done" }).click();
  await expect.poll(async () => (await idb<{ note?: string }>(page, "annotations"))[0].note).toBe("Greeting line");
});

test("EPUB: highlight inside the book and jump back to it from the notebook", async ({ page }) => {
  await importAll(page);
  await setPrefs(page, { layout: "spread" });
  await row(page, "Smoke Test Book").click();
  await page.getByLabel("Chapter").selectOption({ label: "Chapter Two" });
  await expect(bookFrame(page).locator("h1")).toHaveText("Chapter 2");

  const frame = page.frames().find((f) => f.url() === "about:srcdoc" || f !== page.mainFrame())!;
  await selectText(frame, "body", "Chapter 2 paragraph 3");
  await page.getByRole("button", { name: "Highlight pink" }).click();
  await expect(page.locator(".epub-view svg g.hl")).toHaveCount(1);
  const [saved] = await idb<{ label: string; anchor: { cfiRange: string } }>(page, "annotations");
  expect(saved.label).toBe("Chapter Two");
  expect(saved.anchor.cfiRange).toMatch(/^epubcfi\(/);

  await page.getByLabel("Back to library").click();
  await page.getByRole("button", { name: "Highlights" }).first().click();
  await expect(page.locator(".note-card")).toContainText("Chapter 2 paragraph 3");
  await page.locator(".note-open").click();
  await expect(bookFrame(page).locator("h1")).toHaveText("Chapter 2");
  await expect(page.locator(".epub-view svg g.hl")).toHaveCount(1);
});

test("notebook exports Markdown and CSV through the save dialog", async ({ page }) => {
  await importAll(page);
  await row(page, "Smoke PDF").click();
  await expect(page.locator(".textLayer").first()).toContainText("hello LumaRead");
  await selectText(page, ".page[data-page-number='1'] .textLayer", "hello LumaRead");
  await page.getByRole("button", { name: "Highlight yellow" }).click();
  await expect(page.locator(".hl")).toHaveCount(1);
  await page.getByLabel("Back to library").click();
  await page.getByRole("button", { name: "Highlights" }).first().click();

  await page.getByRole("button", { name: "Markdown" }).click();
  await expect(page.getByRole("status")).toHaveText("Exported 1 items.");
  await page.getByRole("button", { name: "CSV" }).click();

  const calls = await invokedCalls(page);
  const writes = calls.filter((c) => c.cmd === "plugin:fs|write_text_file");
  expect(calls.filter((c) => c.cmd === "plugin:dialog|save")).toHaveLength(2);
  expect(writes[0].args).toContain("> hello LumaRead");
  expect(writes[0].args).toContain("## Smoke PDF");
  expect(writes[1].args).toContain("Smoke PDF,,pdf,p. 1,yellow,hello LumaRead");
  expect(decodeURIComponent(writes[0].headers!.path)).toBe("/tmp/export-file");
});
