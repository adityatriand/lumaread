import { describe, expect, it } from "vitest";
import type { Session } from "../../lib/db";
import { byDay, dayKey, estimateRemainingMs, formatDuration, lastDays, streaks, summarize, timeByBook } from "./stats";

const NOW = new Date(2026, 9, 20, 15).getTime(); // 20 Oct 2026, 15:00 local
const at = (daysAgo: number) => new Date(2026, 9, 20 - daysAgo, 10).getTime();
const session = (daysAgo: number, minutes: number, extra: Partial<Session> = {}): Session => ({
  id: `${daysAgo}-${minutes}-${extra.docId ?? "a"}`,
  docId: "a",
  day: dayKey(at(daysAgo)),
  startedAt: at(daysAgo),
  endedAt: at(daysAgo) + minutes * 60_000,
  activeMs: minutes * 60_000,
  pages: minutes,
  startPercent: 0,
  endPercent: 0,
  ...extra,
});

describe("lastDays / byDay", () => {
  it("lists local days oldest first, across a month boundary", () => {
    expect(lastDays(3, new Date(2026, 10, 1, 9).getTime())).toEqual(["2026-10-30", "2026-10-31", "2026-11-01"]);
  });

  it("sums sessions per day and zero-fills empty days", () => {
    const days = lastDays(3, NOW);
    expect(byDay([session(0, 10), session(0, 5), session(2, 20), session(9, 99)], days)).toEqual([
      { day: "2026-10-18", ms: 20 * 60_000, pages: 20 },
      { day: "2026-10-19", ms: 0, pages: 0 },
      { day: "2026-10-20", ms: 15 * 60_000, pages: 15 },
    ]);
  });
});

describe("streaks", () => {
  it("counts back from today, or from yesterday when today has no reading yet", () => {
    expect(streaks([session(0, 5), session(1, 5), session(2, 5)], NOW).current).toBe(3);
    expect(streaks([session(1, 5), session(2, 5)], NOW).current).toBe(2);
    expect(streaks([session(2, 5)], NOW).current).toBe(0);
  });

  it("ignores days under a minute and finds the longest run", () => {
    const s = [session(0, 5), session(1, 0.5), session(5, 5), session(6, 5), session(7, 5)];
    expect(streaks(s, NOW)).toEqual({ current: 1, longest: 3 });
  });
});

describe("summaries", () => {
  it("totals time, pages and days; rate only once there is enough data", () => {
    expect(summarize([session(0, 5)])).toMatchObject({ ms: 300_000, pages: 5, daysRead: 1, pagesPerHour: undefined });
    expect(summarize([session(0, 30), session(1, 30)]).pagesPerHour).toBe(60);
  });

  it("ranks books by time", () => {
    expect(timeByBook([session(0, 5), session(0, 30, { docId: "b" }), session(1, 10)])).toEqual([
      { docId: "b", ms: 30 * 60_000 },
      { docId: "a", ms: 15 * 60_000 },
    ]);
  });

  it("estimates time left from progress gained per minute", () => {
    // 60 minutes moved the book from 10% to 40% → 60% left takes 120 minutes
    const s = [session(1, 30, { startPercent: 0.1, endPercent: 0.25 }), session(0, 30, { startPercent: 0.25, endPercent: 0.4 })];
    expect(estimateRemainingMs(s, 0.4)).toBeCloseTo(120 * 60_000);
    expect(estimateRemainingMs([session(0, 30)], 0.4)).toBeUndefined();
  });

  it("formats durations", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(20_000)).toBe("<1m");
    expect(formatDuration(45 * 60_000)).toBe("45m");
    expect(formatDuration(125 * 60_000)).toBe("2h 05m");
  });
});

describe("achievement card helpers", () => {
  it("buckets long ranges into weeks ending today and keeps short ones daily", async () => {
    const { bucket, achievementCaption } = await import("./achievementCard");
    expect(bucket([1, 2, 3])).toEqual([1, 2, 3]);
    const weeks = bucket(Array.from({ length: 90 }, (_, i) => i + 1));
    expect(weeks).toHaveLength(13);
    expect(weeks.at(-1)).toBe(84 + 85 + 86 + 87 + 88 + 89 + 90);
    expect(weeks[0]).toBe(1 + 2 + 3 + 4 + 5 + 6);
    expect(achievementCaption({ period: "Last 7 days", ms: 125 * 60_000, pages: 140, streak: 4, daysRead: 5, daily: [] })).toBe(
      "2h 05m of reading and 140 pages in the last 7 days and a 4-day streak. #LumaRead",
    );
  });
});
