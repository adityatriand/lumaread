import { choose, confirmModal, expect, idb, importAll, row, test } from "./helpers";

test("shelves group books; the library filters by shelf and status, sorts, and remembers the view", async ({ page }) => {
  await importAll(page);
  await page.getByRole("button", { name: "Library" }).first().click();

  await page.getByLabel("More actions for Smoke PDF").click();
  await page.getByRole("button", { name: "Shelves…" }).click();
  const dialog = page.getByRole("dialog", { name: "Shelves" });
  await dialog.getByLabel("New shelf").fill("Favourites");
  await dialog.getByRole("button", { name: "Add" }).click();
  await expect(dialog.getByLabel("Favourites")).toBeChecked();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(row(page, "Smoke PDF")).toContainText("Favourites");
  const pdf = (await idb<{ title: string; shelves?: string[]; editedAt?: number }>(page, "docs")).find((d) => d.title === "Smoke PDF")!;
  expect(pdf.shelves).toEqual(["Favourites"]);
  expect(pdf.editedAt).toBeGreaterThan(0); // so sync carries the change

  await choose(page, "Shelf", "Favourites");
  await expect(page.locator(".doc-row")).toHaveCount(1);
  await choose(page, "Shelf", "Not on a shelf");
  await expect(page.locator(".doc-row")).toHaveCount(1);
  await expect(row(page, "Smoke Test Book")).toBeVisible();
  await choose(page, "Shelf", "All shelves");

  await choose(page, "Sort", "Title A–Z");
  await expect(page.locator(".doc-row .doc-title")).toHaveText(["Smoke PDF", "Smoke Test Book"]);
  await choose(page, "Status", "Finished");
  await expect(page.getByText("No books match these filters.")).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Library" }).first().click();
  await expect(page.getByRole("combobox", { name: "Status" })).toContainText("Finished");
  await expect(page.getByRole("combobox", { name: "Sort" })).toContainText("Title A–Z");
});

test("manage shelves: rename across books, delete only after confirming", async ({ page }) => {
  await importAll(page);
  await page.getByRole("button", { name: "Library" }).first().click();
  for (const title of ["Smoke PDF", "Smoke Test Book"]) {
    await page.getByLabel(`More actions for ${title}`).click();
    await page.getByRole("button", { name: "Shelves…" }).click();
    const dialog = page.getByRole("dialog", { name: "Shelves" });
    await dialog.getByLabel("New shelf").fill("To read");
    await dialog.getByRole("button", { name: "Add" }).click();
    await dialog.getByRole("button", { name: "Save" }).click();
  }

  await page.getByRole("button", { name: "Manage shelves" }).click();
  const manage = page.getByRole("dialog", { name: "Manage shelves" });
  await expect(manage).toContainText("To read");
  await expect(manage).toContainText("2 books");
  await manage.getByRole("button", { name: "Rename" }).click();
  await manage.getByLabel("New name for To read").fill("Next up");
  await manage.getByRole("button", { name: "Save" }).click();
  await expect(manage).toContainText("Next up");
  await expect.poll(async () => (await idb<{ shelves?: string[] }>(page, "docs")).map((d) => d.shelves)).toEqual([["Next up"], ["Next up"]]);

  await manage.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("taken off 2 books");
  await confirmModal(page, "Cancel");
  await expect(manage).toContainText("Next up");
  await manage.getByRole("button", { name: "Delete" }).click();
  await confirmModal(page, "Delete");
  await expect(manage).toContainText("No shelves yet");
  await expect.poll(async () => (await idb<{ shelves?: string[] }>(page, "docs")).map((d) => d.shelves)).toEqual([[], []]);
  expect(await page.locator(".doc-row").count()).toBe(2); // books stay
});
