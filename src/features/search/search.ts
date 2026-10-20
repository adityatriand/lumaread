import type { Annotation, DocMeta, DocText } from "../../lib/db";

export type ResultKind = "file" | "content" | "highlight" | "note";

export interface SearchResult {
  kind: ResultKind;
  doc: DocMeta;
  snippet: string;
  match: [number, number]; // match position inside snippet
  label?: string;
  text?: DocText;
  annotation?: Annotation;
}

// Case- and accent-insensitive; each precomposed letter folds to one char, so offsets stay aligned for Latin text
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const SNIPPET = 60;
const MAX_PER_KIND = 100;

export function snippetAround(text: string, query: string): { snippet: string; match: [number, number] } | undefined {
  const flat = text.replace(/\s+/g, " ");
  const i = fold(flat).indexOf(fold(query));
  if (i < 0) return undefined;
  const start = Math.max(0, i - SNIPPET);
  const end = Math.min(flat.length, i + query.length + SNIPPET);
  const lead = start > 0 ? "…" : "";
  const snippet = lead + flat.slice(start, end).trim() + (end < flat.length ? "…" : "");
  const at = lead.length + flat.slice(start, i).trimStart().length;
  return { snippet, match: [at, at + query.length] };
}

interface Corpus { docs: DocMeta[]; texts: DocText[]; annotations: Annotation[] }

export function searchAll(query: string, { docs, texts, annotations }: Corpus): SearchResult[] {
  const q = query.trim();
  if (q.length < 2) return [];
  const byId = new Map(docs.map((d) => [d.id, d]));
  const results: SearchResult[] = [];
  const add = (r: SearchResult) => results.filter((x) => x.kind === r.kind).length < MAX_PER_KIND && results.push(r);

  for (const doc of docs) {
    const hit = snippetAround([doc.title, doc.author].filter(Boolean).join(" — "), q);
    if (hit) add({ kind: "file", doc, ...hit });
  }
  for (const text of texts) {
    const doc = byId.get(text.docId);
    const hit = doc && snippetAround(text.text, q);
    if (hit) add({ kind: "content", doc, label: text.label, text, ...hit });
  }
  for (const a of annotations) {
    const doc = byId.get(a.docId);
    if (!doc) continue;
    const quoteHit = a.anchor && snippetAround(a.anchor.quote.exact, q);
    if (quoteHit) add({ kind: "highlight", doc, label: a.label, annotation: a, ...quoteHit });
    const noteHit = a.note && snippetAround(a.note, q);
    if (noteHit) add({ kind: "note", doc, label: a.label, annotation: a, ...noteHit });
  }
  return results;
}
