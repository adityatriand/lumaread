import type { Rect } from "./anchor";

interface Box { left: number; top: number; width: number; height: number }

// Client rects → fractions of the page box, dropping slivers and anything outside the page
export function normalizeRects(rects: Box[], page: Box): Rect[] {
  return rects
    .filter((r) => r.width > 1 && r.height > 1)
    .map((r) => ({ x: (r.left - page.left) / page.width, y: (r.top - page.top) / page.height, w: r.width / page.width, h: r.height / page.height }))
    .filter((r) => r.x + r.w > 0 && r.y + r.h > 0 && r.x < 1 && r.y < 1);
}

// Text layers emit one rect per span; merge spans on the same line so highlights don't double up
export function mergeRects(rects: Rect[]): Rect[] {
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const out: Rect[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    const sameLine = last && Math.abs(last.y + last.h / 2 - (r.y + r.h / 2)) < Math.min(last.h, r.h) / 2;
    if (sameLine && r.x <= last.x + last.w + r.h) {
      const right = Math.max(last.x + last.w, r.x + r.w);
      const top = Math.min(last.y, r.y);
      last.h = Math.max(last.y + last.h, r.y + r.h) - top;
      last.y = top;
      last.w = right - last.x;
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

export const containsPoint = (r: Rect, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
