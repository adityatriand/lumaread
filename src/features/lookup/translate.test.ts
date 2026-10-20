import { describe, expect, it } from "vitest";
import { cleanWord } from "./dictionary";
import { detectLang } from "./translate";

describe("detectLang", () => {
  it.each([
    ["Kenapa kau bisa tahu dia kedatangan tamu?", "id"],
    ["Di bak cuci ada satu cangkir kopi dan dua tatakan.", "id"],
    ["mengantarkan", "id"],
    ["The key is to make habits easy to start and hard to break.", "en"],
    ["She was able to program her computer", "en"],
  ])("%s → %s", (text, lang) => {
    expect(detectLang(text)).toBe(lang);
  });
});

describe("cleanWord", () => {
  it("strips surrounding quotes and punctuation, keeps inner hyphens", () => {
    expect(cleanWord(" ”Biar, ")).toBe("biar");
    expect(cleanWord("Wakayama-san?”")).toBe("wakayama-san");
  });
});
