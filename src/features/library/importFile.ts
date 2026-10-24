import ePub from "epubjs";
import type { PDFPageProxy } from "pdfjs-dist";
import { addDoc, findByHash, type DocMeta, type Format } from "../../lib/db";
import { sha256Hex } from "../../lib/hash";
import { openPdf } from "../../lib/pdf";
import { cbzToEpub, textToEpub } from "./convert";
import { detectFormat } from "./detectFormat";
import { titleFromName } from "./titleFromName";

// shortcut: arbitrary cap until the PRD's max-file-size decision is made
const MAX_BYTES = 200 * 1024 * 1024;
const COVER_WIDTH = 160;

interface Extracted { title?: string; author?: string; cover?: string }

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
  const original = await file.arrayBuffer();
  const detected = detectFormat(new Uint8Array(original), file.name);
  if (!detected) throw new Error(`"${file.name}" is not a supported EPUB, PDF, CBZ, TXT or Markdown file.`);
  const fromName = titleFromName(file.name);

  // Comics and text become EPUBs here; the stored (and hashed) bytes are the EPUB
  const source = detected === "pdf" || detected === "epub" ? undefined : detected;
  const format: Format = detected === "pdf" ? "pdf" : "epub";
  let buf = original;
  if (source) {
    try {
      const epub = source === "cbz" ? await cbzToEpub(new Uint8Array(original), fromName.title, fromName.author) : textToEpub(new Uint8Array(original), source, fromName.title, fromName.author);
      buf = epub.slice().buffer;
    } catch {
      throw new Error(source === "cbz" ? `"${file.name}" has no comic pages (JPG, PNG, GIF or WebP) or is damaged.` : `"${file.name}" could not be read as text.`);
    }
  }

  const hash = await sha256Hex(buf);
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
  const doc: DocMeta = {
    id: crypto.randomUUID(),
    title: (format === "epub" && meta.title?.trim()) || fromName.title,
    author: meta.author?.trim() || fromName.author,
    fileName: file.name,
    format,
    source,
    size: buf.byteLength,
    hash,
    addedAt: Date.now(),
    cover: meta.cover,
  };
  await addDoc(doc, buf);
  return doc;
}
