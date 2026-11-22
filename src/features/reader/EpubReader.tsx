import serifFont from "@fontsource-variable/source-serif-4/files/source-serif-4-latin-wght-normal.woff2?url";
import ePub, { EpubCFI, type Contents, type NavItem, type Rendition } from "epubjs";
import { useEffect, useRef, useState } from "react";
import { epubAnchor, epubTarget, quoteIn } from "../../lib/anchor";
import { patchDoc, type HighlightColor } from "../../lib/db";
import { LINE_HEIGHTS, THEMES, effectiveLayout, type Layout, type ReadingPrefs } from "../settings/prefs";
import { Select } from "../../components/Select";
import { resolveHref } from "./epubHref";
import { ReaderChrome } from "./ReaderChrome";
import { revealMark } from "./revealMark";
import type { Chunk } from "../readaloud/speech";
import type { ReaderProps, TextBridge } from "./types";

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

// EPUB content is untrusted: no script of the book's may run, whatever the frame's sandbox allows.
// base-uri 'self': epub.js sets each chapter's <base> to its own (same-origin) URL so relative images and styles resolve
const BOOK_CSP = `<meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'; base-uri 'self'" />`;

// Our own per-chapter style tag rather than themes.register/select: epub.js never removes a theme's injected
// stylesheet, so switching back to an earlier page colour left the later one winning. !important beats book CSS.
// Body colour alone leaves chapter text black: books set their own colour on p, div and span. Those have to inherit,
// and their paper backgrounds have to clear, or sepia and dark only tint the frame around the words.
const pageCss = (p: ReadingPrefs) => {
  const { background, color } = THEMES[p.theme];
  return `html{color-scheme:light;background:${background}!important;color:${color}!important}body{background:${background}!important;color:${color}!important}body *{color:inherit!important;-webkit-text-fill-color:currentColor!important;background-color:transparent!important}`;
};

function paintPage(doc: Document, p: ReadingPrefs) {
  let style = doc.getElementById("lumaread-page");
  if (!style) {
    style = doc.createElement("style");
    style.id = "lumaread-page";
  }
  style.textContent = pageCss(p);
  doc.head.appendChild(style); // last in the head, so it wins over a book sheet appended after the first paint
}

function paintContents(contents: Contents, p: ReadingPrefs) {
  const { background, color } = THEMES[p.theme];
  paintPage(contents.document, p);
  contents.css("background-color", background, true);
  contents.css("color", color, true);
  // The iframe's own canvas stays white on Android unless the frame element is painted too
  const frame = contents.window.frameElement as HTMLElement | null;
  frame?.style.setProperty("background", background);
  frame?.parentElement?.style.setProperty("background", background);
  frame?.closest<HTMLElement>(".epub-container")?.style.setProperty("background", background);
}

function applyPrefs(rendition: Rendition, p: ReadingPrefs) {
  for (const c of rendition.getContents() as unknown as Contents[]) paintContents(c, p);
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

function pointsAt(doc: Document, offsets: number[]): ({ node: Node; offset: number } | undefined)[] {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  let base = 0;
  return offsets.map((offset) => {
    while (node && offset > base + node.textContent!.length) {
      base += node.textContent!.length;
      node = walker.nextNode();
    }
    return node ? { node, offset: offset - base } : undefined;
  });
}

export function EpubReader({ doc, bytes, initial, goTo, prefs, annotations, tools, textRef, onPrefsChange, onLocation, onSelect, onAnnotationClick, onClose }: ReaderProps) {
  const viewRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<Rendition>(null);
  const bookRef = useRef<{ locations: { length: () => number; cfiFromPercentage: (percent: number) => string } } | null>(null);
  const drawnRef = useRef(new Map<string, string>()); // annotation id → cfiRange|color currently drawn
  const clickRef = useRef(onAnnotationClick);
  const layout = effectiveLayout(prefs.layout);
  const prefsRef = useRef(prefs); // chapters loaded later read the current colours
  prefsRef.current = prefs;
  const lastCfi = useRef<string>(undefined); // where to reopen after a layout switch
  const [renditionId, setRenditionId] = useState(0);
  const [toc, setToc] = useState<NavItem[]>([]);
  const [label, setLabel] = useState("Loading…");
  const [place, setPlace] = useState<{ page: number; total: number }>();
  const labelRef = useRef("");
  const [error, setError] = useState<string>();

  clickRef.current = onAnnotationClick;

  useEffect(() => {
    const book = ePub(bytes.slice(0));
    bookRef.current = book;
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
    foundDrawn.current = { units: new Set(), cfis: [] };
    rendition.hooks.content.register((contents: Contents) => {
      const style = contents.document.createElement("style");
      style.textContent = FONT_FACE;
      contents.document.head.appendChild(style);
      paintContents(contents, prefsRef.current);
      // Our own selection detection: epub.js's "selected" event never fires in WebKit (the macOS app's webview)
      let settle: ReturnType<typeof setTimeout>;
      const check = () => {
        clearTimeout(settle);
        settle = setTimeout(() => reportSelection(contents), 250); // let drag handles and double-clicks settle
      };
      for (const type of ["selectionchange", "mouseup", "touchend", "keyup"]) contents.document.addEventListener(type, check);
      contents.document.addEventListener("keydown", (e) => {
        if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "f") return;
        e.preventDefault();
        window.dispatchEvent(new KeyboardEvent("keydown", { key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, cancelable: true }));
      });
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
      const total = book.locations.length();
      if (!pagesReady || !total) return undefined; // image-only books (comics) have no text to count pages by
      return { n: Math.min(Math.max(book.locations.locationFromCfi(cfi) as unknown as number, 1), total), total };
    };

    function report(loc: { cfi: string; href: string; index: number }) {
      const chapter = chapterNames.get(loc.href) || `Section ${loc.index + 1}`;
      const page = pageOf(loc.cfi);
      const text = page ? `${chapter} · Page ${page.n} / ${page.total}` : chapter;
      setLabel(text);
      setPlace(page ? { page: page.n, total: page.total } : undefined);
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
    rendition.on("rendered", (section: { index: number }) => {
      setTimeout(fillScreen, 50); // after the new chapter has measured its height
      const pending = pendingMark.current;
      if (pending?.unit === section.index) textRef?.current?.mark(pending);
      drawFoundRef.current?.(section.index);
    });

    rendition
      .display(lastCfi.current ?? epubTarget(initial))
      .then(fillScreen, () => setError("This EPUB could not be displayed."));

    return () => {
      window.removeEventListener("keyup", onKey);
      renditionRef.current = null;
      bookRef.current = null;
      book.destroy();
    };
    // Rebuild only for a different document or layout
  }, [doc.id, layout]);

  useEffect(() => {
    if (renditionRef.current) applyPrefs(renditionRef.current, prefs);
  }, [prefs]);

  const spokenCfi = useRef<string>(undefined); // mark currently drawn (read aloud, find)
  const pendingMark = useRef<Parameters<TextBridge["mark"]>[0]>(null); // asked for before its chapter was loaded
  const foundRef = useRef(new Map<number, Chunk[]>());
  const foundDrawn = useRef<{ units: Set<number>; cfis: string[] }>({ units: new Set(), cfis: [] });
  const drawFoundRef = useRef<(unit: number) => void>(undefined);

  useEffect(() => {
    if (!textRef) return;
    type Loc = { start: { index: number; cfi: string }; end: { cfi: string } };
    const location = () => {
      const loc = renditionRef.current?.currentLocation() as unknown as Loc | undefined;
      return loc?.start ? loc : undefined; // {} until the first page is shown
    };
    const loadedContents = () => renditionRef.current?.getContents() as unknown as (Contents & { sectionIndex: number })[] | undefined;
    const contentsOf = (index: number) => loadedContents()?.find((c) => c.sectionIndex === index);
    const drawFound = (unit: number) => {
      const rendition = renditionRef.current;
      const contents = contentsOf(unit);
      const chunks = foundRef.current.get(unit);
      if (!rendition || !contents || !chunks || foundDrawn.current.units.has(unit)) return;
      foundDrawn.current.units.add(unit);
      const points = pointsAt(contents.document, chunks.flatMap((c) => [c.start, c.end]));
      chunks.forEach((_, i) => {
        const start = points[i * 2];
        const end = points[i * 2 + 1];
        if (!start || !end) return;
        const range = contents.document.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        const cfi = contents.cfiFromRange(range);
        foundDrawn.current.cfis.push(cfi);
        rendition.annotations.underline(cfi, {}, () => undefined, "find-mark");
      });
    };
    drawFoundRef.current = drawFound;
    const revealFind = () =>
      revealMark(viewRef.current?.querySelector("svg g.find-current"), viewRef.current?.querySelector<HTMLElement>(".epub-container"));
    textRef.current = {
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
        if (!contents) return void rendition.display(unit).then(revealFind, () => undefined);
        // Text offset → the DOM text node holding it → a CFI epub.js can display
        const at = pointAt(contents.document, offset);
        if (!at) return;
        const range = contents.document.createRange();
        range.setStart(at.node, at.offset);
        const cfi = contents.cfiFromRange(range);
        const compare = new EpubCFI();
        if (compare.compare(cfi, loc.start.cfi) < 0 || compare.compare(cfi, loc.end.cfi) > 0) rendition.display(cfi).then(revealFind, () => undefined);
      },
      mark(spoken) {
        const rendition = renditionRef.current;
        if (!rendition) return;
        if (spokenCfi.current) rendition.annotations.remove(spokenCfi.current, "highlight");
        spokenCfi.current = undefined;
        const contents = spoken && contentsOf(spoken.unit);
        pendingMark.current = spoken && !contents ? spoken : null; // drawn once that chapter renders
        const start = contents && pointAt(contents.document, spoken!.chunk.start);
        const end = contents && pointAt(contents.document, spoken!.chunk.end);
        if (!contents || !start || !end) return;
        const range = contents.document.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        spokenCfi.current = contents.cfiFromRange(range);
        if (spoken!.find) {
          rendition.annotations.highlight(spokenCfi.current, {}, () => undefined, "find-current");
          return revealFind();
        }
        rendition.annotations.highlight(spokenCfi.current, {}, () => undefined, "speak-mark", {
          fill: "#5b5bd6",
          "fill-opacity": prefsRef.current.theme === "dark" ? "0.4" : "0.22",
          "mix-blend-mode": prefsRef.current.theme === "dark" ? "screen" : "multiply", // multiply vanishes on a dark page
        });
      },
      markAll(spots) {
        const rendition = renditionRef.current;
        for (const cfi of foundDrawn.current.cfis) rendition?.annotations.remove(cfi, "underline");
        foundDrawn.current = { units: new Set(), cfis: [] };
        const found = new Map<number, Chunk[]>();
        for (const s of spots ?? []) {
          const chunks = found.get(s.unit);
          if (chunks) chunks.push(s.chunk);
          else found.set(s.unit, [s.chunk]);
        }
        foundRef.current = found;
        for (const c of loadedContents() ?? []) drawFound(c.sectionIndex);
      },
    };
    return () => void (textRef.current = null);
  }, [textRef]);

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

  // The slider asks for a new page on every movement. Display the latest one as soon as the current turn finishes,
  // instead of stacking a reload for every page the finger passed through.
  const seekNext = useRef<number | null>(null);
  const seekBusy = useRef(false);
  function seekPage(page: number) {
    seekNext.current = page;
    if (seekBusy.current) return;
    const step = () => {
      const book = bookRef.current;
      const rendition = renditionRef.current;
      const target = seekNext.current;
      seekNext.current = null;
      if (!book || !rendition || target == null) return (seekBusy.current = false);
      const total = book.locations.length();
      if (total < 2) return (seekBusy.current = false);
      const cfi = book.locations.cfiFromPercentage((target - 1) / (total - 1));
      if (!cfi) return (seekBusy.current = false);
      seekBusy.current = true;
      Promise.resolve(rendition.display(cfi)).then(
        () => (seekBusy.current = false, seekNext.current != null && step()),
        () => (seekBusy.current = false, seekNext.current != null && step()),
      );
    };
    step();
  }

  return (
    <ReaderChrome
      title={doc.title}
      location={label}
      onClose={onClose}
      onPrev={() => renditionRef.current?.prev()}
      onNext={() => renditionRef.current?.next()}
      scrub={place && place.total > 1 ? { page: place.page, total: place.total, onSeek: seekPage } : undefined}
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
