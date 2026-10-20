import serifFont from "@fontsource-variable/source-serif-4/files/source-serif-4-latin-wght-normal.woff2?url";
import ePub, { type Contents, type NavItem, type Rendition } from "epubjs";
import { useEffect, useRef, useState } from "react";
import { epubAnchor, epubTarget, quoteIn } from "../../lib/anchor";
import type { HighlightColor } from "../../lib/db";
import { LINE_HEIGHTS, THEMES, effectiveLayout, type Layout, type ReadingPrefs } from "../settings/prefs";
import { ReaderChrome } from "./ReaderChrome";
import type { ReaderProps } from "./types";

// Book pages render in an iframe, so the app's bundled font has to be declared inside it
const FONT_FACE = `@font-face{font-family:"Source Serif 4 Variable";font-weight:200 900;src:url(${new URL(serifFont, location.href)}) format("woff2")}`;

const HL_FILL: Record<HighlightColor, string> = { yellow: "#facc15", green: "#4ade80", blue: "#60a5fa", pink: "#f472b6" };

// epub.js has no in-place switch between scrolled and paginated, so each layout gets its own rendition
const RENDITION: Record<Layout, object> = {
  continuous: { flow: "scrolled", manager: "continuous" },
  spread: { flow: "paginated", spread: "always", minSpreadWidth: 0 },
  horizontal: { flow: "paginated", spread: "none" },
};

function applyPrefs(rendition: Rendition, p: ReadingPrefs) {
  rendition.themes.select(p.theme);
  rendition.themes.fontSize(`${p.fontSize}%`);
  rendition.themes.font(`"Source Serif 4 Variable", "Noto Serif", serif`);
  rendition.themes.override("line-height", String(LINE_HEIGHTS[p.lineSpacing]), true);
}

export function EpubReader({ doc, bytes, initial, prefs, annotations, tools, onPrefsChange, onLocation, onSelect, onAnnotationClick, onClose }: ReaderProps) {
  const viewRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<Rendition>(null);
  const drawnRef = useRef(new Map<string, string>()); // annotation id → cfiRange|color currently drawn
  const clickRef = useRef(onAnnotationClick);
  const layout = effectiveLayout(prefs.layout);
  const lastCfi = useRef<string>(undefined); // where to reopen after a layout switch
  const [renditionId, setRenditionId] = useState(0);
  const [toc, setToc] = useState<NavItem[]>([]);
  const [label, setLabel] = useState("Loading…");
  const labelRef = useRef("");
  const [error, setError] = useState<string>();

  clickRef.current = onAnnotationClick;

  useEffect(() => {
    const book = ePub(bytes.slice(0));
    // Book scripts stay disabled: EPUB content is untrusted
    const rendition = book.renderTo(viewRef.current!, { width: "100%", height: "100%", ...RENDITION[layout], allowScriptedContent: false });
    renditionRef.current = rendition;
    setRenditionId((n) => n + 1);
    drawnRef.current.clear();
    for (const [name, { background, color }] of Object.entries(THEMES)) rendition.themes.register(name, { body: { background, color } });
    rendition.hooks.content.register((contents: Contents) => {
      const style = contents.document.createElement("style");
      style.textContent = FONT_FACE;
      contents.document.head.appendChild(style);
      contents.document.addEventListener("selectionchange", () => {
        if (contents.window.getSelection()?.isCollapsed) onSelect(null);
      });
    });
    applyPrefs(rendition, prefs);

    rendition.on("relocated", (loc: { start: { cfi: string; href: string; index: number } }) => {
      const chapter = book.navigation?.get(loc.start.href)?.label.trim() || `Section ${loc.start.index + 1}`;
      setLabel(chapter);
      lastCfi.current = loc.start.cfi;
      labelRef.current = chapter;
      // shortcut: percent by section, not exact; switch to book.locations.generate() if users need precision
      onLocation(epubAnchor(loc.start.cfi), (loc.start.index + 1) / (book.spine.last().index + 1), chapter);
    });

    rendition.on("selected", (cfiRange: string, contents: Contents) => {
      const sel = contents.window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      const frame = (contents.window.frameElement as HTMLElement).getBoundingClientRect();
      const r = range.getBoundingClientRect();
      onSelect({
        anchor: { v: 1, kind: "epub", cfiRange, quote: quoteIn(contents.document.body.textContent ?? "", sel.toString()) },
        label: labelRef.current,
        rect: new DOMRect(r.left + frame.left, r.top + frame.top, r.width, r.height),
        clear: () => sel.removeAllRanges(),
      });
    });

    // Arrow keys inside the book iframe don't reach window listeners
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") rendition.prev();
      if (e.key === "ArrowRight") rendition.next();
    };
    rendition.on("keyup", onKey);
    window.addEventListener("keyup", onKey);

    book.loaded.navigation.then((nav) => setToc(nav.toc));
    rendition.display(lastCfi.current ?? epubTarget(initial)).catch(() => setError("This EPUB could not be displayed."));

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
            <select aria-label="Chapter" value="" onChange={(e) => renditionRef.current?.display(e.target.value)}>
              <option value="" disabled>Chapters</option>
              {toc.map((item) => <option key={item.id} value={item.href}>{item.label.trim()}</option>)}
            </select>
          )}
        </>
      }
    >
      {error && <p className="alert" role="alert">{error}</p>}
      <div ref={viewRef} className="epub-view" />
    </ReaderChrome>
  );
}
