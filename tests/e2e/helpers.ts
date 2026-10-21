import { expect, test as base, type Frame, type FrameLocator, type Page } from "@playwright/test";
import path from "node:path";

// Fixtures are generated in-house (no third-party content): 3-page PDF, 2-chapter EPUB with a <script>, and a fake PDF
export const fixture = (name: string) => path.join(import.meta.dirname, "../fixtures", name);

export interface Invoked { cmd: string; args: unknown; headers?: Record<string, string> }

// Chrome stands in for the Tauri webview: set the app-only flag and record plugin calls instead of hitting Rust
export const test = base.extend<{ app: void }>({
  app: [async ({ page }, use) => {
    const problems: string[] = [];
    page.on("pageerror", (e) => problems.push(e.message));
    page.on("console", (m) => {
      // The fixture EPUB's own script being blocked is the expected outcome
      if (m.type() === "error" && !m.text().includes("Blocked script execution") && !m.text().includes("404")) problems.push(m.text());
    });
    await page.addInitScript(() => {
      const calls: unknown[] = [];
      Object.assign(globalThis, {
        isTauri: true,
        __calls: calls,
        __TAURI_INTERNALS__: {
          invoke: async (cmd: string, args: unknown, options?: { headers?: Record<string, string> }) => {
            calls.push({ cmd, args: args instanceof Uint8Array ? new TextDecoder().decode(args) : args, headers: options?.headers });
            return cmd === "plugin:dialog|save" ? "/tmp/export-file" : null;
          },
          transformCallback: () => 0,
        },
      });
    });
    await page.goto("/");
    await use();
    expect(problems).toEqual([]);
  }, { auto: true }],
});

export const invokedCalls = (page: Page) => page.evaluate(() => (globalThis as unknown as { __calls: Invoked[] }).__calls);

export async function importAll(page: Page) {
  await page.setInputFiles("input[type=file]", [fixture("Smoke PDF.pdf"), fixture("book.epub")]);
  await expect(page.locator(".doc-row")).toHaveCount(2);
}

export const row = (page: Page, title: string) => page.locator(".doc-row .doc-open", { hasText: title });

export function idb<T>(page: Page, store: string): Promise<T[]> {
  return page.evaluate(
    (store) =>
      new Promise<T[]>((resolve) => {
        const r = indexedDB.open("lumaread");
        r.onsuccess = () => {
          const g = r.result.transaction(store).objectStore(store).getAll();
          g.onsuccess = () => resolve(g.result);
        };
      }),
    store,
  );
}

// Select a substring of the first element matching `selector` (main page or a book iframe)
export async function selectText(target: Page | Frame, selector: string, text: string) {
  await target.evaluate(
    ({ selector, text }) => {
      const walker = document.createTreeWalker(document.querySelector(selector)!, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const i = n.textContent!.indexOf(text);
        if (i < 0) continue;
        const range = document.createRange();
        range.setStart(n, i);
        range.setEnd(n, i + text.length);
        const sel = document.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
      throw new Error(`text not found: ${text}`);
    },
    { selector, text },
  );
}

export const bookFrame = (page: Page): FrameLocator => page.frameLocator(".epub-view iframe");
// Continuous EPUB layout shows several chapters (iframes) at once
export { expect };

// Saved settings take effect on load, like a returning user's
export async function setPrefs(page: Page, prefs: Record<string, unknown>) {
  await page.evaluate((p) => localStorage.setItem("reading-prefs", JSON.stringify({ ...JSON.parse(localStorage.getItem("reading-prefs") ?? "{}"), ...p })), prefs);
  await page.reload();
}

// Picks an option from the app's custom dropdown (combobox + listbox)
export async function choose(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("listbox", { name: label }).getByRole("option", { name: option, exact: true }).click();
}
