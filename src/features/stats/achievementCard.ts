import { SANS, SERIF, type CardFormat, type CardTheme } from "../share/quoteCard";
import { formatDuration } from "./stats";

export type ChartStyle = "bar" | "line";
export type StatVariant = "1" | "2" | "3" | "4" | "5";
export type Ink = "white" | "black";

export interface Achievement {
  period: string; // the chosen date, already formatted
  book?: { title: string; author?: string; percent: number };
  ms: number;
  pages: number;
  streak: number;
  daysRead: number;
  pagesPerHour?: number;
  daily: number[]; // reading time per day, oldest first
  dailyPages?: number[]; // pages per day, matching daily
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

const W = 1080;
const PAD = 56;

// Each variant is its own composition. Swapping the words inside one stack is not a different sticker.
export async function renderAchievement(
  a: Achievement,
  _format: CardFormat,
  _theme: CardTheme,
  chart: ChartStyle = "bar",
  sticker?: { variant: string; ink: Ink },
): Promise<HTMLCanvasElement> {
  const variant = (sticker?.variant ?? "1") as StatVariant;
  const ink = sticker?.ink ?? "white";
  const color = INK[ink];
  await document.fonts.load(`700 160px ${SANS}`).catch(() => undefined);
  await document.fonts.load(`600 72px ${SERIF}`).catch(() => undefined);
  const canvas = document.createElement("canvas");
  const heights: Record<StatVariant, number> = { "1": 720, "2": 860, "3": 640, "4": 760, "5": 780 };
  canvas.width = W;
  canvas.height = heights[variant];
  const ctx = canvas.getContext("2d")!;
  ctx.textBaseline = "top";
  ctx.shadowColor = ink === "white" ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.45)";
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 3;
  const draw: Record<StatVariant, () => void> = {
    "1": () => layoutRow(ctx, a, chart, color),
    "2": () => layoutPoster(ctx, a, chart, color),
    "3": () => layoutRail(ctx, a, chart, color),
    "4": () => layoutChartFirst(ctx, a, chart, color),
    "5": () => layoutSplit(ctx, a, chart, color),
  };
  draw[variant]();
  return canvas;
}

type InkColor = { text: string; sub: string };

function paceOf(a: Achievement) {
  return a.pagesPerHour != null ? String(a.pagesPerHour) : "—";
}

function bookOf(a: Achievement) {
  return a.book ? `${a.book.title} · ${Math.round(a.book.percent * 100)}%` : "";
}

// Variant 1: pace first, then time, pages and streak, in one sans row. Chart underneath.
function layoutRow(ctx: CanvasRenderingContext2D, a: Achievement, chart: ChartStyle, color: InkColor) {
  write(ctx, a.period.toUpperCase(), PAD, 36, `600 26px ${SANS}`, color.sub);
  if (bookOf(a)) write(ctx, bookOf(a), PAD, 74, `600 28px ${SERIF}`, color.text, "left", W - PAD * 2);
  const cols = [
    [paceOf(a), "pages/h"],
    [formatDuration(a.ms), "reading time"],
    [String(a.pages), a.pages === 1 ? "page" : "pages"],
    [String(a.streak), a.streak === 1 ? "day streak" : "days streak"],
  ] as const;
  cols.forEach(([value, label], i) => {
    const x = PAD + i * 250;
    write(ctx, value, x, 140, `700 72px ${SANS}`, color.text);
    write(ctx, label, x, 224, `600 22px ${SANS}`, color.sub);
  });
  const series = readingSeries(a);
  if (series) drawSeries(ctx, series, chart, color.text, PAD, 300, W - PAD * 2, 280);
  write(ctx, "LumaRead", W - PAD, 650, `600 24px ${SANS}`, color.sub, "right");
}

// Variant 2: serif pace as the poster hero, the other stats centered beneath it.
function layoutPoster(ctx: CanvasRenderingContext2D, a: Achievement, chart: ChartStyle, color: InkColor) {
  write(ctx, a.period.toUpperCase(), W / 2, 40, `600 24px ${SANS}`, color.sub, "center");
  write(ctx, "pages/h", W / 2, 88, `600 28px ${SERIF}`, color.sub, "center");
  write(ctx, paceOf(a), W / 2, 130, `700 150px ${SERIF}`, color.text, "center");
  const rest = [
    [formatDuration(a.ms), "reading time"],
    [String(a.pages), a.pages === 1 ? "page" : "pages"],
    [String(a.streak), "streak"],
  ] as const;
  rest.forEach(([value, label], i) => {
    const x = 180 + i * 280;
    write(ctx, value, x, 340, `700 48px ${SANS}`, color.text, "center");
    write(ctx, label, x, 400, `600 22px ${SANS}`, color.sub, "center");
  });
  const series = readingSeries(a);
  if (series) drawSeries(ctx, series, chart, color.text, 140, 470, W - 280, 200);
  if (bookOf(a)) write(ctx, bookOf(a), W / 2, 710, `600 28px ${SERIF}`, color.text, "center", W - PAD * 2);
  write(ctx, "LumaRead", W / 2, 790, `600 24px ${SERIF}`, color.sub, "center");
}

// Variant 3: a left-hand list, pace on top, chart filling the right side.
function layoutRail(ctx: CanvasRenderingContext2D, a: Achievement, chart: ChartStyle, color: InkColor) {
  write(ctx, a.period.toUpperCase(), PAD, 36, `600 22px ${SANS}`, color.sub);
  const rows = [
    [paceOf(a), "pages/h"],
    [formatDuration(a.ms), "reading time"],
    [String(a.pages), a.pages === 1 ? "page" : "pages"],
    [String(a.streak), a.streak === 1 ? "day streak" : "days streak"],
  ] as const;
  rows.forEach(([value, label], i) => {
    const y = 90 + i * 110;
    write(ctx, label, PAD, y, `600 22px ${SERIF}`, color.sub);
    write(ctx, value, PAD, y + 28, i === 0 ? `700 64px ${SERIF}` : `700 48px ${SANS}`, color.text);
  });
  const series = readingSeries(a);
  if (series) drawSeries(ctx, series, chart, color.text, 520, 120, 500, 400);
  if (bookOf(a)) write(ctx, bookOf(a), PAD, 540, `600 24px ${SERIF}`, color.text, "left", 440);
  write(ctx, "LumaRead", W - PAD, 580, `600 22px ${SANS}`, color.sub, "right");
}

// Variant 4: the chart leads. Stats sit in a bottom band, labels in serif above the figures.
function layoutChartFirst(ctx: CanvasRenderingContext2D, a: Achievement, chart: ChartStyle, color: InkColor) {
  write(ctx, "LumaRead", PAD, 28, `600 22px ${SERIF}`, color.sub);
  write(ctx, a.period.toUpperCase(), W - PAD, 28, `600 22px ${SANS}`, color.sub, "right");
  const series = readingSeries(a);
  if (series) drawSeries(ctx, series, chart, color.text, PAD, 80, W - PAD * 2, 340);
  if (bookOf(a)) write(ctx, bookOf(a), W - PAD, 450, `600 26px ${SERIF}`, color.text, "right", W - PAD * 2);
  const cols = [
    [paceOf(a), "pages/h"],
    [formatDuration(a.ms), "reading time"],
    [String(a.pages), a.pages === 1 ? "page" : "pages"],
    [String(a.streak), "streak"],
  ] as const;
  cols.forEach(([value, label], i) => {
    const x = W - PAD - (3 - i) * 240;
    write(ctx, label, x, 520, `600 22px ${SERIF}`, color.sub, "right");
    write(ctx, value, x, 556, `700 64px ${SANS}`, color.text, "right");
  });
}

// Variant 5: pace owns the top right. The other stats stack at the bottom left, chart in between.
function layoutSplit(ctx: CanvasRenderingContext2D, a: Achievement, chart: ChartStyle, color: InkColor) {
  write(ctx, a.period.toUpperCase(), PAD, 40, `600 24px ${SANS}`, color.sub);
  write(ctx, paceOf(a), W - PAD, 36, `700 120px ${SERIF}`, color.text, "right");
  write(ctx, "pages/h", W - PAD, 168, `600 26px ${SERIF}`, color.sub, "right");
  const series = readingSeries(a);
  if (series) drawSeries(ctx, series, chart, color.text, 300, 230, 720, 240);
  const rest = [
    [formatDuration(a.ms), "reading time"],
    [String(a.pages), a.pages === 1 ? "page" : "pages"],
    [String(a.streak), a.streak === 1 ? "day streak" : "days streak"],
  ] as const;
  rest.forEach(([value, label], i) => {
    const y = 250 + i * 100;
    write(ctx, value, PAD, y, `700 52px ${SANS}`, color.text);
    write(ctx, label, PAD, y + 58, `600 20px ${SANS}`, color.sub);
  });
  if (bookOf(a)) write(ctx, bookOf(a), W - PAD, 640, `600 26px ${SERIF}`, color.text, "right", 700);
  write(ctx, "LumaRead", PAD, 720, `600 22px ${SERIF}`, color.sub);
}

function write(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, font: string, color: string, align: CanvasTextAlign = "left", max?: number) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(text, x, y, max);
  ctx.textAlign = "left";
}

function readingSeries(a: Achievement): number[] | undefined {
  if (!a.daily.some((v) => v > 0)) return undefined;
  return bucket(a.daily);
}

function drawSeries(ctx: CanvasRenderingContext2D, values: number[], style: ChartStyle, color: string, x: number, y: number, w: number, h: number) {
  const max = Math.max(...values, 1);
  const n = values.length;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 8;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (style === "line") {
    ctx.beginPath();
    values.forEach((v, i) => {
      const px = x + (n === 1 ? w / 2 : (i / (n - 1)) * w);
      const py = y + h - (v / max) * (h - 16);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
    values.forEach((v, i) => {
      const px = x + (n === 1 ? w / 2 : (i / (n - 1)) * w);
      const py = y + h - (v / max) * (h - 16);
      ctx.beginPath();
      ctx.arc(px, py, 7, 0, Math.PI * 2);
      ctx.fill();
    });
  } else {
    const gap = n > 20 ? 4 : 10;
    const bw = Math.max(6, (w - gap * (n - 1)) / n);
    values.forEach((v, i) => {
      if (v <= 0) return;
      const bh = Math.max(10, (v / max) * h);
      const bx = x + i * (bw + gap);
      const by = y + h - bh;
      const r = Math.min(10, bw / 2, bh / 2);
      ctx.beginPath();
      ctx.moveTo(bx, y + h);
      ctx.lineTo(bx, by + r);
      ctx.quadraticCurveTo(bx, by, bx + r, by);
      ctx.lineTo(bx + bw - r, by);
      ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + r);
      ctx.lineTo(bx + bw, y + h);
      ctx.closePath();
      ctx.fill();
    });
  }
  ctx.restore();
}
