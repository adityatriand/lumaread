import { describe, expect, it } from "vitest";
import { englishLemmas, indonesianRoots } from "./stem";

describe("indonesianRoots", () => {
  it.each([
    ["menatap", "tatap"],
    ["memukul", "pukul"],
    ["menyapu", "sapu"],
    ["mengirim", "kirim"],
    ["mengemudi", "kemudi"],
    ["berbicara", "bicara"],
    ["diperbaiki", "baik"],
    ["kedatangan", "datang"],
    ["mengantarkan", "antar"],
    ["bukunya", "buku"],
    ["bisakah", "bisa"],
  ])("%s → %s", (word, root) => {
    expect(indonesianRoots(word)).toContain(root);
  });

  it("never returns the word itself or tiny fragments", () => {
    const roots = indonesianRoots("makan");
    expect(roots).not.toContain("makan");
    expect(roots.every((r) => r.length >= 3)).toBe(true);
  });
});

describe("englishLemmas", () => {
  it.each([
    ["running", "run"],
    ["sustained", "sustain"],
    ["making", "make"],
    ["studies", "study"],
    ["boxes", "box"],
    ["quickly", "quick"],
    ["bigger", "big"],
  ])("%s → %s", (word, lemma) => {
    expect(englishLemmas(word)).toContain(lemma);
  });
});
