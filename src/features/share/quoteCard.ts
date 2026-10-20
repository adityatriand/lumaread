export type CardFormat = "story" | "square";
export type CardTheme = "luma" | "paper" | "night";

export interface CardInput {
  quote: string;
  title: string;
  author?: string;
  location?: string; // "p. 28" or chapter title
  format: CardFormat;
  theme: CardTheme;
}

// Instagram/WhatsApp story is 9:16 at 1080 wide; square suits feed posts and chats
export const SIZES: Record<CardFormat, [number, number]> = { story: [1080, 1920], square: [1080, 1080] };

export const CARD_THEMES: Record<CardTheme, { label: string; bg: [string, string]; text: string; sub: string; mark: string }> = {
  luma: { label: "Luma", bg: ["#8B78FF", "#5144D8"], text: "#ffffff", sub: "rgba(255,255,255,0.78)", mark: "rgba(255,255,255,0.28)" },
  paper: { label: "Paper", bg: ["#faf4e6", "#efe2c4"], text: "#3b2f20", sub: "#7a6a52", mark: "#c9a86a" },
  night: { label: "Night", bg: ["#1d1c2b", "#0e0e16"], text: "#f1f0fa", sub: "#a3a1bd", mark: "#8B78FF" },
};

const SERIF = `"Source Serif 4 Variable", "Noto Serif", serif`;
const SANS = `system-ui, -apple-system, Roboto, "Noto Sans", sans-serif`;

type Measure = (text: string) => number;

// Greedy word wrap; a word wider than the line (long URL, CJK run) is broken by character
export function wrapText(text: string, maxWidth: number, measure: Measure): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\n+/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = "";
      if (measure(word) <= maxWidth) {
        line = word;
        continue;
      }
      for (const ch of word) {
        if (measure(line + ch) > maxWidth && line) {
          lines.push(line);
          line = "";
        }
        line += ch;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

export interface Fit { size: number; lines: string[]; truncated: boolean }

// Largest font size whose wrapped text fits the box; below the minimum, cut the text with an ellipsis
export function fitText(
  text: string,
  box: { width: number; height: number },
  measureAt: (text: string, size: number) => number,
  { max, min, lineHeight }: { max: number; min: number; lineHeight: number },
): Fit {
  for (let size = max; size >= min; size -= 2) {
    const lines = wrapText(text, box.width, (t) => measureAt(t, size));
    if (lines.length * size * lineHeight <= box.height) return { size, lines, truncated: false };
  }
  const maxLines = Math.max(1, Math.floor(box.height / (min * lineHeight)));
  const lines = wrapText(text, box.width, (t) => measureAt(t, min)).slice(0, maxLines);
  let last = lines[maxLines - 1] ?? "";
  while (last && measureAt(`${last}…`, min) > box.width) last = last.slice(0, -1).trimEnd();
  lines[lines.length - 1] = `${last}…`;
  return { size: min, lines, truncated: true };
}

let logo: Promise<HTMLImageElement> | undefined;
function loadLogo() {
  return (logo ??= new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = "/lumaread-ico.jpeg";
  }));
}

export async function renderCard(input: CardInput): Promise<HTMLCanvasElement> {
  const [W, H] = SIZES[input.format];
  const theme = CARD_THEMES[input.theme];
  // Canvas won't wait for web fonts; make sure the serif is ready before measuring
  await Promise.all([document.fonts.load(`500 64px ${SERIF}`), document.fonts.load(`italic 500 64px ${SERIF}`)]).catch(() => undefined);
  const img = await loadLogo().catch(() => undefined);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const pad = 96;

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, theme.bg[0]);
  bg.addColorStop(1, theme.bg[1]);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Watermark: small, centred and faint so the quote stays the focus
  const footerH = 96;
  const footerY = H - pad - footerH / 2;
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.font = `600 28px ${SANS}`;
  const word = "LumaRead";
  const markSize = 36;
  const gap = 12;
  const width = (img ? markSize + gap : 0) + ctx.measureText(word).width;
  const x = (W - width) / 2;
  if (img) {
    ctx.beginPath();
    ctx.arc(x + markSize / 2, footerY, markSize / 2, 0, Math.PI * 2);
    ctx.save();
    ctx.clip();
    ctx.drawImage(img, x, footerY - markSize / 2, markSize, markSize);
    ctx.restore();
  }
  ctx.fillStyle = theme.sub;
  ctx.textBaseline = "middle";
  ctx.fillText(word, x + (img ? markSize + gap : 0), footerY);
  ctx.restore();

  // Attribution, bottom-aligned above the footer
  ctx.textBaseline = "alphabetic";
  const titleFont = `600 40px ${SANS}`;
  ctx.font = titleFont;
  const titleLines = wrapText(`— ${input.title}`, W - pad * 2, (t) => ctx.measureText(t).width).slice(0, 2);
  const meta = [input.author, input.location].filter(Boolean).join(" · ");
  let y = H - pad - footerH - 48 - (meta ? 48 : 0) - (titleLines.length - 1) * 52;
  const attributionTop = y - 40;
  ctx.fillStyle = theme.text;
  for (const line of titleLines) {
    ctx.fillText(line, pad, y);
    y += 52;
  }
  if (meta) {
    ctx.font = `400 34px ${SANS}`;
    ctx.fillStyle = theme.sub;
    ctx.fillText(meta, pad, y, W - pad * 2);
  }

  // Quote mark and quote, vertically centred in the space left
  const top = pad + (input.format === "story" ? 160 : 40);
  ctx.fillStyle = theme.mark;
  ctx.font = `700 ${input.format === "story" ? 260 : 200}px ${SERIF}`;
  ctx.fillText("“", pad - 12, top + (input.format === "story" ? 120 : 90));

  const box = { width: W - pad * 2, height: attributionTop - 64 - (top + 140) };
  const lineHeight = 1.4;
  const fit = fitText(input.quote.replace(/\s+/g, " ").trim(), box, (t, size) => {
    ctx.font = `500 ${size}px ${SERIF}`;
    return ctx.measureText(t).width;
  }, { max: input.format === "story" ? 76 : 60, min: 34, lineHeight });

  const blockH = fit.lines.length * fit.size * lineHeight;
  let ly = top + 140 + (box.height - blockH) / 2 + fit.size;
  ctx.font = `500 ${fit.size}px ${SERIF}`;
  ctx.fillStyle = theme.text;
  for (const line of fit.lines) {
    ctx.fillText(line, pad, ly);
    ly += fit.size * lineHeight;
  }
  return canvas;
}

export const toPngBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode image"))), "image/png"));
