import { describe, expect, it } from "vitest";
import type { DocText } from "../../lib/db";
import { summarizeBook } from "./summarize";

const unit = (n: number, text: string, label = `Chapter ${n}`): DocText => ({
  docId: "b",
  unit: n,
  label,
  text,
  source: "text",
});

const long = (topic: string, filler: string) =>
  `${topic}. ${filler} ${filler} The ${topic.toLowerCase()} matters because readers need a clear through-line across many pages of material.`;

describe("summarizeBook", () => {
  it("returns empty when there is not enough text", () => {
    expect(summarizeBook([unit(0, "Short.")])).toEqual({ overview: "", chapters: [] });
  });

  it("picks sentences that mention repeated topic words, in chapter order", () => {
    const mindfulness = long(
      "Mindfulness changes how attention settles during reading",
      "People often rush past paragraphs without noticing tone or structure in a book.",
    );
    const habits = long(
      "Daily habits shape long-term comprehension more than cramming",
      "Sleep and short breaks also protect memory when studying dense chapters overnight.",
    );
    const result = summarizeBook([unit(1, mindfulness, "Attention"), unit(2, habits, "Habits")]);
    expect(result.chapters).toHaveLength(2);
    expect(result.chapters[0].label).toBe("Attention");
    expect(result.chapters[1].label).toBe("Habits");
    expect(result.overview.length).toBeGreaterThan(40);
    expect(result.overview.toLowerCase()).toMatch(/mindfulness|habits|attention|comprehension/);
  });

  it("skips tiny units and keeps href when present", () => {
    const body = long(
      "Navigation design keeps readers oriented inside long documents",
      "Section titles and page numbers reduce the cost of jumping between related ideas.",
    );
    const result = summarizeBook([
      unit(0, "Hi"),
      { docId: "b", unit: 1, label: "Nav", href: "nav.xhtml", text: body, source: "text" },
    ]);
    expect(result.chapters).toEqual([expect.objectContaining({ label: "Nav", href: "nav.xhtml" })]);
  });

  it("collapses PDF page units into a single overview wrap", () => {
    const a = long(
      "Detective Kusanagi reviews the arsenic timeline with clinical care",
      "Witness statements conflict about who prepared the coffee that morning at home.",
    );
    const b = long(
      "Yoshitaka's death forces the team to rethink the marriage motive",
      "Ayane remains composed while colleagues notice small inconsistencies in her account.",
    );
    const result = summarizeBook([
      unit(274, a, "Page 274"),
      unit(275, b, "Page 275"),
    ]);
    expect(result.chapters).toEqual([]);
    expect(result.overview.length).toBeGreaterThan(40);
    expect(result.overview.toLowerCase()).toMatch(/arsenic|yoshitaka|ayane|kusanagi|marriage|coffee/);
  });

  it("drops copyright / ISBN boilerplate and skips PDF front-back margins", () => {
    const legal =
      "Undang-Undang Nomor 28 Tahun 2014 tentang Hak Cipta. Sanksi pidana penjara paling lama sepuluh tahun dan denda empat miliar rupiah. ISBN 978-602-06-5037-1 dicetak oleh PT Gramedia Jakarta untuk penerbit.";
    const story = long(
      "Ayane quietly waters the pansies while the investigators wait downstairs",
      "The dry pot and patchwork fabric keep coming up whenever colleagues recount that evening.",
    );
    const bio =
      "Keigo Higashino menerima Edogawa Rampo Prize untuk Hokago dan Naoki Prize untuk Yogisha X no Kenshin sebagai penghargaan sastra penting dalam kariernya.";
    // 10 page units so 4% margins skip first/last two
    const pages = [
      unit(1, legal, "Page 1"),
      unit(2, legal, "Page 2"),
      unit(3, story, "Page 3"),
      unit(4, story, "Page 4"),
      unit(5, story, "Page 5"),
      unit(6, story, "Page 6"),
      unit(7, story, "Page 7"),
      unit(8, story, "Page 8"),
      unit(9, bio, "Page 9"),
      unit(10, bio, "Page 10"),
    ];
    const result = summarizeBook(pages);
    expect(result.chapters).toEqual([]);
    expect(result.overview.toLowerCase()).not.toMatch(/hak cipta|isbn|gramedia|edogawa|naoki/);
    expect(result.overview.toLowerCase()).toMatch(/ayane|pansies|investigators|patchwork/);
  });
});
