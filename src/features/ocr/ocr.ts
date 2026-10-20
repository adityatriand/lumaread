import type { PDFPageProxy } from "pdfjs-dist";
import { createWorker, OEM, type Worker } from "tesseract.js";
import { saveOcrPage, saveTexts, type OcrPage, type OcrWord } from "../../lib/db";

const vendor = (p: string) => new URL(`/vendor/tesseract/${p}`, location.href).href;

// Long edge of the image handed to Tesseract: ~300 dpi for a paperback page, the accuracy sweet spot
const RENDER_PX = 2200;

let workerPromise: Promise<Worker> | undefined;

// One worker for the whole app; Indonesian first so its dictionary wins on ambiguous words
function worker() {
  return (workerPromise ??= createWorker(["ind", "eng"], OEM.LSTM_ONLY, {
    workerPath: vendor("worker.min.js"),
    corePath: vendor("core/tesseract-core-simd-lstm.wasm.js"),
    langPath: vendor("lang"),
    workerBlobURL: false,
    cacheMethod: "none", // language data is already bundled; don't copy it into IndexedDB
    gzip: true,
  }));
}

export interface OcrBox { x0: number; y0: number; x1: number; y1: number }
export interface OcrLine { words: { text: string; bbox: OcrBox }[] }

// Tesseract pixels → page fractions, keeping line membership for spacing and text order
export function toOcrWords(lines: OcrLine[], width: number, height: number): OcrWord[] {
  return lines.flatMap((l, line) =>
    l.words
      .filter((w) => w.text.trim())
      .map((w) => ({
        text: w.text,
        line,
        box: { x: w.bbox.x0 / width, y: w.bbox.y0 / height, w: (w.bbox.x1 - w.bbox.x0) / width, h: (w.bbox.y1 - w.bbox.y0) / height },
      })),
  );
}

export function ocrText(words: OcrWord[]): string {
  const lines: string[][] = [];
  for (const w of words) (lines[w.line] ??= []).push(w.text);
  return lines.filter(Boolean).map((l) => l.join(" ")).join("\n");
}

export async function recognizeCanvas(canvas: HTMLCanvasElement): Promise<OcrWord[]> {
  const { data } = await (await worker()).recognize(canvas, {}, { blocks: true });
  const lines = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines));
  return toOcrWords(lines, canvas.width, canvas.height);
}

export async function recognizePage(docId: string, page: PDFPageProxy): Promise<OcrPage> {
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: RENDER_PX / Math.max(base.width, base.height) });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  await page.render({ canvas, viewport }).promise;

  const result: OcrPage = { docId, page: page.pageNumber, words: await recognizeCanvas(canvas) };
  canvas.width = canvas.height = 0; // release the bitmap now, not at GC

  await saveOcrPage(result);
  // Replaces the page's (empty) extracted text so search finds recognised words
  await saveTexts([{ docId, unit: page.pageNumber, label: `Page ${page.pageNumber}`, text: ocrText(result.words), source: "ocr" }]);
  return result;
}
