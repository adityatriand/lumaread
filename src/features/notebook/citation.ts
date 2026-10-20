import type { RangeAnchor } from "../../lib/anchor";
import type { DocMeta } from "../../lib/db";

export function sourceOf(doc: Pick<DocMeta, "title" | "author">, anchor?: RangeAnchor, sectionLabel?: string) {
  const where = anchor?.kind === "pdf" ? `p. ${anchor.page}` : sectionLabel;
  return [doc.title, doc.author, where].filter(Boolean).join(", ");
}

export const citation = (doc: Pick<DocMeta, "title" | "author">, anchor: RangeAnchor) =>
  `“${anchor.quote.exact}” — ${sourceOf(doc, anchor)}`;
