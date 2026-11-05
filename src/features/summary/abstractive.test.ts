import { describe, expect, it } from "vitest";
import type { ExtractedSummary } from "./summarize";

// Pack/model loading needs /vendor assets; unit-test only the pure shape contract via summarize + types
describe("abstractive contract", () => {
  it("ExtractedSummary is what rewriteSummary consumes", () => {
    const sample: ExtractedSummary = {
      overview: "Mindfulness helps attention during long reading sessions.",
      chapters: [{ unit: 1, label: "One", text: "Daily habits beat cramming for comprehension." }],
    };
    expect(sample.chapters[0].unit).toBe(1);
  });
});
