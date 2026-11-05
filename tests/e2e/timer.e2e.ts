import { expect, importAll, row, test } from "./helpers";

const NOW = new Date(2026, 9, 20, 20, 0).getTime();

test("reading timer counts active time, idles on its own, and pauses or resumes on a tap", async ({ page }) => {
  await page.clock.install({ time: NOW });
  await page.reload();
  await importAll(page);
  await row(page, "Smoke PDF").click();
  const timer = page.locator(".reading-timer");
  await expect(timer).toBeVisible();

  // A minute of reading with regular input
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Shift");
    await page.clock.runFor(15_000);
  }
  await expect(timer).toHaveText(/^1:0\d$/);

  // No input for 11 minutes: auto-paused as idle (10 min threshold)
  await page.clock.runFor(11 * 60_000);
  await expect(timer).toContainText("Idle");
  const idle = (await timer.locator(".timer-time").textContent())!;
  await page.clock.runFor(60_000);
  await expect(timer.locator(".timer-time")).toHaveText(idle); // nothing added while idle

  // Input resumes it; a tap pauses it even while reading continues
  await page.keyboard.press("Shift");
  await page.clock.runFor(2_000);
  await expect(timer).not.toContainText("Idle");
  await timer.click();
  await expect(timer).toContainText("Paused");
  const paused = (await timer.locator(".timer-time").textContent())!;
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Shift");
    await page.clock.runFor(10_000);
  }
  await expect(timer.locator(".timer-time")).toHaveText(paused);
  await timer.click();
  await expect(timer).not.toContainText("Paused");
});
