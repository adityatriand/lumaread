import { describe, expect, it } from "vitest";
import { fitText, wrapText } from "./quoteCard";

// Monospace stand-in: every character is half the font size wide
const measureAt = (t: string, size: number) => t.length * size * 0.5;

describe("wrapText", () => {
  it("wraps on spaces without exceeding the width", () => {
    const lines = wrapText("Atomic habits are not about massive action", 100, (t) => measureAt(t, 10));
    expect(lines).toEqual(["Atomic habits are", "not about massive", "action"]);
    expect(lines.every((l) => measureAt(l, 10) <= 100)).toBe(true);
  });

  it("breaks a word that cannot fit on its own line", () => {
    expect(wrapText("supercalifragilistic", 50, (t) => measureAt(t, 10))).toEqual(["supercalif", "ragilistic"]);
  });

  it("keeps explicit paragraph breaks", () => {
    expect(wrapText("one\ntwo", 1000, (t) => measureAt(t, 10))).toEqual(["one", "two"]);
  });
});

describe("fitText", () => {
  const opts = { max: 40, min: 20, lineHeight: 1.5 };

  it("uses the largest size that fits", () => {
    const fit = fitText("short quote", { width: 400, height: 200 }, measureAt, opts);
    expect(fit).toMatchObject({ size: 40, truncated: false });
  });

  it("shrinks long text before truncating", () => {
    const text = "word ".repeat(30).trim();
    const fit = fitText(text, { width: 400, height: 200 }, measureAt, opts);
    expect(fit.size).toBeLessThan(40);
    expect(fit.truncated).toBe(false);
    expect(fit.lines.length * fit.size * 1.5).toBeLessThanOrEqual(200);
  });

  it("truncates with an ellipsis when even the minimum size overflows", () => {
    const fit = fitText("word ".repeat(400).trim(), { width: 400, height: 200 }, measureAt, opts);
    expect(fit.truncated).toBe(true);
    expect(fit.lines.at(-1)!.endsWith("…")).toBe(true);
    expect(fit.lines.length * 20 * 1.5).toBeLessThanOrEqual(200);
    expect(fit.lines.every((l) => measureAt(l, 20) <= 400)).toBe(true);
  });
});
