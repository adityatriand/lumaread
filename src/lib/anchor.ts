// Our own location format so stored progress and annotations never depend on a reader library's internals
export type Anchor =
  | { v: 1; kind: "pdf"; page: number }
  | { v: 1; kind: "epub"; cfi: string }
  | { v: 1; kind: "epub-section"; href: string }; // start of a spine section, e.g. a search hit

// Fractions of the page box, so highlights survive zoom
export interface Rect { x: number; y: number; w: number; h: number }

// Exact text plus context lets a quote be recognised even if the location format later breaks
export interface TextQuote { exact: string; prefix: string; suffix: string }

export type RangeAnchor =
  | { v: 1; kind: "pdf"; page: number; rects: Rect[]; quote: TextQuote }
  | { v: 1; kind: "epub"; cfiRange: string; quote: TextQuote };

export const pdfAnchor = (page: number): Anchor => ({ v: 1, kind: "pdf", page });
export const epubAnchor = (cfi: string): Anchor => ({ v: 1, kind: "epub", cfi });

export function pdfPage(a: Anchor | undefined): number | undefined {
  return a?.kind === "pdf" ? a.page : undefined;
}

// epub.js display() takes either a CFI or a section href
export function epubTarget(a: Anchor | undefined): string | undefined {
  return a?.kind === "epub" ? a.cfi : a?.kind === "epub-section" ? a.href : undefined;
}

export function quoteWithContext(text: string, start: number, end: number, context = 32): TextQuote {
  return {
    exact: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - context), start),
    suffix: text.slice(end, end + context),
  };
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

// Locate a selection inside its page/section text; layers differ on line breaks, so compare whitespace-collapsed
export function quoteIn(fullText: string, selected: string): TextQuote {
  const text = squash(fullText);
  const exact = squash(selected);
  const start = text.indexOf(exact);
  return start < 0 ? { exact, prefix: "", suffix: "" } : quoteWithContext(text, start, start + exact.length);
}
