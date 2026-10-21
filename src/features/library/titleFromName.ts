// "Salvation of a Saint - Keigo Higashino.pdf" → { title, author }; the last spaced dash separates the author
export function titleFromName(fileName: string): { title: string; author?: string } {
  const base = fileName.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim();
  const m = base.match(/^(.+)\s[-–—]\s([^-–—]+)$/);
  return m ? { title: m[1].trim(), author: m[2].trim() } : { title: base };
}
