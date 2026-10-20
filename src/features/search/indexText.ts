import ePub from "epubjs";
import { getFile, listDocs, patchDoc, saveTexts, type DocMeta, type DocText } from "../../lib/db";
import { openPdf, pdfjsLib } from "../../lib/pdf";

// Pages with less text than this are treated as images (watermarks and page numbers are short)
const SCANNED_PAGE_CHARS = 40;

export const isShortText = (text: string) => text.replace(/\s/g, "").length < SCANNED_PAGE_CHARS;

const IMAGE_OPS = new Set([pdfjsLib.OPS.paintImageXObject, pdfjsLib.OPS.paintInlineImageXObject, pdfjsLib.OPS.paintImageMaskXObject]);

// Checking a page for images decodes them (slow for scans), so only a sample of short pages is checked
const IMAGE_SAMPLE = 8;

async function pdfTexts(doc: DocMeta, bytes: ArrayBuffer): Promise<{ texts: DocText[]; scanned: boolean }> {
  const task = openPdf(bytes);
  try {
    const pdf = await task.promise;
    const texts: DocText[] = [];
    const short: number[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const { items } = await page.getTextContent();
      const text = items.map((i) => ("str" in i ? i.str + (i.hasEOL ? "\n" : " ") : "")).join("");
      texts.push({ docId: doc.id, unit: n, label: `Page ${n}`, text, source: "text" });
      if (isShortText(text)) short.push(n);
      page.cleanup();
    }
    if (short.length <= pdf.numPages / 2) return { texts, scanned: false };
    // Mostly text-less pages: a scan if they hold images, otherwise just blank/title pages
    const sample = short.filter((_, i) => i % Math.ceil(short.length / IMAGE_SAMPLE) === 0);
    let withImages = 0;
    for (const n of sample) {
      const page = await pdf.getPage(n);
      if ((await page.getOperatorList()).fnArray.some((op) => IMAGE_OPS.has(op))) withImages++;
      page.cleanup();
    }
    return { texts, scanned: withImages >= sample.length / 2 };
  } finally {
    await task.destroy();
  }
}

async function epubTexts(doc: DocMeta, bytes: ArrayBuffer): Promise<DocText[]> {
  const book = ePub(bytes.slice(0));
  try {
    await Promise.all([book.ready, book.opened]);
    const texts: DocText[] = [];
    const sections: { index: number; href: string; load: (r: unknown) => Promise<Document>; unload: () => void }[] = [];
    book.spine.each((s: (typeof sections)[number]) => sections.push(s));
    for (const s of sections) {
      const content = await s.load(book.load.bind(book));
      const label = book.navigation.get(s.href)?.label.trim() || `Section ${s.index + 1}`;
      texts.push({ docId: doc.id, unit: s.index, label, href: s.href, text: content.querySelector("body")?.textContent ?? "", source: "text" });
      s.unload();
    }
    return texts;
  } finally {
    book.destroy();
  }
}

export async function indexDoc(doc: DocMeta, bytes: ArrayBuffer) {
  const { texts, scanned } = doc.format === "pdf" ? await pdfTexts(doc, bytes) : { texts: await epubTexts(doc, bytes), scanned: false };
  await saveTexts(texts);
  await patchDoc(doc.id, { textIndexed: true, scanned, ...(doc.format === "pdf" && { pageCount: texts.length }) });
}

let running: Promise<void> | undefined;

// A PDF marked indexed without a scanned verdict failed under an older build (WebKit stream bug); retry it once
const unindexed = async () =>
  (await listDocs()).filter((d) => !d.textIndexed || (d.format === "pdf" && d.scanned === undefined && !d.indexFailed));

// Index anything imported before indexing existed, or interrupted mid-way; one pass at a time
export function indexPending(onDone: () => void) {
  running ??= (async () => {
    // Re-list until nothing is pending, so books imported mid-run are picked up too
    for (let pending = await unindexed(); pending.length; pending = await unindexed()) {
      const doc = pending[0];
      const bytes = await getFile(doc.id);
      // Mark a broken file as done so it isn't retried on every launch; it just won't appear in content search
      if (bytes) await indexDoc(doc, bytes).catch(() => patchDoc(doc.id, { textIndexed: true, indexFailed: true }));
      else await patchDoc(doc.id, { textIndexed: true, indexFailed: true });
    }
  })().finally(() => {
    running = undefined;
    onDone();
  });
  return running;
}
