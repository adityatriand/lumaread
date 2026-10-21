import { expect, idb, importAll, invokedCalls, row, test, choose } from "./helpers";

const NOW = new Date(2026, 9, 20, 20, 0).getTime(); // local time, so days line up with the app's calendar

test("reading time, pages and streak are tracked and shown per book and overall", async ({ page }) => {
  await page.clock.install({ time: NOW });
  await page.reload();
  await importAll(page);

  // Two earlier days of reading, so the streak and chart have history
  await page.evaluate((now) => {
    const day = (ago: number) => {
      const d = new Date(now - ago * 864e5);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    return new Promise<void>((resolve) => {
      const r = indexedDB.open("lumaread");
      r.onsuccess = () => {
        const docs = r.result.transaction("docs").objectStore("docs").getAll();
        docs.onsuccess = () => {
          const pdf = docs.result.find((d: { title: string }) => d.title === "Smoke PDF");
          const t = r.result.transaction("sessions", "readwrite");
          for (const ago of [1, 2]) {
            t.objectStore("sessions").put({ id: `seed-${ago}`, docId: pdf.id, day: day(ago), startedAt: now - ago * 864e5, endedAt: now - ago * 864e5 + 6e5, activeMs: 10 * 60_000, pages: 2, startPercent: 0, endPercent: 0.33 });
          }
          t.oncomplete = () => resolve();
        };
      };
    });
  }, NOW);

  await row(page, "Smoke PDF").click();
  await expect(page.locator(".reader-bar.footer")).toContainText("Page 1 / 3");
  // Three minutes of active reading: a page turn, then regular input
  for (let i = 0; i < 6; i++) {
    if (i === 2) await page.getByRole("button", { name: "Next page" }).click();
    await page.locator(".pdf-container").click({ position: { x: 5, y: 5 } });
    await page.clock.runFor(30_000);
  }
  // Leaving the book for 5 minutes without input must not count
  await page.clock.runFor(5 * 60_000);
  await page.getByLabel("Back to library").click();

  await expect.poll(async () => (await idb<{ id: string; activeMs: number; pages: number }>(page, "sessions")).find((s) => !s.id.startsWith("seed"))).toMatchObject({ pages: 2 });
  const live = (await idb<{ id: string; activeMs: number }>(page, "sessions")).find((s) => !s.id.startsWith("seed"))!;
  expect(live.activeMs).toBeGreaterThanOrEqual(3 * 60_000);
  expect(live.activeMs).toBeLessThan(5 * 60_000);

  await page.getByRole("button", { name: "Stats" }).first().click();
  const tiles = page.locator(".stat-tiles");
  await expect(page.locator(".hero-figure")).toHaveText(/^2[0-9]m$/); // 20m seeded + ~3–4m today
  await expect(tiles).toContainText("Pages read6");
  await expect(tiles).toContainText("Current streak3 days");
  await expect(tiles).toContainText("Days read3 / 7");
  await expect(page.locator(".chart .bar")).toHaveCount(3);
  await expect(page.locator(".bar-list li")).toHaveCount(1);

  // Hover a column for its tooltip, then check the table view carries the same numbers
  await page.locator(".chart .col").last().hover();
  await expect(page.locator(".chart-tip")).toContainText("pages");
  await page.getByRole("button", { name: "Table" }).click();
  await expect(page.locator(".data-table").first().locator("tbody tr")).toHaveCount(3);

  // Per book
  await choose(page, "Book", "Smoke PDF");
  await expect(page.getByRole("heading", { name: "Progress" })).toBeVisible();
  await expect(page.locator(".progress-detail")).toContainText("67%");
  await expect(page.getByText("Last read: Page 2 / 3")).toBeVisible();

  // Achievement card
  await page.getByRole("button", { name: "Share achievement" }).click();
  const dialog = page.getByRole("dialog", { name: "Share achievement" });
  const size = () => dialog.locator("img").evaluate((img: HTMLImageElement) => img.decode().then(() => [img.naturalWidth, img.naturalHeight], () => null));
  await expect.poll(size).toEqual([1080, 1920]);
  await dialog.getByRole("button", { name: "Save image" }).click();
  await expect.poll(async () => (await invokedCalls(page)).find((c) => c.cmd === "plugin:dialog|save")?.args).toMatchObject({ options: { defaultPath: "lumaread-achievement-story.png" } });
});
