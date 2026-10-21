import ePub from "epubjs";
import type { PDFPageProxy } from "pdfjs-dist";
import { addDoc, findByHash, type DocMeta, type Format } from "../../lib/db";
import { openPdf } from "../../lib/pdf";
import { detectFormat } from "./detectFormat";
import { titleFromName } from "./titleFromName";

// shortcut: arbitrary cap until the PRD's max-file-size decision is made
const MAX_BYTES = 200 * 1024 * 1024;
const COVER_WIDTH = 160;

interface Extracted { title?: string; author?: string; cover?: string }

async function sha256(buf: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function canvasOf(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = Math.round(height);
  return canvas;
}

async function epubCover(url: string | null) {
  if (!url) return undefined;
  const img = new Image();
  img.src = url;
  await img.decode();
  const canvas = canvasOf(COVER_WIDTH, (img.naturalHeight / img.naturalWidth) * COVER_WIDTH);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.8);
}

async function pdfCover(page: PDFPageProxy) {
  const viewport = page.getViewport({ scale: COVER_WIDTH / page.getViewport({ scale: 1 }).width });
  const canvas = canvasOf(COVER_WIDTH, viewport.height);
  await page.render({ canvas, viewport }).promise;
  return canvas.toDataURL("image/jpeg", 0.8);
}

async function extract(format: Format, buf: ArrayBuffer): Promise<Extracted> {
  if (format === "pdf") {
    const task = openPdf(buf);
    try {
      const pdf = await task.promise;
      const { info } = (await pdf.getMetadata()) as { info: { Title?: string; Author?: string } };
      const cover = await pdfCover(await pdf.getPage(1)).catch(() => undefined);
      return { title: info.Title, author: info.Author, cover };
    } finally {
      await task.destroy();
    }
  }
  const book = ePub(buf.slice(0));
  try {
    // Destroying before epub.js finishes loading throws inside the library
    await Promise.all([book.ready, book.opened]);
    const meta = await book.loaded.metadata;
    const cover = await epubCover(await book.coverUrl()).catch(() => undefined);
    return { title: meta.title, author: meta.creator, cover };
  } finally {
    book.destroy();
  }
}

export async function importFile(file: File): Promise<DocMeta> {
  if (file.size > MAX_BYTES) throw new Error(`"${file.name}" is larger than 200 MB.`);
  const buf = await file.arrayBuffer();
  const format = detectFormat(new Uint8Array(buf), file.name);
  if (!format) throw new Error(`"${file.name}" is not a supported EPUB or PDF file.`);

  const hash = await sha256(buf);
  const existing = await findByHash(hash);
  if (existing) throw new Error(`"${existing.title}" is already in your library.`);

  let meta: Extracted;
  try {
    meta = await extract(format, buf);
  } catch {
    throw new Error(`"${file.name}" could not be opened. It may be damaged or password-protected.`);
  }

  // PDFs: the filename is what the reader chose (embedded PDF titles are often junk like "Microsoft Word - x.docx");
  // EPUBs carry a publisher title. Either way an author in "Title - Author" fills a missing one.
  const fromName = titleFromName(file.name);
  const doc: DocMeta = {
    id: crypto.randomUUID(),
    title: (format === "epub" && meta.title?.trim()) || fromName.title,
    author: meta.author?.trim() || fromName.author,
    fileName: file.name,
    format,
    size: file.size,
    hash,
    addedAt: Date.now(),
    cover: meta.cover,
  };
  await addDoc(doc, buf);
  return doc;
}
