import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

// Reads a stream chunk by chunk; standard ReadableStream async iteration, for engines that lack it
export async function* iterateStream<T>(stream: ReadableStream<T>): AsyncGenerator<T> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

// WebKit (the macOS app's webview) can't `for await` a ReadableStream, which pdf.js's getTextContent does;
// without this, text extraction throws there, so search and scanned-PDF detection (and with it OCR) never run
if (!(Symbol.asyncIterator in ReadableStream.prototype)) {
  Object.defineProperty(ReadableStream.prototype, Symbol.asyncIterator, {
    configurable: true,
    writable: true,
    value(this: ReadableStream) {
      return iterateStream(this);
    },
  });
}

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
// pdf_viewer.mjs reads the core library from this global instead of importing it
(globalThis as { pdfjsLib?: typeof pdfjsLib }).pdfjsLib = pdfjsLib;

export { pdfjsLib };

// Served by the vendor-assets plugin in vite.config.ts
const asset = (folder: string) => new URL(`/vendor/pdfjs/${folder}/`, location.href).href;

// pdf.js detaches the buffer it is given, so hand it a copy
export const openPdf = (buf: ArrayBuffer) =>
  pdfjsLib.getDocument({
    data: new Uint8Array(buf.slice(0)),
    wasmUrl: asset("wasm"),
    cMapUrl: asset("cmaps"),
    cMapPacked: true,
    standardFontDataUrl: asset("standard_fonts"),
    iccUrl: asset("iccs"),
  });
