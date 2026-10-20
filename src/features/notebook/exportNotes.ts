import type { Annotation, DocMeta } from "../../lib/db";

export interface ExportRow { doc: Pick<DocMeta, "title" | "author" | "format">; annotation: Annotation }

const iso = (ts: number) => new Date(ts).toISOString();

export function toMarkdown(rows: ExportRow[], exportedAt = Date.now()): string {
  const out = [`# LumaRead highlights & notes`, ``, `Exported ${iso(exportedAt).slice(0, 10)}`];
  let current = "";
  for (const { doc, annotation: a } of rows) {
    const heading = doc.author ? `${doc.title} — ${doc.author}` : doc.title;
    if (heading !== current) out.push(``, `## ${heading}`);
    current = heading;
    out.push(``);
    if (a.anchor) out.push(...a.anchor.quote.exact.split("\n").map((line) => `> ${line}`), ``);
    out.push(`*${[a.label, a.anchor ? a.color : "note", iso(a.createdAt).slice(0, 10)].filter(Boolean).join(" · ")}*`);
    if (a.note) out.push(``, a.note);
  }
  return out.join("\n") + "\n";
}

// Spreadsheet apps execute cells starting with these, so prefix them to keep exported text inert
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: string | undefined): string {
  let v = value ?? "";
  if (FORMULA_START.test(v)) v = `'${v}`;
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(rows: ExportRow[]): string {
  const header = ["document", "author", "format", "location", "color", "quote", "note", "created_at", "updated_at"];
  const lines = rows.map(({ doc, annotation: a }) =>
    [doc.title, doc.author, doc.format, a.label, a.anchor ? a.color : "", a.anchor?.quote.exact, a.note, iso(a.createdAt), iso(a.updatedAt)]
      .map(csvCell)
      .join(","),
  );
  // BOM so Excel opens UTF-8 (Indonesian, CJK) correctly
  return "﻿" + [header.join(","), ...lines].join("\r\n") + "\r\n";
}
