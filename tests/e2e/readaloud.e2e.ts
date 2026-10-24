import type { Page } from "@playwright/test";
import { expect, fixture, idb, importAll, invokedCalls, row, test, type Invoked } from "./helpers";

// Stand-in for the webview's speechSynthesis (macOS path): records what is spoken; a sentence ends when the test says
// so, or right away with `auto`
async function fakeSpeech(page: Page, auto = false) {
  await page.addInitScript((auto) => {
    class Utterance {
      lang = "";
      rate = 1;
      voice = null;
      onend: ((e: unknown) => void) | null = null;
      onerror: ((e: { error: string }) => void) | null = null;
      constructor(public text: string) {}
    }
    const spoken: { text: string; rate: number }[] = [];
    let current: Utterance | undefined;
    const fake = {
      speak(u: Utterance) {
        spoken.push({ text: u.text, rate: u.rate });
        current = u;
        if (auto) setTimeout(() => fake.end(), 5);
      },
      end() {
        const u = current;
        current = undefined;
        u?.onend?.({});
      },
      cancel() {
        const u = current;
        current = undefined;
        u?.onerror?.({ error: "canceled" });
      },
      getVoices: () => [],
    };
    Object.defineProperty(window, "speechSynthesis", { value: fake, configurable: true });
    Object.assign(globalThis, { SpeechSynthesisUtterance: Utterance, __speech: { spoken, fake } });
  }, auto);
  await page.reload();
}

const spoken = (page: Page) => page.evaluate(() => (globalThis as unknown as { __speech: { spoken: { text: string; rate: number }[] } }).__speech.spoken);
const endSentence = (page: Page) => page.evaluate(() => (globalThis as unknown as { __speech: { fake: { end: () => void } } }).__speech.fake.end());

async function openIndexedPdf(page: Page) {
  await importAll(page);
  await expect.poll(async () => (await idb<{ textIndexed?: boolean }>(page, "docs")).every((d) => d.textIndexed)).toBe(true);
  await row(page, "Smoke PDF").click();
  await expect(page.locator(".textLayer").first()).toContainText("hello LumaRead");
}

test("reads a PDF aloud from the current page, highlighting the sentence, turning pages, with pause, speed and stop", async ({ page }) => {
  await fakeSpeech(page);
  await openIndexedPdf(page);

  await page.getByRole("button", { name: "Read aloud", exact: true }).click();
  const bar = page.getByRole("region", { name: "Read aloud" });
  await expect(bar).toContainText("Reading · Page 1 / 3");
  await expect.poll(async () => (await spoken(page))[0]?.text).toBe("Page 1 hello LumaRead");
  await expect(page.locator(".page[data-page-number='1'] .speak-mark")).not.toHaveCount(0);

  // Pause keeps the mark (where it will resume); resume repeats the sentence
  await bar.getByRole("button", { name: "Pause reading aloud" }).click();
  await expect(bar).toContainText("Paused");
  await expect(page.locator(".page[data-page-number='1'] .speak-mark")).not.toHaveCount(0);
  await bar.getByRole("button", { name: "Resume reading aloud" }).click();
  await expect(bar).toContainText("Reading");
  await expect.poll(async () => (await spoken(page)).length).toBe(2);

  // The end of a page turns to the next one and moves the mark with it
  await endSentence(page);
  await expect(page.locator(".reader-bar.footer")).toContainText("Page 2 / 3");
  await expect.poll(async () => (await spoken(page)).at(-1)?.text).toBe("Page 2 hello LumaRead");
  await expect(page.locator(".page[data-page-number='2'] .speak-mark")).not.toHaveCount(0);
  await expect(page.locator(".page[data-page-number='1'] .speak-mark")).toHaveCount(0);

  // Speed restarts the sentence at the new rate and is remembered
  await bar.getByRole("button", { name: /^Speed 1×/ }).click();
  await expect(bar).toContainText("1.25×");
  await expect.poll(async () => (await spoken(page)).at(-1)?.rate).toBe(1.25);
  expect(await page.evaluate(() => localStorage.getItem("read-aloud-rate"))).toBe("1.25");

  await bar.getByRole("button", { name: "Stop reading aloud" }).click();
  await expect(bar).toHaveCount(0);
  await expect(page.locator(".speak-mark")).toHaveCount(0);
});

test("the sleep timer pauses reading at the next sentence once the time is up", async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 9, 25, 22, 0).getTime() });
  await fakeSpeech(page);
  await openIndexedPdf(page);
  await page.getByRole("button", { name: "Read aloud", exact: true }).click();
  const bar = page.getByRole("region", { name: "Read aloud" });
  await expect.poll(async () => (await spoken(page)).length).toBe(1);

  await bar.getByRole("button", { name: /^Sleep timer off/ }).click();
  await expect(bar.getByRole("button", { name: /^Sleep timer in 15 minutes/ })).toContainText("15m");
  await page.clock.runFor(16 * 60_000);
  await endSentence(page);
  await expect(bar).toContainText("Paused");
  await expect(page.getByRole("status").filter({ hasText: "Sleep timer" })).toBeVisible();
  expect(await spoken(page)).toHaveLength(1); // page 2 wasn't started

  // Resuming continues where it stopped: the next page
  await bar.getByRole("button", { name: "Resume reading aloud" }).click();
  await expect.poll(async () => (await spoken(page)).at(-1)?.text).toBe("Page 2 hello LumaRead");
});

test("reading to the end of the book stops by itself and clears the mark", async ({ page }) => {
  await fakeSpeech(page, true);
  await openIndexedPdf(page);
  await page.getByRole("button", { name: "Read aloud", exact: true }).click();
  await expect.poll(async () => (await spoken(page)).map((s) => s.text)).toEqual(["Page 1 hello LumaRead", "Page 2 hello LumaRead", "Page 3 hello LumaRead"]);
  await expect(page.getByRole("region", { name: "Read aloud" })).toHaveCount(0);
  await expect(page.locator(".reader-bar.footer")).toContainText("Page 3 / 3");
  await expect(page.locator(".speak-mark")).toHaveCount(0);
});

test("scanned PDF: pages are recognised just before they are read, and the mark sits on the OCR words", async ({ page }) => {
  test.setTimeout(90_000);
  await fakeSpeech(page);
  await page.setInputFiles("input[type=file]", fixture("Scanned Sample - LumaRead Tests.pdf"));
  await expect.poll(async () => (await idb<{ scanned?: boolean }>(page, "docs"))[0]?.scanned, { timeout: 30_000 }).toBe(true);
  await row(page, "Scanned Sample").click();
  await expect(page.locator(".reader-bar.footer")).toContainText("Page 1 / 2"); // reading starts where the open book is

  await page.getByRole("button", { name: "Read aloud", exact: true }).click();
  await expect.poll(async () => (await spoken(page)).map((s) => s.text).join(" "), { timeout: 60_000 }).toMatch(/Selamat membaca/i);
  await expect(page.locator(".page[data-page-number='1'] .speak-layer .speak-mark")).not.toHaveCount(0);
  await expect(page.locator(".page[data-page-number='1'] .ocrLayer")).toContainText(/Selamat membaca/i);
});

test.describe("Android", () => {
  test.use({ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36" });

  test("reads aloud through the readaloud plugin (Android's TextToSpeech)", async ({ page }) => {
    await openIndexedPdf(page);
    await page.getByRole("button", { name: "Read aloud", exact: true }).click();
    // The IPC stub answers at once, so the whole book is read straight through
    type Speak = Invoked & { args: { payload: { text: string; lang: string; rate: number } } };
    const speaks = async () => (await invokedCalls(page)).filter((c) => c.cmd === "plugin:readaloud|speak") as Speak[];
    await expect.poll(async () => (await speaks()).map((c) => c.args.payload.text)).toEqual(["Page 1 hello LumaRead", "Page 2 hello LumaRead", "Page 3 hello LumaRead"]);
    await expect(page.getByRole("region", { name: "Read aloud" })).toHaveCount(0);
    const calls = await speaks();
    expect(calls[0].args.payload.lang).toMatch(/^(id-ID|en-US)$/);
    expect(calls[0].args.payload.rate).toBe(1);
  });
});
