import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import "pdfjs-dist/web/pdf_viewer.css";
import { pdfAnchor, pdfPage, quoteIn, type RangeAnchor } from "../../lib/anchor";
import type { Annotation } from "../../lib/db";
import { openPdf } from "../../lib/pdf";
import { containsPoint, mergeRects, normalizeRects } from "../../lib/rects";
import { paintOcrLayer } from "../ocr/ocrLayer";
import { useOcr, type OcrStatus } from "../ocr/useOcr";
import { Select } from "../../components/Select";
import { effectiveLayout, type Layout } from "../settings/prefs";
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

type ViewerModule = typeof import("pdfjs-dist/web/pdf_viewer.mjs");

// Side by side uses "even" spreads: page 1 (the cover) alone, then 2|3, 4|5 like a printed book
function applyLayout(viewer: Viewer, { ScrollMode, SpreadMode }: ViewerModule, layout: Layout) {
  viewer.scrollMode = layout === "spread" ? ScrollMode.PAGE : layout === "horizontal" ? ScrollMode.HORIZONTAL : ScrollMode.VERTICAL;
  viewer.spreadMode = layout === "spread" ? SpreadMode.EVEN : SpreadMode.NONE;
  const fit = layout === "continuous" ? "page-width" : "page-fit";
  viewer.currentScaleValue = fit;
  return fit;
}

export function PdfReader({ doc, bytes, initial, prefs, annotations, tools, onPrefsChange, onLocation, onSelect, onAnnotationClick, onClose }: ReaderProps) {
  const layout = effectiveLayout(prefs.layout);
  const layoutRef = useRef(layout);
  const viewerModule = useRef<ViewerModule>(null);
  layoutRef.current = layout;
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
      const mod = await import("pdfjs-dist/web/pdf_viewer.mjs");
      const { PDFViewer, EventBus, PDFLinkService } = mod;
      viewerModule.current = mod;
      const pdf = await task.promise;
      if (cancelled) return;

      const eventBus = new EventBus();
      const linkService = new PDFLinkService({ eventBus });
      const viewer = new PDFViewer({ container: containerRef.current!, eventBus, linkService });
      linkService.setViewer(viewer);
      eventBus.on("pagesinit", () => {
        setZoom(applyLayout(viewer, mod, layoutRef.current));
        viewer.currentPageNumber = pdfPage(initial) ?? 1;
        // pagechanging doesn't fire when the start page is already page 1, so report it here
        setPage(viewer.currentPageNumber);
        onLocation(pdfAnchor(viewer.currentPageNumber), viewer.currentPageNumber / pdf.numPages, `Page ${viewer.currentPageNumber} / ${pdf.numPages}`);
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

  useEffect(() => {
    const viewer = viewerRef.current;
    if (viewer && viewerModule.current) setZoom(applyLayout(viewer, viewerModule.current, layout));
  }, [layout]);

  const zoomOptions = ZOOMS.map(([value, label]) => ({ value, label }));
  function changeZoom(value: string) {
    setZoom(value);
    if (viewerRef.current) viewerRef.current.currentScaleValue = value;
  }

  // nextPage/previousPage step a whole spread in side-by-side mode
  const next = () => viewerRef.current?.nextPage();
  const prev = () => viewerRef.current?.previousPage();
  function handleKey(e: KeyboardEvent) {
    if (e.key === "ArrowRight" || e.key === "PageDown") (e.preventDefault(), next());
    if (e.key === "ArrowLeft" || e.key === "PageUp") (e.preventDefault(), prev());
  }

  return (
    <ReaderChrome
      title={doc.title}
      location={pages ? `Page ${page} / ${pages}` : "Loading…"}
      onClose={onClose}
      onPrev={prev}
      onNext={next}
      theme={prefs.theme}
      prefs={{ value: prefs, onChange: onPrefsChange, format: "pdf" }}
      // Phones have no room for zoom in the header; it lives with the other reading options
      status={doc.scanned && <OcrStatusBar status={ocr.status} onRecognizeAll={ocr.recognizeAll} />}
      prefsExtra={<div className="phone-only"><Select label="Zoom" className="full" value={zoom} options={zoomOptions} onChange={changeZoom} /></div>}
      canPrev={page > 1}
      canNext={page < pages}
      tools={
        <>
          {tools}
          <Select label="Zoom" className="desktop-only" value={zoom} options={zoomOptions} onChange={changeZoom} />
        </>
      }
    >
      {error ? (
        <p className="alert" role="alert">{error}</p>
      ) : (
        <div ref={containerRef} className={`pdf-container layout-${layout}`} tabIndex={0} onClick={handleClick} onKeyDown={handleKey}>
          <div className="pdfViewer" />
        </div>
      )}
    </ReaderChrome>
  );
}

// Scanned books always show where text recognition stands, so a page that isn't selectable yet isn't a mystery
function OcrStatusBar({ status, onRecognizeAll }: { status: OcrStatus; onRecognizeAll: () => void }) {
  const { recognized, total, busyPage, wholeBook, failed } = status;
  const done = total > 0 && recognized >= total;
  const working = busyPage !== undefined;
  const text = failed
    ? "Text recognition failed on a page."
    : done
      ? "All pages recognized — the whole book is searchable."
      : working
        ? wholeBook
          ? `Recognizing all pages… ${recognized} of ${total}`
          : `Recognizing text on page ${busyPage}…`
        : `Scanned book · text recognized on ${recognized} of ${total} pages`;

  return (
    <div className={`ocr-status${working ? " working" : ""}`} role="status">
      {working && <span className="spinner" aria-hidden="true" />}
      <span className="ocr-text">{text}</span>
      {!done && !wholeBook && (
        <button className="link" onClick={onRecognizeAll}>{failed ? "Retry" : "Recognize all pages"}</button>
      )}
      {total > 0 && (
        <span className="ocr-progress" aria-hidden="true"><span style={{ width: `${(recognized / total) * 100}%` }} /></span>
      )}
    </div>
  );
}
