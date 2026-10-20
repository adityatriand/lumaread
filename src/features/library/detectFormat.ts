import type { Format } from "../../lib/db";

const ascii = (bytes: Uint8Array, from: number, len: number) =>
  String.fromCharCode(...bytes.subarray(from, from + len));

// Trust file contents, not extensions; EPUB name check covers files that break the OCF "mimetype first" rule
export function detectFormat(bytes: Uint8Array, name: string): Format | null {
  if (ascii(bytes, 0, 1024).includes("%PDF-")) return "pdf";
  if (ascii(bytes, 0, 4) === "PK\x03\x04") {
    const ocf = ascii(bytes, 30, 8) === "mimetype" && ascii(bytes, 38, 20) === "application/epub+zip";
    if (ocf || name.toLowerCase().endsWith(".epub")) return "epub";
  }
  return null;
}
