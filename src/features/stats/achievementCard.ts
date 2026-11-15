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
  const variant = (sticker?.variant ?? "summary") as StatVariant;
  const ink = sticker?.ink ?? "white";
  const color = INK[ink];
  await document.fonts.load(`700 160px ${SANS}`).catch(() => undefined);
  await document.fonts.load(`600 64px ${SERIF}`).catch(() => undefined);
  const canvas = document.createElement("canvas");
  const layouts: Record<StatVariant, (ctx: CanvasRenderingContext2D) => void> = {
    summary: (ctx) => layoutSummary(ctx, a, chart, color),
    time: (ctx) => layoutTime(ctx, a, chart, color),
    pages: (ctx) => layoutPages(ctx, a, chart, color),
    streak: (ctx) => layoutStreak(ctx, a, color),
    pace: (ctx) => layoutPace(ctx, a, color),
    book: (ctx) => (a.book ? layoutBook(ctx, a, color) : layoutSummary(ctx, a, chart, color)),
  };
  const height = variant === "book" && a.book ? bookHeight(a) : variant === "summary" ? 640 : variant === "pages" ? 700 : variant === "time" ? 520 : 560;
  canvas.width = W;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.textBaseline = "top";
  ctx.shadowColor = ink === "white" ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.45)";
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 3;
  layouts[variant](ctx);
  return canvas;
}

function layoutSummary(ctx: CanvasRenderingContext2D, a: Achievement, chart: ChartStyle, color: { text: string; sub: string }) {
  write(ctx, a.period.toUpperCase(), PAD, 36, `600 28px ${SANS}`, color.sub);
  const cols = [
    [formatDuration(a.ms), "reading time"],
    [String(a.pages), a.pages === 1 ? "page" : "pages"],
    [String(a.streak), a.streak === 1 ? "day streak" : "days streak"],
  ] as const;
  cols.forEach(([value, label], i) => {
    const x = PAD + i * 330;
    write(ctx, value, x, 96, `700 92px ${SANS}`, color.text);
    write(ctx, label, x, 204, `600 26px ${SANS}`, color.sub);
  });
  const series = chartSeries(a, "summary");
  if (series) drawSeries(ctx, series, chart, color.text, PAD, 280, W - PAD * 2, 220);
  write(ctx, "LumaRead", W - PAD, 560, `600 26px ${SANS}`, color.sub, "right");
}

function layoutTime(ctx: CanvasRenderingContext2D, a: Achievement, chart: ChartStyle, color: { text: string; sub: string }) {
  write(ctx, a.period.toUpperCase(), PAD, 48, `600 26px ${SANS}`, color.sub);
  write(ctx, formatDuration(a.ms), PAD, 110, `700 120px ${SANS}`, color.text);
  write(ctx, "reading time", PAD, 250, `600 28px ${SANS}`, color.sub);
  write(ctx, "LumaRead", PAD, 440, `600 26px ${SANS}`, color.sub);
  const series = chartSeries(a, "time");
  if (series) drawSeries(ctx, series, chart, color.text, 520, 80, 500, 340);
}

function layoutPages(ctx: CanvasRenderingContext2D, a: Achievement, chart: ChartStyle, color: { text: string; sub: string }) {
  const series = chartSeries(a, "pages");
  if (series) drawSeries(ctx, series, chart, color.text, PAD, 40, W - PAD * 2, 240);
  write(ctx, a.period.toUpperCase(), PAD, 320, `600 26px ${SANS}`, color.sub);
  write(ctx, "LumaRead", PAD, 620, `600 26px ${SANS}`, color.sub);
  write(ctx, String(a.pages), W - PAD, 400, `700 150px ${SANS}`, color.text, "right");
  write(ctx, a.pages === 1 ? "page" : "pages", W - PAD, 570, `600 32px ${SANS}`, color.sub, "right");
}

function layoutStreak(ctx: CanvasRenderingContext2D, a: Achievement, color: { text: string; sub: string }) {
  write(ctx, a.period.toUpperCase(), W / 2, 48, `600 26px ${SANS}`, color.sub, "center");
  write(ctx, String(a.streak), W / 2, 110, `700 180px ${SANS}`, color.text, "center");
  write(ctx, a.streak === 1 ? "day streak" : "days streak", W / 2, 310, `600 32px ${SANS}`, color.sub, "center");
  const count = Math.min(Math.max(a.streak, 1), 16);
  const r = 11;
  const gap = 18;
  const total = count * r * 2 + (count - 1) * gap;
  let x = (W - total) / 2 + r;
  for (let i = 0; i < count; i++) {
    ctx.beginPath();
    ctx.arc(x, 420, r, 0, Math.PI * 2);
    if (i < a.streak) {
      ctx.fillStyle = color.text;
      ctx.fill();
    } else {
      ctx.strokeStyle = color.sub;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    x += r * 2 + gap;
  }
  write(ctx, "LumaRead", W / 2, 490, `600 26px ${SANS}`, color.sub, "center");
}

function layoutPace(ctx: CanvasRenderingContext2D, a: Achievement, color: { text: string; sub: string }) {
  write(ctx, "pages per hour", W / 2, 70, `600 32px ${SANS}`, color.sub, "center");
  write(ctx, a.pagesPerHour ? String(a.pagesPerHour) : "—", W / 2, 130, `700 200px ${SANS}`, color.text, "center");
  write(ctx, a.period.toUpperCase(), PAD, 470, `600 26px ${SANS}`, color.sub);
  write(ctx, "LumaRead", W - PAD, 470, `600 26px ${SANS}`, color.sub, "right");
}

function bookHeight(a: Achievement) {
  const title = a.book?.title ?? "";
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = `600 64px ${SERIF}`;
  const lines = wrapText(title, 640, (t) => measure.measureText(t).width).slice(0, 3);
  return 220 + lines.length * 76 + (a.book?.author ? 48 : 0);
}

function layoutBook(ctx: CanvasRenderingContext2D, a: Achievement, color: { text: string; sub: string }) {
  const book = a.book!;
  write(ctx, a.period.toUpperCase(), PAD, 40, `600 26px ${SANS}`, color.sub);
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = `600 64px ${SERIF}`;
  const lines = wrapText(book.title, 620, (t) => measure.measureText(t).width).slice(0, 3);
  lines.forEach((line, i) => write(ctx, line, PAD, 100 + i * 76, `600 64px ${SERIF}`, color.text));
  const percent = `${Math.round(book.percent * 100)}%`;
  write(ctx, percent, W - PAD, 100, `700 120px ${SANS}`, color.text, "right");
  let y = 100 + lines.length * 76 + 8;
  if (book.author) {
    write(ctx, book.author, PAD, y, `600 28px ${SANS}`, color.sub);
    y += 48;
  }
  const barW = 620;
  ctx.save();
  ctx.strokeStyle = color.sub;
  ctx.lineWidth = 4;
  roundRect(ctx, PAD, y, barW, 22, 11);
  ctx.stroke();
  ctx.fillStyle = color.text;
  roundRect(ctx, PAD, y, Math.max(22, barW * Math.min(1, book.percent)), 22, 11);
  ctx.fill();
  ctx.restore();
  write(ctx, "complete", PAD, y + 36, `600 26px ${SANS}`, color.sub);
  write(ctx, "LumaRead", W - PAD, y + 36, `600 26px ${SANS}`, color.sub, "right");
}

function write(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, font: string, color: string, align: CanvasTextAlign = "left") {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
  ctx.textAlign = "left";
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function chartSeries(a: Achievement, variant: StatVariant): number[] | undefined {
  if (variant !== "summary" && variant !== "time" && variant !== "pages") return undefined;
  const raw = variant === "pages" ? (a.dailyPages ?? a.daily) : a.daily;
  if (!raw.some((v) => v > 0)) return undefined;
  return bucket(raw);
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
