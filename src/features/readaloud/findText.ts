function charIndex(root: Node): { hay: string; at: { node: Text; offset: number }[] } {
  const at: { node: Text; offset: number }[] = [];
  let hay = "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    for (let i = 0; i < n.data.length; i++) {
      if (/\s/.test(n.data[i])) continue;
      hay += n.data[i];
      at.push({ node: n, offset: i });
    }
  }
  return { hay, at };
}

function rangeOf(at: { node: Text; offset: number }[], start: number, length: number): Range {
  const first = at[start];
  const last = at[start + length - 1];
  const range = document.createRange();
  range.setStart(first.node, first.offset);
  range.setEnd(last.node, last.offset + 1);
  return range;
}

// Range covering `text` inside `root`, matched with all whitespace removed: a PDF text layer and the stored page
// text agree on characters but not on spacing or line breaks. Searches from `fromChar` first so a repeated
// sentence resolves to the next occurrence, or takes the `nth` occurrence when given; returns where the match
// ended for the next call.
export function findRange(root: Node, text: string, fromChar = 0, nth?: number): { range: Range; endChar: number } | undefined {
  const needle = text.replace(/\s+/g, "");
  if (!needle) return undefined;
  const { hay, at } = charIndex(root);
  let start = hay.indexOf(needle, fromChar);
  if (nth !== undefined) for (let k = 0, at = hay.indexOf(needle); at >= 0; k++, at = hay.indexOf(needle, at + 1)) if (k === nth) start = at;
  if (start < 0) start = hay.indexOf(needle);
  if (start < 0) return undefined;
  return { range: rangeOf(at, start, needle.length), endChar: start + needle.length };
}

export function findAllRanges(root: Node, texts: string[]): Range[] {
  const needles = new Set(texts.map((t) => t.replace(/\s+/g, "")).filter(Boolean));
  if (!needles.size) return [];
  const { hay, at } = charIndex(root);
  const ranges: Range[] = [];
  for (const needle of needles) {
    for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) ranges.push(rangeOf(at, i, needle.length));
  }
  return ranges;
}
