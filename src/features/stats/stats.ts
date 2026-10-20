import type { Session } from "../../lib/db";

// A day counts toward a streak once this much reading happened on it
export const MIN_DAY_MS = 60_000;

const pad = (n: number) => String(n).padStart(2, "0");

// Local calendar day, so "today" matches the reader's clock rather than UTC
export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// The last n local days, oldest first, ending today
export function lastDays(n: number, now = Date.now()): string[] {
  const d = new Date(now);
  return Array.from({ length: n }, (_, i) => dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - (n - 1 - i), 12).getTime()));
}

export interface DayStat { day: string; ms: number; pages: number }

export function byDay(sessions: Session[], days: string[]): DayStat[] {
  const totals = new Map(days.map((day) => [day, { day, ms: 0, pages: 0 }]));
  for (const s of sessions) {
    const t = totals.get(s.day);
    if (!t) continue;
    t.ms += s.activeMs;
    t.pages += s.pages;
  }
  return days.map((d) => totals.get(d)!);
}

export function streaks(sessions: Session[], now = Date.now()): { current: number; longest: number } {
  const perDay = new Map<string, number>();
  for (const s of sessions) perDay.set(s.day, (perDay.get(s.day) ?? 0) + s.activeMs);
  const read = new Set([...perDay].filter(([, ms]) => ms >= MIN_DAY_MS).map(([d]) => d));

  const step = (key: string, delta: number) => {
    const [y, m, d] = key.split("-").map(Number);
    return dayKey(new Date(y, m - 1, d + delta, 12).getTime());
  };

  // Today not read yet doesn't break the streak until the day is over
  let cursor = read.has(dayKey(now)) ? dayKey(now) : step(dayKey(now), -1);
  let current = 0;
  while (read.has(cursor)) {
    current++;
    cursor = step(cursor, -1);
  }

  let longest = 0;
  for (const day of read) {
    if (read.has(step(day, -1))) continue; // only count from the first day of each run
    let len = 0;
    for (let c = day; read.has(c); c = step(c, 1)) len++;
    longest = Math.max(longest, len);
  }
  return { current, longest };
}

export interface Summary { ms: number; pages: number; sessions: number; daysRead: number; pagesPerHour?: number }

export function summarize(sessions: Session[]): Summary {
  const ms = sessions.reduce((a, s) => a + s.activeMs, 0);
  const pages = sessions.reduce((a, s) => a + s.pages, 0);
  const daysRead = new Set(sessions.map((s) => s.day)).size;
  // Under 10 minutes the rate is mostly noise
  const pagesPerHour = ms >= 10 * 60_000 ? Math.round(pages / (ms / 3_600_000)) : undefined;
  return { ms, pages, sessions: sessions.length, daysRead, pagesPerHour };
}

export function timeByBook(sessions: Session[]): { docId: string; ms: number }[] {
  const totals = new Map<string, number>();
  for (const s of sessions) totals.set(s.docId, (totals.get(s.docId) ?? 0) + s.activeMs);
  return [...totals].map(([docId, ms]) => ({ docId, ms })).sort((a, b) => b.ms - a.ms);
}

// Time per percent of the book so far, applied to what's left; needs a little progress to be meaningful
export function estimateRemainingMs(sessions: Session[], percent: number): number | undefined {
  const gained = sessions.reduce((a, s) => a + Math.max(0, s.endPercent - s.startPercent), 0);
  const ms = sessions.reduce((a, s) => a + s.activeMs, 0);
  if (gained < 0.02 || percent >= 1) return undefined;
  return ((1 - percent) * ms) / gained;
}

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return ms > 0 ? "<1m" : "0m";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${pad(m)}m` : `${m}m`;
}
