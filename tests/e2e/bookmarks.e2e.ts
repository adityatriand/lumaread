import { confirmModal, expect, idb, importAll, row, test } from "./helpers";

test("bookmark a page by name, see the ribbon, jump back, then manage it on the Bookmarks page", async ({ page }) => {
  await importAll(page);
  await row(page, "Smoke PDF").click();
  await expect(page.locator(".reader-bar.footer")).toContainText("Page 1 / 3"); // keys do nothing until the viewer is up
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".reader-bar.footer")).toContainText("Page 3 / 3");

  await page.getByRole("button", { name: /^Bookmarks/ }).click();
  const menu = page.getByRole("dialog", { name: "Bookmarks" });
  await expect(menu).toContainText("No bookmarks yet");
  await menu.getByLabel("Bookmark name").fill("Ending");
  await menu.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("status")).toHaveText("Bookmark saved.");
  await expect(page.locator(".bookmark-ribbon")).toBeVisible();
  await expect(page.getByRole("button", { name: "Bookmarks (this page is bookmarked)" })).toBeVisible();
  const [saved] = await idb<{ name: string; label: string; anchor: { kind: string; page: number } }>(page, "bookmarks");
  expect(saved).toMatchObject({ name: "Ending", label: "Page 3 / 3", anchor: { kind: "pdf", page: 3 } });

  // Another page: no ribbon; the menu jumps back
  await page.locator(".pdf-container").click(); // closes the menu
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".reader-bar.footer")).toContainText("Page 2 / 3");
  await expect(page.locator(".bookmark-ribbon")).toHaveCount(0);
  await page.getByRole("button", { name: /^Bookmarks/ }).click();
  await menu.locator(".bookmark-go", { hasText: "Ending" }).click();
  await expect(page.locator(".reader-bar.footer")).toContainText("Page 3 / 3");
  await expect(page.locator(".bookmark-ribbon")).toBeVisible();

  // Deleting from the reader menu asks first; Cancel keeps it
  await page.getByRole("button", { name: /^Bookmarks/ }).click();
  await menu.getByRole("button", { name: "Delete bookmark Ending" }).click();
  await confirmModal(page, "Cancel");
  expect(await idb(page, "bookmarks")).toHaveLength(1);
  await page.locator(".pdf-container").click(); // closes the menu

  // Bookmarks page in the sidebar: rename, open, delete
  await page.getByLabel("Back to library").click();
  await page.getByRole("button", { name: "Bookmarks" }).first().click();
  await expect(page.getByRole("heading", { name: "Bookmarks" })).toBeVisible();
  await expect(page.locator(".note-card")).toContainText("Ending");
  await expect(page.locator(".note-card")).toContainText("Smoke PDF · Page 3 / 3");

  await page.getByRole("button", { name: "Rename" }).click();
  await page.getByLabel("Bookmark name").fill("The end");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".note-card")).toContainText("The end");
  await expect.poll(async () => (await idb<{ name: string }>(page, "bookmarks"))[0].name).toBe("The end");

  await page.locator(".note-open").click();
  await expect(page.locator(".reader-bar.footer")).toContainText("Page 3 / 3");
  await page.getByLabel("Back to library").click();
  await page.getByRole("button", { name: "Bookmarks" }).first().click();
  await page.getByRole("button", { name: "Delete" }).click();
  await confirmModal(page, "Delete");
  await expect(page.locator(".note-card")).toHaveCount(0);
  expect(await idb(page, "bookmarks")).toHaveLength(0);
});

test("removing a book deletes its bookmarks", async ({ page }) => {
  await importAll(page);
  await row(page, "Smoke PDF").click();
  await page.getByRole("button", { name: /^Bookmarks/ }).click();
  await page.getByRole("dialog", { name: "Bookmarks" }).getByRole("button", { name: "Add" }).click();
  await expect.poll(async () => (await idb(page, "bookmarks")).length).toBe(1);
  await page.getByLabel("Back to library").click();

  await page.getByRole("button", { name: "Library" }).first().click();
  await page.getByLabel("More actions for Smoke PDF").click();
  await page.getByRole("button", { name: "Remove from device" }).click();
  await confirmModal(page, "Remove");
  await expect.poll(async () => (await idb(page, "bookmarks")).length).toBe(0);
});

test("opening a search hit doesn't move the last-read page until the reader moves on", async ({ page }) => {
  await importAll(page);
  await expect.poll(async () => (await idb<{ textIndexed?: boolean }>(page, "docs")).every((d) => d.textIndexed)).toBe(true);
  await row(page, "Smoke PDF").click();
  await expect(page.locator(".reader-bar.footer")).toContainText("Page 1 / 3"); // keys do nothing until the viewer is up
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  const lastRead = async () => (await idb<{ anchor: { page?: number } }>(page, "progress")).map((p) => p.anchor.page);
  await expect.poll(lastRead).toContain(3);
  await page.getByLabel("Back to library").click();

  // Just looking at a hit on page 1 keeps page 3 as the place to continue
  await page.getByLabel("Search your library").fill("page 1 hello");
  await page.locator(".doc-open", { hasText: "Page 1" }).click();
  await expect(page.locator(".reader-bar.footer")).toContainText("Page 1 / 3");
  await page.waitForTimeout(500); // progress writes are async; give a wrong one time to land
  expect(await lastRead()).toContain(3);
  await page.getByLabel("Back to library").click();
  await page.getByRole("button", { name: "Home" }).first().click();
  await row(page, "Smoke PDF").click();
  await expect(page.locator(".reader-bar.footer")).toContainText("Page 3 / 3");

  // Reading on from a hit does save
  await page.getByLabel("Back to library").click();
  await page.getByLabel("Search your library").fill("1 hello LumaRead");
  await page.locator(".doc-open", { hasText: "Page 1" }).click();
  await expect(page.locator(".reader-bar.footer")).toContainText("Page 1 / 3");
  await page.keyboard.press("ArrowRight");
  await expect.poll(lastRead).toContain(2);
});
