import type { ReactNode } from "react";
import type { Anchor, RangeAnchor } from "../../lib/anchor";
import type { Annotation, DocMeta } from "../../lib/db";
import type { ReadingPrefs } from "../settings/prefs";

export interface TextSelection {
  anchor: RangeAnchor;
  label: string; // "p. 12" or chapter title
  rect: DOMRect; // viewport coordinates, for placing the toolbar
  clear: () => void;
}

// The ReaderEngine boundary (ADR-006): engines take and emit our anchors, never library locations,
// and only draw highlights — creating and editing them lives in ReaderView
export interface ReaderProps {
  doc: DocMeta;
  bytes: ArrayBuffer;
  initial?: Anchor;
  prefs: ReadingPrefs;
  annotations: Annotation[];
  tools?: ReactNode; // extra reader-bar buttons supplied by ReaderView
  onPrefsChange: (p: ReadingPrefs) => void;
  onLocation: (anchor: Anchor, percent: number, label: string) => void;
  onSelect: (selection: TextSelection | null) => void;
  onAnnotationClick: (id: string) => void;
  onClose: () => void;
}
