import { describe, expect, it } from "vitest";
import type { Annotation, DocMeta, DocText } from "../../lib/db";
import { isShortText } from "./indexText";
import { searchAll, snippetAround } from "./search";

const doc = (id: string, title: string): DocMeta => ({ id, title, format: "pdf", size: 1, hash: id, addedAt: 0 });

describe("snippetAround", () => {
  it("finds case- and accent-insensitive matches and marks the hit", () => {
    const r = snippetAround("Le café est très bon", "CAFE")!;
    expect(r.snippet.slice(...r.match)).toBe("café");
  });

  it("trims long text with ellipses around the hit", () => {
    const text = "a ".repeat(100) + "needle" + " b".repeat(100);
    const r = snippetAround(text, "needle")!;
    expect(r.snippet.startsWith("…")).toBe(true);
    expect(r.snippet.endsWith("…")).toBe(true);
    expect(r.snippet.slice(...r.match)).toBe("needle");
  });

  it("returns undefined when absent", () => {
    expect(snippetAround("nothing here", "zzz")).toBeUndefined();
  });
});

describe("searchAll", () => {
  const docs = [doc("a", "Mindful Reader"), doc("b", "Atomic Habits")];
  const texts: DocText[] = [{ docId: "b", unit: 12, label: "Page 12", text: "A more mindful approach to reading", source: "text" }];
  const annotations: Annotation[] = [
    { id: "n1", docId: "b", color: "yellow", note: "helps to be more mindful", createdAt: 0, updatedAt: 0, version: 1 },
    { id: "gone", docId: "deleted", color: "yellow", note: "mindful orphan", createdAt: 0, updatedAt: 0, version: 1 },
  ];

  it("groups hits by kind and skips annotations of removed documents", () => {
    const kinds = searchAll("mindful", { docs, texts, annotations }).map((r) => `${r.kind}:${r.doc.id}`);
    expect(kinds).toEqual(["file:a", "content:b", "note:b"]);
  });

  it("ignores one-character queries", () => {
    expect(searchAll("m", { docs, texts, annotations })).toEqual([]);
  });
});

describe("isShortText", () => {
  it("treats a watermark-only page as short", () => {
    expect(isShortText("desyrindah.blogspot.com")).toBe(true);
    expect(isShortText("Dari samping, Kusanagi menatap Utsumi yang berbicara dengan nada tegas.")).toBe(false);
  });
});
