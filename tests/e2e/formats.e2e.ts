import { writeZip } from "../../src/lib/zip";
import { bookFrame, expect, idb, row, setPrefs, test } from "./helpers";

const file = (name: string, content: string | Uint8Array, mimeType = "text/plain") => ({ name, mimeType, buffer: Buffer.from(content) });
// 1×1 transparent PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test("Markdown and plain text become readable books with chapters", async ({ page }) => {
  await setPrefs(page, { layout: "spread" });
  await page.setInputFiles("input[type=file]", [
    file("Field Notes - Ana.md", "# Morning\n\nThe **first** walk.\n\n## Evening\n\n- tea\n- rest"),
    file("Diary.txt", "Opening line.\n\nChapter 1\n\nIt began."),
  ]);
  await expect(row(page, "Field Notes")).toContainText("Ana · MD");
  await expect(row(page, "Diary")).toContainText("TXT");
  const [md] = (await idb<{ title: string; format: string; source: string }>(page, "docs")).filter((d) => d.title === "Field Notes");
  expect(md).toMatchObject({ format: "epub", source: "md" });

  await row(page, "Field Notes").click();
  await expect(bookFrame(page).locator("h1")).toHaveText("Morning");
  await expect(bookFrame(page).locator("strong")).toHaveText("first");
  await page.getByRole("combobox", { name: "Chapter" }).click();
  await expect(page.getByRole("listbox", { name: "Chapter" }).getByRole("option")).toHaveText(["Morning", "Evening"]);
});

test("the same text file twice is a duplicate", async ({ page }) => {
  await page.setInputFiles("input[type=file]", file("Diary.txt", "Same words."));
  await expect(row(page, "Diary")).toBeVisible();
  await page.setInputFiles("input[type=file]", file("Diary.txt", "Same words."));
  await expect(page.getByRole("alert")).toContainText("already in your library");
});

test("a CBZ comic opens one image per page, with its first page as cover", async ({ page }) => {
  await setPrefs(page, { layout: "spread" });
  const cbz = writeZip([{ name: "Issue/02.png", data: PNG }, { name: "Issue/01.png", data: PNG }]);
  await page.setInputFiles("input[type=file]", file("Moon Comic.cbz", cbz, "application/vnd.comicbook+zip"));
  await expect(row(page, "Moon Comic")).toContainText("CBZ");
  await expect(row(page, "Moon Comic").locator("img.cover")).toHaveCount(1);
  await row(page, "Moon Comic").click();
  await expect(bookFrame(page).locator("img")).toHaveAttribute("alt", "Page 1");
  await expect(page.locator(".reader-heading")).toContainText("Page 1");
});

test("a CBZ without images is refused", async ({ page }) => {
  await page.setInputFiles("input[type=file]", file("Empty.cbz", writeZip([{ name: "readme.txt", data: new TextEncoder().encode("hi") }])));
  await expect(page.getByRole("alert")).toContainText("has no comic pages");
});
