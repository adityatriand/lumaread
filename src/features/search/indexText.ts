import ePub from "epubjs";
import { getFile, listDocs, patchDoc, saveTexts, type DocMeta, type DocText } from "../../lib/db";
import { openPdf, pdfjsLib } from "../../lib/pdf";

// Pages with less text than this are treated as images (watermarks and page numbers are short)
const SCANNED_PAGE_CHARS = 40;

export const isShortText = (text: string) => text.replace(/\s/g, "").length < SCANNED_PAGE_CHARS;

const IMAGE_OPS = new Set([pdfjsLib.OPS.paintImageXObject, pdfjsLib.OPS.paintInlineImageXObject, pdfjsLib.OPS.paintImageMaskXObject]);

async function pdfTexts(doc: DocMeta, bytes: ArrayBuffer): Promise<{ texts: DocText[]; scannedPages: number }> {
  const task = openPdf(bytes);
  try {
    const pdf = await task.promise;
    const texts: DocText[] = [];
    let scannedPages = 0;
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const { items } = await page.getTextContent();
      const text = items.map((i) => ("str" in i ? i.str + (i.hasEOL ? "\n" : " ") : "")).join("");
      texts.push({ docId: doc.id, unit: n, label: `Page ${n}`, text, source: "text" });
      // Only short pages pay for the operator scan: an image there means a scan, not a blank or title page
      if (isShortText(text) && (await page.getOperatorList()).fnArray.some((op) => IMAGE_OPS.has(op))) scannedPages++;
      page.cleanup();
    }
    return { texts, scannedPages };
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
  const { texts, scannedPages } = doc.format === "pdf" ? await pdfTexts(doc, bytes) : { texts: await epubTexts(doc, bytes), scannedPages: 0 };
  await saveTexts(texts);
  const scanned = scannedPages > texts.length / 2;
  await patchDoc(doc.id, { textIndexed: true, scanned });
}

let running: Promise<void> | undefined;

const unindexed = async () => (await listDocs()).filter((d) => !d.textIndexed);

// Index anything imported before indexing existed, or interrupted mid-way; one pass at a time
export function indexPending(onDone: () => void) {
  running ??= (async () => {
    // Re-list until nothing is pending, so books imported mid-run are picked up too
    for (let pending = await unindexed(); pending.length; pending = await unindexed()) {
      const doc = pending[0];
      const bytes = await getFile(doc.id);
      // Mark a broken file as done so it isn't retried on every launch; it just won't appear in content search
      if (bytes) await indexDoc(doc, bytes).catch(() => patchDoc(doc.id, { textIndexed: true }));
      else await patchDoc(doc.id, { textIndexed: true });
    }
  })().finally(() => {
    running = undefined;
    onDone();
  });
  return running;
}
