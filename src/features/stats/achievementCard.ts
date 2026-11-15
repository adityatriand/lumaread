import { SANS, SERIF, wrapText, type CardFormat, type CardTheme } from "../share/quoteCard";
import { formatDuration } from "./stats";

export type ChartStyle = "bar" | "line";
export type StatVariant = "summary" | "time" | "pages" | "streak" | "pace" | "book";
export type Ink = "white" | "black";

export interface Achievement {
  period: string; // the chosen date, already formatted
  book?: { title: string; author?: string; percent: number };
  ms: number;
  pages: number;
  streak: number;
  daysRead: number;
  pagesPerHour?: number;
  daily: number[]; // kept so older callers and the week/month helper stay stable
  days: string[];
}

// Long ranges read better as weekly bars on a small card
export function bucket(daily: number[]): number[] {
  if (daily.length <= 31) return daily;
  const weeks: number[] = [];
  // Weeks end today; the oldest bucket may be partial
  for (let end = daily.length; end > 0; end -= 7) weeks.unshift(daily.slice(Math.max(0, end - 7), end).reduce((x, y) => x + y, 0));
  return weeks;
}

// First day of each bucket, matching bucket()
export function bucketDays(days: string[]): string[] {
  if (days.length <= 31) return days;
  const starts: string[] = [];
  for (let end = days.length; end > 0; end -= 7) starts.unshift(days[Math.max(0, end - 7)]);
  return starts;
}

export function achievementCaption(a: Achievement): string {
  const time = formatDuration(a.ms);
  if (a.book) return `${time} with “${a.book.title}” — ${Math.round(a.book.percent * 100)}% read. #LumaRead`;
  const streak = a.streak > 1 ? ` · ${a.streak}-day streak` : "";
  const when = a.period.includes("–") ? `from ${a.period.replace("–", "to")}` : `on ${a.period}`;
  return `${time} of reading and ${a.pages} pages ${when}${streak}. #LumaRead`;
}

const INK = {
  white: { text: "#ffffff", sub: "rgba(255,255,255,0.86)" },
  black: { text: "#16161e", sub: "rgba(22,22,30,0.72)" },
};

interface Line { text: string; font: string; color: string; size: number; gap: number }

// Transparent sticker, tight around the type, so it can sit on a photo the way a Strava stat does.
export async function renderAchievement(
  a: Achievement,
  _format: CardFormat,
  _theme: CardTheme,
  _chart: ChartStyle = "bar",
  sticker?: { variant: string; ink: Ink },
): Promise<HTMLCanvasElement> {
  const variant = (sticker?.variant ?? "summary") as StatVariant;
  const ink = sticker?.ink ?? "white";
  const color = INK[ink];
  await document.fonts.load(`700 120px ${SANS}`).catch(() => undefined);
  await document.fonts.load(`600 64px ${SERIF}`).catch(() => undefined);

  const W = 1080;
  const pad = 64;
  const lines = stickerLines(a, variant, color);
  const measure = document.createElement("canvas").getContext("2d")!;
  const rowsOf = (line: Line) => {
    measure.font = line.font;
    const wrapped = wrapText(line.text, W - pad * 2, (t) => measure.measureText(t).width);
    return (line.size >= 80 ? wrapped.slice(0, 2) : wrapped.slice(0, 3));
  };
  const height = pad + lines.reduce((sum, line) => sum + rowsOf(line).length * (line.size + 8) + line.gap, pad);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = Math.max(height, 280);
  const ctx = canvas.getContext("2d")!;
  ctx.textBaseline = "top";
  ctx.shadowColor = ink === "white" ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.45)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 4;

  let y = pad;
  for (const line of lines) {
    ctx.font = line.font;
    ctx.fillStyle = line.color;
    for (const row of rowsOf(line)) {
      ctx.fillText(row, pad, y, W - pad * 2);
      y += line.size + 8;
    }
    y += line.gap;
  }
  return canvas;
}

function stickerLines(a: Achievement, variant: StatVariant, color: { text: string; sub: string }): Line[] {
  const label = (text: string): Line => ({ text, font: `600 34px ${SANS}`, color: color.sub, size: 34, gap: 28 });
  const hero = (text: string): Line => ({ text, font: `700 132px ${SANS}`, color: color.text, size: 132, gap: 8 });
  const title = (text: string): Line => ({ text, font: `600 72px ${SERIF}`, color: color.text, size: 72, gap: 12 });
  const date = label(a.period.toUpperCase());
  const mark: Line = { text: "LumaRead", font: `600 28px ${SANS}`, color: color.sub, size: 28, gap: 0 };
  const time = formatDuration(a.ms);
  const pages = String(a.pages);
  const streak = String(a.streak);

  if (variant === "time") return [date, hero(time), label("reading time"), mark];
  if (variant === "pages") return [date, hero(pages), label(a.pages === 1 ? "page" : "pages"), mark];
  if (variant === "streak") return [date, hero(streak), label(a.streak === 1 ? "day streak" : "days streak"), mark];
  if (variant === "pace") return [date, hero(a.pagesPerHour ? String(a.pagesPerHour) : "—"), label("pages per hour"), mark];
  if (variant === "book" && a.book) {
    return [
      date,
      title(a.book.title),
      ...(a.book.author ? [label(a.book.author)] : []),
      hero(`${Math.round(a.book.percent * 100)}%`),
      label("complete"),
      mark,
    ];
  }
  return [
    date,
    hero(time),
    label("reading time"),
    hero(pages),
    label(a.pages === 1 ? "page" : "pages"),
    hero(streak),
    label("day streak"),
    mark,
  ];
}
