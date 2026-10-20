import { useEffect, useRef, useState, type MouseEvent } from "react";
import "pdfjs-dist/web/pdf_viewer.css";
import { pdfAnchor, pdfPage, quoteIn, type RangeAnchor } from "../../lib/anchor";
import type { Annotation } from "../../lib/db";
import { openPdf } from "../../lib/pdf";
import { containsPoint, mergeRects, normalizeRects } from "../../lib/rects";
import { paintOcrLayer } from "../ocr/ocrLayer";
import { useOcr, type OcrStatus } from "../ocr/useOcr";
import { pageOverlay } from "./pageOverlay";
import { ReaderChrome } from "./ReaderChrome";
import type { ReaderProps } from "./types";

type Viewer = import("pdfjs-dist/web/pdf_viewer.mjs").PDFViewer;

const ZOOMS = [
  ["page-width", "Fit width"],
  ["page-fit", "Fit page"],
  ["0.5", "50%"],
  ["0.75", "75%"],
  ["1", "100%"],
  ["1.25", "125%"],
  ["1.5", "150%"],
  ["2", "200%"],
];

type PdfAnnotation = Annotation & { anchor: Extract<RangeAnchor, { kind: "pdf" }> };
const onPage = (list: Annotation[], page: number) =>
  list.filter((a): a is PdfAnnotation => a.anchor?.kind === "pdf" && a.anchor.page === page);

const pageBox = (pageEl: Element) => (pageEl.querySelector(".canvasWrapper") ?? pageEl).getBoundingClientRect();

function paintHighlights(viewer: Viewer, page: number, annotations: Annotation[]) {
  const div = viewer.getPageView(page - 1)?.div;
  const layer = div?.querySelector(".canvasWrapper canvas") && pageOverlay(div, "hl-layer");
  if (!layer) return;
  for (const a of onPage(annotations, page)) {
    for (const r of a.anchor.rects) {
      const el = document.createElement("div");
      el.className = `hl hl-${a.color}`;
      Object.assign(el.style, { left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` });
      layer.appendChild(el);
    }
  }
}

export function PdfReader({ doc, bytes, initial, annotations, tools, onLocation, onSelect, onAnnotationClick, onClose }: ReaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer>(null);
  const annotationsRef = useRef(annotations);
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(0);
  const [zoom, setZoom] = useState("page-width");
  const [error, setError] = useState<string>();

  annotationsRef.current = annotations;

  const ocr = useOcr(doc.id, !!doc.scanned, (page, words) => {
    const div = viewerRef.current?.getPageView(page - 1)?.div;
    if (div?.querySelector(".canvasWrapper canvas")) paintOcrLayer(div, words);
  });
  const ocrRef = useRef(ocr);
  ocrRef.current = ocr;

  useEffect(() => {
    let cancelled = false;
    const task = openPdf(bytes);

    (async () => {
      // Dynamic so it evaluates after lib/pdf has set globalThis.pdfjsLib
      const { PDFViewer, EventBus, PDFLinkService } = await import("pdfjs-dist/web/pdf_viewer.mjs");
      const pdf = await task.promise;
      if (cancelled) return;

      const eventBus = new EventBus();
      const linkService = new PDFLinkService({ eventBus });
      const viewer = new PDFViewer({ container: containerRef.current!, eventBus, linkService });
      linkService.setViewer(viewer);
      eventBus.on("pagesinit", () => {
        viewer.currentScaleValue = "page-width";
        viewer.currentPageNumber = pdfPage(initial) ?? 1;
        // pagechanging doesn't fire when the start page is already page 1
        setPage(viewer.currentPageNumber);
        ocrRef.current.want(viewer.currentPageNumber, viewer.currentPageNumber + 1);
      });
      eventBus.on("pagechanging", ({ pageNumber }: { pageNumber: number }) => {
        setPage(pageNumber);
        ocrRef.current.want(pageNumber, pageNumber + 1);
        onLocation(pdfAnchor(pageNumber), pageNumber / pdf.numPages, `Page ${pageNumber} / ${pdf.numPages}`);
      });
      // pdf.js rebuilds page DOM on render and zoom, so highlights are repainted each time
      eventBus.on("pagerendered", ({ pageNumber, source }: { pageNumber: number; source: { div: HTMLElement } }) => {
        paintHighlights(viewer, pageNumber, annotationsRef.current);
        const words = ocrRef.current.words(pageNumber);
        if (words) paintOcrLayer(source.div, words);
      });
      viewer.setDocument(pdf);
      linkService.setDocument(pdf);
      viewerRef.current = viewer;
      setPages(pdf.numPages);
      ocrRef.current.attach(pdf);
    })().catch(() => !cancelled && setError("This PDF could not be displayed."));

    return () => {
      cancelled = true;
      viewerRef.current = null;
      task.destroy();
    };
    // Reload only when a different document is opened
  }, [doc.id]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    for (let n = 1; n <= viewer.pagesCount; n++) paintHighlights(viewer, n, annotations);
  }, [annotations]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const onChange = () => {
      clearTimeout(timer);
      // Wait for the selection to settle (drag handles on touch fire many events)
      timer = setTimeout(() => {
        const sel = document.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount) return onSelect(null);
        const range = sel.getRangeAt(0);
        const pageEl = (range.startContainer.parentElement ?? null)?.closest(".page");
        if (!pageEl || !containerRef.current?.contains(pageEl)) return onSelect(null);
        const box = pageBox(pageEl);
        const rects = mergeRects(normalizeRects([...range.getClientRects()], box));
        // On scanned pages the recognised words are the real text; pdf.js's layer holds only stray marks
        const textLayer = pageEl.querySelector(".ocrLayer") ?? pageEl.querySelector(".textLayer");
        if (!rects.length || !textLayer) return onSelect(null);
        const page = Number((pageEl as HTMLElement).dataset.pageNumber);
        onSelect({
          anchor: { v: 1, kind: "pdf", page, rects, quote: quoteIn(textLayer.textContent ?? "", sel.toString()) },
          label: `p. ${page}`,
          rect: range.getBoundingClientRect(),
          clear: () => sel.removeAllRanges(),
        });
      }, 250);
    };
    document.addEventListener("selectionchange", onChange);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", onChange);
    };
  }, [onSelect]);

  function handleClick(e: MouseEvent) {
    if (!document.getSelection()?.isCollapsed) return;
    const pageEl = (e.target as Element).closest(".page");
    if (!pageEl) return;
    const box = pageBox(pageEl);
    const x = (e.clientX - box.left) / box.width;
    const y = (e.clientY - box.top) / box.height;
    const hit = onPage(annotations, Number((pageEl as HTMLElement).dataset.pageNumber)).find((a) => a.anchor.rects.some((r) => containsPoint(r, x, y)));
    if (hit) onAnnotationClick(hit.id);
  }

  const go = (n: number) => viewerRef.current && (viewerRef.current.currentPageNumber = Math.min(Math.max(n, 1), pages));

  return (
    <ReaderChrome
      title={doc.title}
      location={pages ? `Page ${page} / ${pages}` : "Loading…"}
      onClose={onClose}
      onPrev={() => go(page - 1)}
      onNext={() => go(page + 1)}
      canPrev={page > 1}
      canNext={page < pages}
      tools={
        <>
          {tools}
          {doc.scanned && <OcrChip status={ocr.status} onRecognizeAll={ocr.recognizeAll} />}
          <select
            aria-label="Zoom"
            value={zoom}
            onChange={(e) => {
              setZoom(e.target.value);
              if (viewerRef.current) viewerRef.current.currentScaleValue = e.target.value;
            }}
          >
            {ZOOMS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </>
      }
    >
      {error ? (
        <p className="alert" role="alert">{error}</p>
      ) : (
        <div ref={containerRef} className="pdf-container" tabIndex={0} onClick={handleClick}>
          <div className="pdfViewer" />
        </div>
      )}
    </ReaderChrome>
  );
}

function OcrChip({ status, onRecognizeAll }: { status: OcrStatus; onRecognizeAll: () => void }) {
  const { recognized, total, busyPage, wholeBook, failed } = status;
  if (total && recognized >= total) return <span className="chip" title="Every page has selectable, searchable text">Text recognized</span>;
  if (wholeBook) return <span className="chip busy" role="status">Recognizing {recognized}/{total}…</span>;
  return (
    <button
      className="chip"
      onClick={onRecognizeAll}
      title="This PDF is scanned. Pages you read are recognized automatically; this does the whole book so it can be searched."
    >
      {failed ? "Recognition failed · Retry" : busyPage ? `Recognizing p. ${busyPage}…` : `Recognize all pages (${recognized}/${total})`}
    </button>
  );
}
