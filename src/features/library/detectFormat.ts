import type { Format } from "../../lib/db";

const ascii = (bytes: Uint8Array, from: number, len: number) =>
  String.fromCharCode(...bytes.subarray(from, from + len));

// "%PDF-" as bytes, never as a string literal: Tauri sniffs "%PDF" in a script's first 1 KB and would serve the
// chunk holding this code as application/pdf (the minifier folds char-code tricks back into the literal)
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];

// PDF readers accept the header anywhere in the first 1024 bytes
function hasPdfHeader(bytes: Uint8Array) {
  const end = Math.min(bytes.length, 1024) - PDF_MAGIC.length;
  for (let i = 0; i <= end; i++) if (PDF_MAGIC.every((b, j) => bytes[i + j] === b)) return true;
  return false;
}

// Trust file contents, not extensions; EPUB name check covers files that break the OCF "mimetype first" rule
export function detectFormat(bytes: Uint8Array, name: string): Format | null {
  if (hasPdfHeader(bytes)) return "pdf";
  if (ascii(bytes, 0, 4) === "PK\x03\x04") {
    const ocf = ascii(bytes, 30, 8) === "mimetype" && ascii(bytes, 38, 20) === "application/epub+zip";
    if (ocf || name.toLowerCase().endsWith(".epub")) return "epub";
  }
  return null;
}
