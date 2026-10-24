import type { ReactNode, RefObject } from "react";
import type { Anchor, RangeAnchor } from "../../lib/anchor";
import type { Annotation, DocMeta } from "../../lib/db";
import type { Chunk } from "../readaloud/speech";
import type { ReadingPrefs } from "../settings/prefs";

export interface TextSelection {
  anchor: RangeAnchor;
  label: string; // "p. 12" or chapter title
  rect: DOMRect; // viewport coordinates, for placing the toolbar
  clear: () => void;
}

// How read aloud and find-in-book move through the text and highlight a spot; units are those of the texts
// store (PDF page, EPUB spine index)
export interface TextBridge {
  position: () => { unit: number; offset: number } | undefined; // where the reader is, as an offset into that unit's text
  show: (unit: number, offset: number) => void; // bring that spot on screen if it isn't already
  // Highlight a stretch of text (the sentence being read, a find match); null clears it. `nth` picks which
  // occurrence of identical text on that unit, for engines that locate text by matching (PDF)
  mark: (spot: { unit: number; chunk: Chunk; nth?: number } | null) => void;
  textOf?: (unit: number) => Promise<string | undefined>; // fresher text than the store has (scanned PDFs: OCR on demand)
}

// The ReaderEngine boundary (ADR-006): engines take and emit our anchors, never library locations,
// and only draw highlights — creating and editing them lives in ReaderView
export interface ReaderProps {
  doc: DocMeta;
  bytes: ArrayBuffer;
  initial?: Anchor;
  goTo?: { anchor: Anchor }; // jump while open (e.g. a bookmark); a fresh object each time, so the same place can be revisited
  prefs: ReadingPrefs;
  annotations: Annotation[];
  tools?: ReactNode; // extra reader-bar buttons supplied by ReaderView
  textRef?: RefObject<TextBridge | null>; // filled by the engine
  onPrefsChange: (p: ReadingPrefs) => void;
  onLocation: (anchor: Anchor, percent: number, label: string) => void;
  onSelect: (selection: TextSelection | null) => void;
  onAnnotationClick: (id: string) => void;
  onClose: () => void;
}
