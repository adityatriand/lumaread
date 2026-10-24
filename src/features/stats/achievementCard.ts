import { CARD_PAD, FOOTER_H, SANS, SERIF, cardCanvas, wrapText, type CardFormat, type CardTheme } from "../share/quoteCard";
import { niceTicks } from "./charts";
import { formatDuration } from "./stats";

export type ChartStyle = "bar" | "line";

export interface Achievement {
  period: string; // "Last 7 days"
  book?: { title: string; author?: string; percent: number };
  ms: number;
  pages: number;
  streak: number;
  daysRead: number;
  daily: number[]; // ms per day, oldest first
  days: string[]; // local YYYY-MM-DD for each daily entry
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
  const streak = a.streak > 1 ? ` and a ${a.streak}-day streak` : "";
  return `${time} of reading and ${a.pages} pages in the ${a.period.toLowerCase()}${streak}. #LumaRead`;
}

export async function renderAchievement(a: Achievement, format: CardFormat, themeName: CardTheme, chart: ChartStyle = "bar"): Promise<HTMLCanvasElement> {
  const { canvas, ctx, W, H, theme } = await cardCanvas(format, themeName);
  const pad = CARD_PAD;
  const story = format === "story";
  const inner = W - pad * 2;
  let y = pad + (story ? 120 : 20);

  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = theme.sub;
  ctx.font = `600 32px ${SANS}`;
  ctx.fillText(`MY READING · ${a.period.toUpperCase()}`, pad, y);
  y += story ? 40 : 24;

  if (a.book) {
    ctx.fillStyle = theme.text;
    ctx.font = `600 ${story ? 64 : 52}px ${SERIF}`;
    for (const line of wrapText(a.book.title, inner, (t) => ctx.measureText(t).width).slice(0, 2)) {
      y += story ? 76 : 62;
      ctx.fillText(line, pad, y);
    }
    if (a.book.author) {
      y += 52;
      ctx.fillStyle = theme.sub;
      ctx.font = `400 34px ${SANS}`;
      ctx.fillText(a.book.author, pad, y, inner);
    }
  }

  // Hero figure: the one number the card leads with
  y += story ? 230 : 170;
  ctx.fillStyle = theme.text;
  ctx.font = `700 ${story ? 180 : 132}px ${SANS}`;
  ctx.fillText(formatDuration(a.ms), pad - 6, y, inner);
  y += 56;
  ctx.fillStyle = theme.sub;
  ctx.font = `400 36px ${SANS}`;
  ctx.fillText("reading time", pad, y);

  // Three stats in a row
  const third = a.book ? [`${Math.round(a.book.percent * 100)}%`, "complete"] : [String(a.daysRead), a.daysRead === 1 ? "day read" : "days read"];
  const stats: [string, string][] = [
    [String(a.pages), a.pages === 1 ? "page" : "pages"],
    [String(a.streak), "day streak"],
    [third[0], third[1]],
  ];
  y += story ? 150 : 120;
  stats.forEach(([value, label], i) => {
    const x = pad + (inner / 3) * i;
    ctx.fillStyle = theme.text;
    ctx.font = `700 ${story ? 80 : 64}px ${SANS}`;
    ctx.fillText(value, x, y, inner / 3 - 16);
    ctx.fillStyle = theme.sub;
    ctx.font = `400 32px ${SANS}`;
    ctx.fillText(label, x, y + 46, inner / 3 - 16);
  });
  y += 46;

  const bottom = H - pad - FOOTER_H - 40;

  // Book progress: a meter whose track is a faint step of the same ink
  if (a.book) {
    const barY = story ? y + 90 : bottom - 16;
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = theme.text;
    ctx.beginPath();
    ctx.roundRect(pad, barY, inner, 16, 8);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.roundRect(pad, barY, Math.max(16, inner * Math.min(1, a.book.percent)), 16, 8);
    ctx.fill();
    y = barY + 16;
  }

  // Daily chart (story only): single series on a shared baseline, minutes on the y axis, days on the x axis
  if (story) {
    const values = bucket(a.daily).map((ms) => ms / 60_000);
    const days = bucketDays(a.days);
    const ticks = niceTicks(Math.max(1, ...values));
    const top = ticks.at(-1)!;
    const AXIS = 76; // y tick labels
    const LABELS = 48; // x labels under the baseline
    const chartTop = y + 120;
    const base = bottom - LABELS;
    const chartH = base - chartTop;
    if (chartH > 160) {
      const left = pad + AXIS;
      const plotW = inner - AXIS;
      const slot = plotW / values.length;
      const yOf = (v: number) => base - (v / top) * chartH;
      const xOf = (i: number) => left + i * slot + slot / 2;

      ctx.font = `400 26px ${SANS}`;
      ctx.textBaseline = "middle";
      ctx.textAlign = "right";
      for (const t of ticks) {
        ctx.globalAlpha = t ? 0.15 : 0.3;
        ctx.fillStyle = theme.text;
        ctx.fillRect(left, yOf(t), plotW, 2);
        ctx.globalAlpha = 1;
        ctx.fillStyle = theme.sub;
        ctx.fillText(String(t), left - 14, yOf(t));
      }
      ctx.textAlign = "left";
      ctx.fillText("min", pad, chartTop - 36);

      // Real dates like the Stats page ("18 Oct"); ~110px per label so they never collide
      const every = Math.ceil(values.length / Math.max(1, Math.floor(plotW / 110)));
      const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      days.forEach((d, i) => i % every === 0 && ctx.fillText(dayLabel(d), xOf(i), bottom - 4, slot * every - 8));
      ctx.textAlign = "left";

      ctx.fillStyle = theme.text;
      ctx.strokeStyle = theme.text;
      if (chart === "line") {
        ctx.beginPath();
        values.forEach((v, i) => (i ? ctx.lineTo(xOf(i), yOf(v)) : ctx.moveTo(xOf(i), yOf(v))));
        ctx.lineWidth = 6;
        ctx.lineJoin = ctx.lineCap = "round";
        ctx.stroke();
        // Faint area under the line, closed down to the baseline
        ctx.lineTo(xOf(values.length - 1), base);
        ctx.lineTo(xOf(0), base);
        ctx.globalAlpha = 0.15;
        ctx.fill();
        ctx.globalAlpha = 1;
        values.forEach((v, i) => {
          ctx.beginPath();
          ctx.arc(xOf(i), yOf(v), values.length > 31 ? 6 : 9, 0, Math.PI * 2);
          ctx.fill();
        });
      } else {
        const bar = Math.min(48, slot - 8);
        ctx.globalAlpha = 0.9;
        values.forEach((v, i) => {
          const h = base - yOf(v);
          if (h <= 0) return;
          ctx.beginPath();
          ctx.roundRect(xOf(i) - bar / 2, base - h, bar, h, [Math.min(8, bar / 2, h), Math.min(8, bar / 2, h), 0, 0]);
          ctx.fill();
        });
        ctx.globalAlpha = 1;
      }
    }
  }
  return canvas;
}
