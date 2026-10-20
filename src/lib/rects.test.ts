import { describe, expect, it } from "vitest";
import { quoteIn, quoteWithContext } from "./anchor";
import { containsPoint, mergeRects, normalizeRects } from "./rects";

describe("normalizeRects", () => {
  const page = { left: 100, top: 50, width: 200, height: 400 };
  it("maps client rects to page fractions and drops slivers / off-page rects", () => {
    const rects = normalizeRects(
      [
        { left: 120, top: 90, width: 100, height: 20 },
        { left: 120, top: 90, width: 0.5, height: 20 },
        { left: 900, top: 90, width: 50, height: 20 },
      ],
      page,
    );
    expect(rects).toEqual([{ x: 0.1, y: 0.1, w: 0.5, h: 0.05 }]);
  });
});

describe("mergeRects", () => {
  it("joins adjacent spans on one line", () => {
    const merged = mergeRects([
      { x: 0.3, y: 0.1, w: 0.2, h: 0.02 },
      { x: 0.1, y: 0.1, w: 0.2, h: 0.02 },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].x).toBeCloseTo(0.1);
    expect(merged[0].w).toBeCloseTo(0.4);
  });

  it("keeps separate lines and distant spans apart", () => {
    const merged = mergeRects([
      { x: 0.1, y: 0.1, w: 0.2, h: 0.02 },
      { x: 0.1, y: 0.13, w: 0.2, h: 0.02 },
      { x: 0.8, y: 0.13, w: 0.1, h: 0.02 },
    ]);
    expect(merged).toHaveLength(3);
  });
});

describe("containsPoint / quoteWithContext", () => {
  it("hit-tests inclusive edges", () => {
    expect(containsPoint({ x: 0.1, y: 0.1, w: 0.2, h: 0.1 }, 0.3, 0.2)).toBe(true);
    expect(containsPoint({ x: 0.1, y: 0.1, w: 0.2, h: 0.1 }, 0.31, 0.2)).toBe(false);
  });

  it("captures prefix and suffix around the quote", () => {
    expect(quoteWithContext("abcdefghij", 3, 6, 2)).toEqual({ prefix: "bc", exact: "def", suffix: "gh" });
    expect(quoteWithContext("abc", 0, 3, 5)).toEqual({ prefix: "", exact: "abc", suffix: "" });
  });
});

describe("quoteIn", () => {
  it("matches across differing line breaks and whitespace", () => {
    expect(quoteIn("Atomic habits are\nnot about   massive action", "habits are not")).toMatchObject({ exact: "habits are not", prefix: "Atomic " });
    expect(quoteIn("abc", "zzz")).toEqual({ exact: "zzz", prefix: "", suffix: "" });
  });
});
