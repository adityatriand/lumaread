import { EpubCFI } from "epubjs";
import { epubAnchor, pdfAnchor, type Anchor, type RangeAnchor } from "../../lib/anchor";

// Where to open the reader so a saved highlight is on screen
export function startAnchor(a: RangeAnchor): Anchor {
  if (a.kind === "pdf") return pdfAnchor(a.page);
  const cfi = new EpubCFI(a.cfiRange);
  cfi.collapse(true);
  return epubAnchor(cfi.toString());
}
