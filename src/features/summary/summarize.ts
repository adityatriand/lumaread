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
const PAGE_OVERVIEW = 12;

const isPageLabel = (label: string) => /^page\s+\d+/i.test(label.trim());

// Copyright pages, ISBN blocks, award bios — dense rare words that TF–IDF loves
const BOILERPLATE =
  /hak\s*cipta|undang[-\s]?undang|copyright|all\s+rights\s+reserved|isbn|dilarang\s+mengutip|sanksi\s+pidana|pidana\s+penjara|penerbit|gramedia|percetakan|katalog\s+dalam\s+terbitan|\bkdt\b|edogawa|naoki\s+prize|penghargaan\s+sastra|printed\s+in|undang\s+no\.?\s*\d+/i;

// Small EN + ID set so frequency scoring ignores glue words
const STOP = new Set(
  fold(
    "a an the and or but if in on at to for of as is was are were be been being it this that these those with from by not no so than then into over after before about between through during without within " +
      "i you he she we they me him her us them my your his its our their what which who whom whose when where why how " +
      "dan atau yang di ke dari pada untuk dengan tidak ya sudah akan ada adalah ini itu mereka saya kamu kita dia nya " +
      "juga karena jika maka setelah sebelum tentang antara oleh sebagai",
  ).split(/\s+/),
);

function clean(text: string): string {
  return text.replace(/[|°~•]+/g, " ").replace(/\s+/g, " ").trim();
}

function isBoilerplate(s: string): boolean {
  if (BOILERPLATE.test(s)) return true;
  // ISBN-ish digit runs with publishing noise
  if (/\b97[89][\d-]{10,}\b/.test(s)) return true;
  // OCR garbage lines
  if ((s.match(/[|/]/g) ?? []).length >= 3) return true;
  return false;
}

function sentences(text: string): string[] {
  return clean(text)
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 40 && /[\p{L}]/u.test(s) && !isBoilerplate(s));
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

/** Skip title/copyright front and award/bio back matter on long PDFs. */
function inBody(index: number, total: number): boolean {
  if (total <= 8) return true;
  const margin = Math.max(2, Math.floor(total * 0.04));
  return index >= margin && index < total - margin;
}

/** Extractive overview (+ chapter picks for real chapters). PDFs stay one wrap — no per-page list. */
export function summarizeBook(texts: DocText[]): ExtractedSummary {
  const units = [...texts]
    .filter((t) => t.text.replace(/\s/g, "").length >= MIN_UNIT_CHARS)
    .sort((a, b) => a.unit - b.unit);

  // PDF/OCR units are "Page N"; dumping each page is not a summary
  const pageMode = units.length > 0 && units.every((u) => isPageLabel(u.label));

  const chapters: ChapterSummary[] = [];
  const overviewPool: string[] = [];

  units.forEach((unit, index) => {
    if (pageMode && !inBody(index, units.length)) return;
    const picked = pickSentences(sentences(unit.text), PER_CHAPTER);
    if (!picked.length) return;
    if (!pageMode) {
      chapters.push({ unit: unit.unit, label: unit.label, href: unit.href, text: picked.join(" ") });
    }
    overviewPool.push(...picked);
  });

  const n = pageMode ? PAGE_OVERVIEW : OVERVIEW;
  const overview = pickSentences(overviewPool, n).join(" ");
  return { overview, chapters };
}
