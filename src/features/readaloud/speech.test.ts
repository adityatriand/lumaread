import { describe, expect, it } from "vitest";
import { chunks } from "./speech";

describe("read-aloud chunks", () => {
  it("splits sentences, keeps their offsets and collapses line breaks", () => {
    const text = "Halo dunia. Apa\nkabar?  Baik!";
    expect(chunks(text)).toEqual([
      { start: 0, end: 11, text: "Halo dunia." },
      { start: 12, end: 22, text: "Apa kabar?" },
      { start: 24, end: 29, text: "Baik!" },
    ]);
    expect(text.slice(12, 15)).toBe("Apa");
  });

  it("starts mid-sentence at an offset and breaks over-long sentences at a space", () => {
    expect(chunks("One two. Three four.", 13)).toEqual([{ start: 13, end: 20, text: "e four." }]);
    const long = `${"word ".repeat(80)}end.`;
    const parts = chunks(long);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.text.length <= 220)).toBe(true);
    expect(parts.map((p) => p.text).join(" ")).toBe(long.replace(/\s+/g, " ").trim());
  });
});
