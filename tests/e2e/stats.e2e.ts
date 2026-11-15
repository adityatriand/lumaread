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
    // Mid-page: the reader's (hidden) header floats over the top edge
    await page.locator(".pdf-container").click();
    await page.clock.runFor(30_000);
  }
  // Past the 10-minute idle window: time after idle must not count
  await page.clock.runFor(11 * 60_000);
  await page.getByLabel("Back to library").click();

  await expect.poll(async () => (await idb<{ id: string; activeMs: number; pages: number }>(page, "sessions")).find((s) => !s.id.startsWith("seed"))).toMatchObject({ pages: 2 });
  const live = (await idb<{ id: string; activeMs: number }>(page, "sessions")).find((s) => !s.id.startsWith("seed"))!;
  // ~3m reading + up to 10m trailing before idle; the 11th minute dropped
  expect(live.activeMs).toBeGreaterThanOrEqual(3 * 60_000);
  expect(live.activeMs).toBeLessThan(3 * 60_000 + 11 * 60_000);
  expect(live.activeMs).toBeLessThanOrEqual(3 * 60_000 + 10 * 60_000 + 15_000);

  await page.getByRole("button", { name: "Stats" }).first().click();
  const tiles = page.locator(".stat-tiles");
  // The page shows one date, today: the live session only. Seeded days stay off this date.
  await expect(page.locator(".hero-figure")).toHaveText(/^(?:<1m|[0-9]+m)$/);
  await expect(tiles).toContainText("Pages read2");
  await expect(tiles).toContainText("Current streak3 days");
  await expect(tiles).toContainText("Sessions1");
  await expect(page.locator(".session-list li")).toHaveCount(1);

  await page.getByRole("button", { name: "From", exact: true }).click();
  await page.getByRole("dialog", { name: "From" }).locator('[data-date="2026-10-19"]').click();
  await page.getByRole("button", { name: "To", exact: true }).click();
  await page.getByRole("dialog", { name: "To" }).locator('[data-date="2026-10-19"]').click();
  await expect(page.locator(".hero-figure")).toHaveText("10m");
  await expect(tiles).toContainText("Pages read2");
  await expect(page.locator(".session-list li")).toHaveCount(1);

  await page.getByRole("radio", { name: "Week" }).click();
  await expect(tiles).toContainText("Pages read6");
  await expect(tiles).toContainText("Sessions3");
  await page.getByRole("radio", { name: "Today" }).click();
  await expect(page.locator(".session-list li")).toHaveCount(1);

  // Per book
  await choose(page, "Book", "Smoke PDF");
  await expect(page.getByRole("heading", { name: "Progress" })).toBeVisible();
  await expect(page.locator(".progress-detail")).toContainText("67%");
  await expect(page.getByText("Last read: Page 2 / 3")).toBeVisible();

  // Achievement card
  await page.getByRole("button", { name: "Share achievement" }).click();
  const dialog = page.getByRole("dialog", { name: "Share achievement" });
  const size = () => dialog.locator("img").evaluate((img: HTMLImageElement) => img.decode().then(() => [img.naturalWidth, img.naturalHeight] as const, () => null));
  await expect.poll(async () => {
    const box = await size();
    return !!box && box[0] === 1080 && box[1] > 200 && box[1] < 1600;
  }).toBe(true);
  await expect(dialog.getByRole("radio", { name: "Summary" })).toHaveAttribute("aria-checked", "true");
  await dialog.getByRole("radio", { name: "Time" }).click();
  await expect(dialog.getByRole("radio", { name: "Time" })).toHaveAttribute("aria-checked", "true");
  await dialog.getByRole("radio", { name: "Black" }).click();
  await dialog.getByRole("button", { name: "Save image" }).click();
  await expect.poll(async () => (await invokedCalls(page)).find((c) => c.cmd === "plugin:dialog|save")?.args).toMatchObject({ options: { defaultPath: "lumaread-achievement-time.png" } });
});
