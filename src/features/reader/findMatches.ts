import type { DocText } from "../../lib/db";
import { fold } from "../search/search";

export interface Match { unit: number; start: number; end: number; text: string; nth: number }

const MAX_MATCHES = 2000;

// Every occurrence of `query` in the book's text, ignoring case and accents, in reading order. `nth` counts
// earlier identical matches on the same unit, so an engine that locates text by matching finds the right one.
export function findMatches(texts: DocText[], query: string): Match[] {
  const q = fold(query.trim());
  if (q.length < 2) return [];
  const out: Match[] = [];
  for (const t of [...texts].sort((a, b) => a.unit - b.unit)) {
    const folded = fold(t.text);
    const seen = new Map<string, number>();
    for (let i = folded.indexOf(q); i >= 0 && out.length < MAX_MATCHES; i = folded.indexOf(q, i + q.length)) {
      const text = t.text.slice(i, i + q.length);
      const nth = seen.get(text) ?? 0;
      seen.set(text, nth + 1);
      out.push({ unit: t.unit, start: i, end: i + q.length, text, nth });
    }
  }
  return out;
}
