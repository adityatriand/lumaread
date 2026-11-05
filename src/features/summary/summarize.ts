import type { DocText } from "../../lib/db";
import { fold } from "../search/search";

export interface ChapterSummary {
  unit: number;
  label: string;
  href?: string;
  text: string;
}

export interface ExtractedSummary {
  overview: string;
  chapters: ChapterSummary[];
}

const MIN_UNIT_CHARS = 180;
const PER_CHAPTER = 2;
const OVERVIEW = 5;

// Small EN + ID set so frequency scoring ignores glue words
const STOP = new Set(
  fold(
    "a an the and or but if in on at to for of as is was are were be been being it this that these those with from by not no so than then into over after before about between through during without within " +
      "i you he she we they me him her us them my your his its our their what which who whom whose when where why how " +
      "dan atau yang di ke dari pada untuk dengan tidak ya sudah akan ada adalah ini itu mereka saya kamu kita dia nya " +
      "juga karena jika maka setelah sebelum tentang antara oleh sebagai",
  ).split(/\s+/),
);

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 40 && /[\p{L}]/u.test(s));
}

function tokens(s: string): string[] {
  return fold(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

// TF–IDF over sentences in one unit; keep original order among the top picks
function pickSentences(pool: string[], n: number): string[] {
  if (pool.length <= n) return pool;
  const docs = pool.map(tokens);
  const df = new Map<string, number>();
  for (const words of docs) for (const w of new Set(words)) df.set(w, (df.get(w) ?? 0) + 1);
  const N = docs.length;
  const scored = docs.map((words, i) => {
    if (!words.length) return { i, score: 0 };
    const tf = new Map<string, number>();
    for (const w of words) tf.set(w, (tf.get(w) ?? 0) + 1);
    let score = 0;
    for (const [w, c] of tf) score += (c / words.length) * Math.log((N + 1) / ((df.get(w) ?? 0) + 1));
    // Slight preference for earlier sentences (often topic-setting)
    score *= 1 + Math.max(0, 0.15 - i / Math.max(N, 1));
    return { i, score };
  });
  const chosen = new Set(
    scored
      .sort((a, b) => b.score - a.score)
      .slice(0, n)
      .map((s) => s.i),
  );
  return pool.filter((_, i) => chosen.has(i));
}

/** Extractive overview + per-chapter picks from already-indexed book text. No network, no model. */
export function summarizeBook(texts: DocText[]): ExtractedSummary {
  const units = [...texts]
    .filter((t) => t.text.replace(/\s/g, "").length >= MIN_UNIT_CHARS)
    .sort((a, b) => a.unit - b.unit);

  const chapters: ChapterSummary[] = [];
  const overviewPool: string[] = [];

  for (const unit of units) {
    const picked = pickSentences(sentences(unit.text), PER_CHAPTER);
    if (!picked.length) continue;
    chapters.push({ unit: unit.unit, label: unit.label, href: unit.href, text: picked.join(" ") });
    overviewPool.push(...picked);
  }

  const overview = pickSentences(overviewPool, OVERVIEW).join(" ");
  return { overview, chapters };
}
