import { describe, expect, it } from "vitest";
import type { Annotation } from "../../lib/db";
import { csvCell, toCsv, toMarkdown, type ExportRow } from "./exportNotes";

const base: Annotation = { id: "1", docId: "d", color: "yellow", createdAt: Date.UTC(2026, 9, 20), updatedAt: Date.UTC(2026, 9, 21), version: 1 };
const quote = (exact: string) => ({ v: 1 as const, kind: "pdf" as const, page: 12, rects: [], quote: { exact, prefix: "", suffix: "" } });
const doc = { title: "Dosa Malaikat", author: "Keigo Higashino", format: "pdf" as const };

describe("csvCell", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("a\nb")).toBe('"a\nb"');
    expect(csvCell(undefined)).toBe("");
  });
  it("neutralises formula-like values", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("-1+2")).toBe("'-1+2");
    expect(csvCell("@sum")).toBe("'@sum");
  });
});

describe("toCsv / toMarkdown", () => {
  const rows: ExportRow[] = [
    { doc, annotation: { ...base, anchor: quote("Bisa Anda jelaskan, soal itu?"), label: "p. 12", note: "Penting — 重要" } },
    { doc, annotation: { ...base, id: "2", note: "Whole-book note" } },
  ];

  it("writes a BOM, header and one row per annotation with Unicode intact", () => {
    const csv = toCsv(rows);
    expect(csv.startsWith("﻿document,author,format,location")).toBe(true);
    expect(csv).toContain('"Bisa Anda jelaskan, soal itu?",Penting — 重要');
    expect(csv.trim().split("\r\n")).toHaveLength(3);
  });

  it("groups by document and keeps source attribution", () => {
    const md = toMarkdown(rows, Date.UTC(2026, 9, 22));
    expect(md).toContain("## Dosa Malaikat — Keigo Higashino");
    expect(md).toContain("> Bisa Anda jelaskan, soal itu?");
    expect(md).toContain("*p. 12 · yellow · 2026-10-20*");
    expect(md).toContain("*note · 2026-10-20*\n\nWhole-book note");
    expect(md.match(/## /g)).toHaveLength(1);
  });
});
