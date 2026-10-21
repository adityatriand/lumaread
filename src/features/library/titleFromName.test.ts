import { describe, expect, it } from "vitest";
import { titleFromName } from "./titleFromName";

describe("titleFromName", () => {
  it.each([
    ["Salvation of a Saint - Keigo Higashino.pdf", { title: "Salvation of a Saint", author: "Keigo Higashino" }],
    ["The Wandering Sword – Keigo Higashino.pdf", { title: "The Wandering Sword", author: "Keigo Higashino" }],
    ["Spider-Man - Origins - Stan Lee.epub", { title: "Spider-Man - Origins", author: "Stan Lee" }],
    ["atomic_habits.pdf", { title: "atomic habits" }],
    ["Report-2026.pdf", { title: "Report-2026" }],
  ])("%s", (name, expected) => {
    expect(titleFromName(name)).toEqual(expected);
  });
});
