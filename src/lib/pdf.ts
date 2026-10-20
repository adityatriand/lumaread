import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

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
