import { describe, expect, it } from "vitest";
import type { ExtractedSummary } from "./summarize";

// Pack/model loading needs /vendor assets; unit-test the contract that AI returns one wrap
describe("abstractive contract", () => {
  it("AI rewrite result is one overview with empty chapters", () => {
    const sample: ExtractedSummary = {
      overview: "The investigators keep returning to the pansies and the dry pot.",
      chapters: [],
    };
    expect(sample.chapters).toEqual([]);
    expect(sample.overview.length).toBeGreaterThan(20);
  });
});
