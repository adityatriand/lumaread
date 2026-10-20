import { describe, expect, it } from "vitest";
import { ocrText, toOcrWords } from "./ocr";

const word = (text: string, x0: number, y0: number) => ({ text, bbox: { x0, y0, x1: x0 + 100, y1: y0 + 20 } });

describe("toOcrWords / ocrText", () => {
  const words = toOcrWords(
    [{ words: [word("Dari", 0, 0), word("samping,", 120, 0), word("  ", 240, 0)] }, { words: [word("Kusanagi", 0, 40)] }],
    1000,
    400,
  );

  it("normalises boxes to page fractions and drops blank words", () => {
    expect(words).toHaveLength(3);
    expect(words[1]).toEqual({ text: "samping,", line: 0, box: { x: 0.12, y: 0, w: 0.1, h: 0.05 } });
  });

  it("rebuilds text line by line", () => {
    expect(ocrText(words)).toBe("Dari samping,\nKusanagi");
  });
});
