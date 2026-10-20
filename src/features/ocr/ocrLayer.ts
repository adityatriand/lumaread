import type { OcrWord } from "../../lib/db";
import { pageOverlay } from "../reader/pageOverlay";

let measure: CanvasRenderingContext2D | undefined;

// Invisible, selectable words laid over a scanned page image, like pdf.js's own text layer.
// Rebuilt per render because font sizes are in pixels at the current zoom.
export function paintOcrLayer(pageDiv: HTMLElement, words: OcrWord[]) {
  const layer = pageOverlay(pageDiv, "ocrLayer");
  if (!layer) return;
  const { offsetWidth: width, offsetHeight: height } = layer;
  measure ??= document.createElement("canvas").getContext("2d")!;

  words.forEach((w, i) => {
    const endOfLine = words[i + 1]?.line !== w.line;
    const span = document.createElement("span");
    // Trailing space keeps words (and lines) apart in both copied selections and the layer's textContent
    span.textContent = `${w.text} `;
    const fontPx = w.box.h * height;
    measure!.font = `${fontPx}px sans-serif`;
    const natural = measure!.measureText(span.textContent).width || 1;
    const nextGap = endOfLine ? 0 : (words[i + 1].box.x - w.box.x - w.box.w) * width;
    Object.assign(span.style, {
      left: `${w.box.x * 100}%`,
      top: `${w.box.y * 100}%`,
      fontSize: `${fontPx}px`,
      transform: `scaleX(${(w.box.w * width + Math.max(0, nextGap)) / natural})`,
    });
    layer.appendChild(span);
    if (endOfLine) layer.appendChild(document.createElement("br"));
  });
}
