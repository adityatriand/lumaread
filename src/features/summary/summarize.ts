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
const PER_UNIT = 1;
const OVERVIEW_CAP = 28;
const PAGE_SEGMENTS = 4;
const CHUNK_TARGET = 1400;
const CHUNK_MAX = 24;

const isPageLabel = (label: string) => /^page\s+\d+/i.test(label.trim());

const BOILERPLATE =
  /hak\s*cipta|undang[-\s]?undang|copyright|all\s+rights\s+reserved|isbn|dilarang\s+mengutip|sanksi\s+pidana|pidana\s+penjara|penerbit|gramedia|percetakan|katalog\s+dalam\s+terbitan|\bkdt\b|edogawa|naoki\s+prize|penghargaan\s+sastra|printed\s+in|undang\s+no\.?\s*\d+/i;

const STOP = new Set(
  fold(
    "a an the and or but if in on at to for of as is was are were be been being it this that these those with from by not no so than then into over after before about between through during without within " +
      "i you he she we they me him her us them my your his its our their what which who whom whose when where why how " +
      "dan atau yang di ke dari pada untuk dengan tidak ya sudah akan ada adalah ini itu mereka saya kamu kita dia nya " +
      "juga karena jika maka setelah sebelum tentang antara oleh sebagai",
  ).split(/\s+/),
);

export function cleanSummaryText(text: string): string {
  return text
    .replace(/[|°~•]+/g, " ")
    .replace(/(\p{L})\s+\d{1,4}\s+(\p{L})/gu, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function isBoilerplate(s: string): boolean {
  if (BOILERPLATE.test(s)) return true;
  if (/\b97[89][\d-]{10,}\b/.test(s)) return true;
  if ((s.match(/[|/]/g) ?? []).length >= 3) return true;
  if (/\b(yen|rupiah|€|£)\b/i.test(s) || (/\b(dollar|dollars)\b/i.test(s) && /\d/.test(s))) return true;
  return false;
}

function sentences(text: string): string[] {
  return cleanSummaryText(text)
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 40 && /[\p{L}]/u.test(s) && !isBoilerplate(s));
}

function tokens(s: string): string[] {
  return fold(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

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
    for (const [w, c] of tf) {
      const idf = Math.log((N + 1) / ((df.get(w) ?? 0) + 1));
      score += (c / words.length) * (0.35 + 0.65 * idf);
    }
    score *= 1 + Math.max(0, 0.1 - i / Math.max(N, 1));
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

function sampleAcross(pool: string[], n: number): string[] {
  if (pool.length <= n) return pickSentences(pool, n);
  const per = Math.max(1, Math.ceil(n / PAGE_SEGMENTS));
  const picked: string[] = [];
  for (let b = 0; b < PAGE_SEGMENTS; b++) {
    const start = Math.floor((b * pool.length) / PAGE_SEGMENTS);
    const end = Math.floor(((b + 1) * pool.length) / PAGE_SEGMENTS);
    picked.push(...pickSentences(pool.slice(start, Math.max(end, start + 1)), per));
  }
  const want = new Set(picked);
  return pool.filter((s) => want.has(s)).slice(0, n);
}

function inBody(index: number, total: number): boolean {
  if (total <= 8) return true;
  const margin = Math.max(2, Math.floor(total * 0.04));
  return index >= margin && index < total - margin;
}

/** Body units only (skip PDF front/back matter). */
export function bookBodyUnits(texts: DocText[]): DocText[] {
  const units = [...texts]
    .filter((t) => t.text.replace(/\s/g, "").length >= MIN_UNIT_CHARS)
    .sort((a, b) => a.unit - b.unit);
  const pageMode = units.length > 0 && units.every((u) => isPageLabel(u.label));
  if (!pageMode) return units;
  return units.filter((_, index) => inBody(index, units.length));
}

/**
 * Split the whole book body into ordered chunks that cover every page.
 * Hard-capped at maxChunks — chunk size grows for long books (DistilBART map budget).
 */
export function chunkBookForSummary(texts: DocText[], maxChunks = CHUNK_MAX, targetChars = CHUNK_TARGET): string[] {
  const parts = bookBodyUnits(texts)
    .map((u) => cleanSummaryText(u.text))
    .filter((t) => t.length >= 80);
  if (!parts.length) return [];

  const full = parts.join(" ");
  const size = Math.max(targetChars, Math.ceil(full.length / maxChunks));
  const chunks: string[] = [];
  let buf = "";
  for (const sentence of full.split(/(?<=[.!?…])\s+/)) {
    const next = buf ? `${buf} ${sentence}` : sentence;
    if (buf && next.length > size) {
      chunks.push(buf);
      buf = sentence;
    } else {
      buf = next;
    }
  }
  if (buf.trim()) chunks.push(buf.trim());

  // Sentence boundaries can overshoot — merge adjacent until ≤ maxChunks
  while (chunks.length > maxChunks) {
    const step = Math.ceil(chunks.length / maxChunks);
    const merged: string[] = [];
    for (let i = 0; i < chunks.length; i += step) {
      merged.push(chunks.slice(i, i + step).join(" "));
    }
    chunks.length = 0;
    chunks.push(...merged);
  }
  return chunks;
}

/**
 * One wrap for the whole book: 1 key sentence per page/chapter unit, then cap.
 * No per-page list — chapters stay empty for page-mode; EPUB still gets chapter rows.
 */
export function summarizeBook(texts: DocText[]): ExtractedSummary {
  const units = [...texts]
    .filter((t) => t.text.replace(/\s/g, "").length >= MIN_UNIT_CHARS)
    .sort((a, b) => a.unit - b.unit);

  const pageMode = units.length > 0 && units.every((u) => isPageLabel(u.label));
  const body = pageMode ? units.filter((_, index) => inBody(index, units.length)) : units;

  const chapters: ChapterSummary[] = [];
  const overviewPool: string[] = [];

  for (const unit of body) {
    const picked = pickSentences(sentences(unit.text), PER_UNIT);
    if (!picked.length) continue;
    // EPUB: keep short chapter rows; PDFs collapse to one wrap only
    if (!pageMode) {
      chapters.push({ unit: unit.unit, label: unit.label, href: unit.href, text: picked.join(" ") });
    }
    overviewPool.push(...picked);
  }

  // Always one overview covering the full body (every unit contributed when possible)
  const overview = sampleAcross(overviewPool, Math.min(OVERVIEW_CAP, Math.max(8, overviewPool.length))).join(" ");
  return { overview, chapters: pageMode ? [] : chapters };
}
