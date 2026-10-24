import serifFont from "@fontsource-variable/source-serif-4/files/source-serif-4-latin-wght-normal.woff2?url";
import ePub, { EpubCFI, type Contents, type NavItem, type Rendition } from "epubjs";
import { useEffect, useRef, useState } from "react";
import { epubAnchor, epubTarget, quoteIn } from "../../lib/anchor";
import { patchDoc, type HighlightColor } from "../../lib/db";
import { LINE_HEIGHTS, THEMES, effectiveLayout, type Layout, type ReadingPrefs } from "../settings/prefs";
import { Select } from "../../components/Select";
import { resolveHref } from "./epubHref";
import { ReaderChrome } from "./ReaderChrome";
import type { ReaderProps } from "./types";

// Book pages render in an iframe, so the app's bundled font has to be declared inside it
const FONT_FACE = `@font-face{font-family:"Source Serif 4 Variable";font-weight:200 900;src:url(${new URL(serifFont, location.href)}) format("woff2")}`;

const HL_FILL: Record<HighlightColor, string> = { yellow: "#facc15", green: "#4ade80", blue: "#60a5fa", pink: "#f472b6" };

// epub.js has no in-place switch between scrolled and paginated, so each layout gets its own rendition
const RENDITION: Record<Layout, object> = {
  continuous: { flow: "scrolled", manager: "continuous" },
  spread: { flow: "paginated", spread: "always", minSpreadWidth: 0 },
  // The continuous manager is the one epub.js gives swipe snapping: one page per swipe instead of free scrolling
  horizontal: { flow: "paginated", spread: "none", manager: "continuous", snap: true },
};

const PAGE_CHARS = 1600; // about one printed paperback page

// EPUB content is untrusted: no script of the book's may run, whatever the frame's sandbox allows
const BOOK_CSP = `<meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'; base-uri 'none'" />`;

// Our own per-chapter style tag rather than themes.register/select: epub.js never removes a theme's injected
// stylesheet, so switching back to an earlier page colour left the later one winning. !important beats book CSS.
const pageCss = (p: ReadingPrefs) =>
  `html, body { background: ${THEMES[p.theme].background} !important; color: ${THEMES[p.theme].color} !important; }`;

function paintPage(doc: Document, p: ReadingPrefs) {
  let style = doc.getElementById("lumaread-page");
  if (!style) {
    style = doc.createElement("style");
    style.id = "lumaread-page";
    doc.head.appendChild(style);
  }
  style.textContent = pageCss(p);
}

function applyPrefs(rendition: Rendition, p: ReadingPrefs) {
  for (const c of rendition.getContents() as unknown as Contents[]) paintPage(c.document, p);
  rendition.themes.fontSize(`${p.fontSize}%`);
  rendition.themes.font(`"Source Serif 4 Variable", "Noto Serif", serif`);
  rendition.themes.override("line-height", String(LINE_HEIGHTS[p.lineSpacing]), true);
}

// DOM position of a character offset in a chapter's text (the texts store holds body.textContent)
function pointAt(doc: Document, offset: number): { node: Node; offset: number } | undefined {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let rest = offset;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const len = n.textContent!.length;
    if (rest <= len) return { node: n, offset: rest };
    rest -= len;
  }
  return undefined;
}

export function EpubReader({ doc, bytes, initial, goTo, prefs, annotations, tools, speechRef, onPrefsChange, onLocation, onSelect, onAnnotationClick, onClose }: ReaderProps) {
  const viewRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<Rendition>(null);
  const drawnRef = useRef(new Map<string, string>()); // annotation id → cfiRange|color currently drawn
  const clickRef = useRef(onAnnotationClick);
  const layout = effectiveLayout(prefs.layout);
  const prefsRef = useRef(prefs); // chapters loaded later read the current colours
  prefsRef.current = prefs;
  const lastCfi = useRef<string>(undefined); // where to reopen after a layout switch
  const [renditionId, setRenditionId] = useState(0);
  const [toc, setToc] = useState<NavItem[]>([]);
  const [label, setLabel] = useState("Loading…");
  const labelRef = useRef("");
  const [error, setError] = useState<string>();

  clickRef.current = onAnnotationClick;

  useEffect(() => {
    const book = ePub(bytes.slice(0));
    // Registered once the book is open so it runs after epub.js's own resource rewrite (which replaces the output)
    book.opened.then(() =>
      book.spine.hooks.serialize.register((_: string, section: { output: string }) => {
        section.output = section.output.replace(/<head([^>]*)>/i, `<head$1>${BOOK_CSP}`);
      }),
    );
    const spineHrefs = () => {
      const hrefs: string[] = [];
      book.spine.each((s: { href: string }) => hrefs.push(s.href));
      return hrefs;
    };
    const chapterNames = new Map<string, string>(); // spine href → TOC label
    // allowScriptedContent only lifts the sandbox flag: WebKit (macOS app) runs no event listeners in a frame without
    // it, so selection, links and keys were dead there. The book's own scripts stay blocked by BOOK_CSP and the app CSP.
    const rendition = book.renderTo(viewRef.current!, { width: "100%", height: "100%", ...RENDITION[layout], allowScriptedContent: true });
    renditionRef.current = rendition;
    // Every navigation (chapter picker, links inside the book, reopening) goes through display()
    const display = rendition.display.bind(rendition) as (target?: string | number) => Promise<void>;
    rendition.display = ((target?: string | number) =>
      display(typeof target === "string" ? resolveHref(target, spineHrefs()) : target)) as typeof rendition.display;
    setRenditionId((n) => n + 1);
    drawnRef.current.clear();
    rendition.hooks.content.register((contents: Contents) => {
      const style = contents.document.createElement("style");
      style.textContent = FONT_FACE;
      contents.document.head.appendChild(style);
      paintPage(contents.document, prefsRef.current);
      // Our own selection detection: epub.js's "selected" event never fires in WebKit (the macOS app's webview)
      let settle: ReturnType<typeof setTimeout>;
      const check = () => {
        clearTimeout(settle);
        settle = setTimeout(() => reportSelection(contents), 250); // let drag handles and double-clicks settle
      };
      for (const type of ["selectionchange", "mouseup", "touchend", "keyup"]) contents.document.addEventListener(type, check);
      // Taps inside the chapter iframe don't reach the reader; replay plain ones on the host so the bars toggle
      contents.document.addEventListener("click", (e) => {
        if (!(e.target as Element).closest?.("a") && contents.window.getSelection()?.isCollapsed !== false) viewRef.current?.click();
      });
    });
    applyPrefs(rendition, prefs);

    // Reflowable text has no fixed pages; epub.js "locations" cut the book every PAGE_CHARS characters, giving page
    // numbers that stay the same across window sizes, fonts and devices. Computed once per book, then stored.
    let pagesReady = false;
    // locationFromCfi returns the index after the matching break, i.e. already 1-based; clamp the book's ends
    const pageOf = (cfi: string) => {
      if (!pagesReady) return undefined;
      const total = book.locations.length();
      return { n: Math.min(Math.max(book.locations.locationFromCfi(cfi) as unknown as number, 1), total), total };
    };

    function report(loc: { cfi: string; href: string; index: number }) {
      const chapter = chapterNames.get(loc.href) || `Section ${loc.index + 1}`;
      const page = pageOf(loc.cfi);
      const text = page ? `${chapter} · Page ${page.n} / ${page.total}` : chapter;
      setLabel(text);
      lastCfi.current = loc.cfi;
      labelRef.current = chapter;
      // Until pages are counted, progress falls back to the chapter position
      const percent = page ? book.locations.percentageFromCfi(loc.cfi) : (loc.index + 1) / (book.spine.last().index + 1);
      onLocation(epubAnchor(loc.cfi), percent, text);
    }
    rendition.on("relocated", (loc: { start: { cfi: string; href: string; index: number } }) => report(loc.start));

    book.ready.then(async () => {
      if (doc.epubLocations) book.locations.load(doc.epubLocations);
      else {
        await book.locations.generate(PAGE_CHARS);
        patchDoc(doc.id, { epubLocations: book.locations.save() }).catch(() => undefined);
      }
      if (renditionRef.current !== rendition) return; // reader closed or rebuilt meanwhile
      pagesReady = true;
      const start = rendition.location?.start;
      if (start) report(start);
    });

    function reportSelection(contents: Contents) {
      const sel = contents.window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount || !sel.toString().trim()) return onSelect(null);
      const range = sel.getRangeAt(0);
      const frame = (contents.window.frameElement as HTMLElement).getBoundingClientRect();
      const r = range.getBoundingClientRect();
      onSelect({
        anchor: { v: 1, kind: "epub", cfiRange: contents.cfiFromRange(range), quote: quoteIn(contents.document.body.textContent ?? "", sel.toString()) },
        label: labelRef.current,
        rect: new DOMRect(r.left + frame.left, r.top + frame.top, r.width, r.height),
        clear: () => sel.removeAllRanges(),
      });
    }

    // Arrow keys inside the book iframe don't reach window listeners
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") rendition.prev();
      if (e.key === "ArrowRight") rendition.next();
    };
    rendition.on("keyup", onKey);
    window.addEventListener("keyup", onKey);

    book.loaded.navigation.then((nav) => {
      const hrefs = spineHrefs();
      const flat: NavItem[] = [];
      const walk = (items: NavItem[]) => items.forEach((i) => (flat.push(i), walk(i.subitems ?? [])));
      walk(nav.toc);
      for (const item of flat) {
        const path = resolveHref(item.href, hrefs).split("#")[0];
        if (!chapterNames.has(path)) chapterNames.set(path, item.label.trim());
      }
      setToc(nav.toc);
      // The first location usually arrives before the TOC; name it now rather than on the next page turn
      const current = rendition.location?.start;
      if (current) report(current);
    });
    // epub.js appends the next chapter only on scroll, so a short first section (a cover) leaves nothing to scroll;
    // keep asking it to fill until the content overflows the screen (check() is the continuous manager's own step)
    const fillScreen = () => {
      const scroller = viewRef.current?.querySelector<HTMLElement>(".epub-container");
      const manager = (rendition as unknown as { manager?: { check?: () => unknown } }).manager;
      if (layout === "continuous" && scroller && scroller.scrollHeight <= scroller.clientHeight + 1) manager?.check?.();
    };
    rendition.on("rendered", () => setTimeout(fillScreen, 50)); // after the new chapter has measured its height

    rendition
      .display(lastCfi.current ?? epubTarget(initial))
      .then(fillScreen, () => setError("This EPUB could not be displayed."));

    return () => {
      window.removeEventListener("keyup", onKey);
      renditionRef.current = null;
      book.destroy();
    };
    // Rebuild only for a different document or layout
  }, [doc.id, layout]);

  useEffect(() => {
    if (renditionRef.current) applyPrefs(renditionRef.current, prefs);
  }, [prefs]);

  const spokenCfi = useRef<string>(undefined); // read-aloud mark currently drawn

  useEffect(() => {
    if (!speechRef) return;
    type Loc = { start: { index: number; cfi: string }; end: { cfi: string } };
    const location = () => {
      const loc = renditionRef.current?.currentLocation() as unknown as Loc | undefined;
      return loc?.start ? loc : undefined; // {} until the first page is shown
    };
    const contentsOf = (index: number) =>
      (renditionRef.current?.getContents() as unknown as (Contents & { sectionIndex: number })[] | undefined)?.find((c) => c.sectionIndex === index);
    speechRef.current = {
      position() {
        const loc = location();
        if (!loc) return undefined;
        const contents = contentsOf(loc.start.index);
        try {
          // Offset of the first visible character within the chapter's text (what the texts store holds)
          const at = (contents as unknown as { range: (cfi: string) => Range }).range(loc.start.cfi);
          const before = contents!.document.createRange();
          before.setStart(contents!.document.body, 0);
          before.setEnd(at.startContainer, at.startOffset);
          return { unit: loc.start.index, offset: before.toString().length };
        } catch {
          return { unit: loc.start.index, offset: 0 };
        }
      },
      show(unit, offset) {
        const rendition = renditionRef.current;
        const loc = location();
        if (!rendition || !loc) return;
        const contents = contentsOf(unit);
        if (!contents) return void rendition.display(unit);
        // Text offset → the DOM text node holding it → a CFI epub.js can display
        const at = pointAt(contents.document, offset);
        if (!at) return;
        const range = contents.document.createRange();
        range.setStart(at.node, at.offset);
        const cfi = contents.cfiFromRange(range);
        const compare = new EpubCFI();
        if (compare.compare(cfi, loc.start.cfi) < 0 || compare.compare(cfi, loc.end.cfi) > 0) rendition.display(cfi);
      },
      mark(spoken) {
        const rendition = renditionRef.current;
        if (!rendition) return;
        if (spokenCfi.current) rendition.annotations.remove(spokenCfi.current, "highlight");
        spokenCfi.current = undefined;
        const contents = spoken && contentsOf(spoken.unit);
        const start = contents && pointAt(contents.document, spoken!.chunk.start);
        const end = contents && pointAt(contents.document, spoken!.chunk.end);
        if (!contents || !start || !end) return;
        const range = contents.document.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        spokenCfi.current = contents.cfiFromRange(range);
        rendition.annotations.highlight(spokenCfi.current, {}, () => undefined, "speak-mark", {
          fill: "#5b5bd6",
          "fill-opacity": prefsRef.current.theme === "dark" ? "0.4" : "0.22",
          "mix-blend-mode": prefsRef.current.theme === "dark" ? "screen" : "multiply", // multiply vanishes on a dark page
        });
      },
    };
    return () => void (speechRef.current = null);
  }, [speechRef]);

  useEffect(() => {
    const target = epubTarget(goTo?.anchor);
    if (target) renditionRef.current?.display(target);
  }, [goTo]);

  // Diff drawn highlights against the list: epub.js keeps them per rendition and re-applies on page turns
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    const drawn = drawnRef.current;
    const wanted = new Map(
      annotations.flatMap((a) => (a.anchor?.kind === "epub" ? [[a.id, `${a.anchor.cfiRange}|${a.color}`] as const] : [])),
    );
    for (const [id, key] of drawn) {
      if (wanted.get(id) === key) continue;
      rendition.annotations.remove(key.split("|")[0], "highlight");
      drawn.delete(id);
    }
    for (const [id, key] of wanted) {
      if (drawn.has(id)) continue;
      const [cfiRange, color] = key.split("|") as [string, HighlightColor];
      rendition.annotations.highlight(cfiRange, { id }, () => clickRef.current(id), "hl", { fill: HL_FILL[color], "fill-opacity": "0.35", "mix-blend-mode": "multiply" });
      drawn.set(id, key);
    }
    // A new rendition (layout switch) starts with no highlights drawn
  }, [annotations, renditionId]);

  return (
    <ReaderChrome
      title={doc.title}
      location={label}
      onClose={onClose}
      onPrev={() => renditionRef.current?.prev()}
      onNext={() => renditionRef.current?.next()}
      theme={prefs.theme}
      prefs={{ value: prefs, onChange: onPrefsChange }}
      tools={
        <>
          {tools}
          {toc.length > 0 && (
            <Select
              label="Chapter"
              value=""
              placeholder="Chapters"
              options={toc.map((item) => ({ value: item.href, label: item.label.trim() }))}
              onChange={(href) => renditionRef.current?.display(href)}
            />
          )}
        </>
      }
    >
      {error && <p className="alert" role="alert">{error}</p>}
      <div ref={viewRef} className="book-view" />
    </ReaderChrome>
  );
}
