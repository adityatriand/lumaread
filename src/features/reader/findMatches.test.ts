import { describe, expect, it } from "vitest";
import { findMatches } from "./findMatches";

const t = (unit: number, text: string) => ({ docId: "d", unit, label: `Page ${unit}`, text, source: "text" as const });

describe("find in book", () => {
  it("finds every occurrence across units in reading order, ignoring case and accents", () => {
    const m = findMatches([t(2, "Café and cafe."), t(1, "The CAFE opens.")], "cafe");
    expect(m.map((x) => [x.unit, x.start, x.text])).toEqual([[1, 4, "CAFE"], [2, 0, "Café"], [2, 9, "cafe"]]);
  });

  it("numbers identical matches per unit so the PDF layer can pick the right one", () => {
    const m = findMatches([t(1, "the The the")], "the");
    expect(m.map((x) => [x.text, x.nth])).toEqual([["the", 0], ["The", 0], ["the", 1]]);
  });

  it("needs two characters", () => {
    expect(findMatches([t(1, "a b c")], " a ")).toEqual([]);
  });
});
