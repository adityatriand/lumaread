import { readZip, writeZip } from "../../lib/zip";

// TXT, Markdown and CBZ are converted to EPUB at import, so the reader, highlights, search, read aloud and sync
// all work on them unchanged. Output is deterministic: the same file always gives the same EPUB (same hash).

interface Chapter { title: string; body: string } // body: XHTML, already escaped
interface Image { name: string; type: string; data: Uint8Array }

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const xhtml = (title: string, body: string) =>
  `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><meta charset="utf-8"/><title>${escape(title)}</title><link rel="stylesheet" href="style.css"/></head><body>${body}</body></html>`;

function buildEpub(meta: { title: string; author?: string; lang: string; css: string }, chapters: Chapter[], images: Image[] = []): Uint8Array {
  const enc = new TextEncoder();
  const id = (i: number) => `c${String(i + 1).padStart(4, "0")}`;
  const manifest = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="css" href="style.css" media-type="text/css"/>`,
    ...chapters.map((_, i) => `<item id="${id(i)}" href="${id(i)}.xhtml" media-type="application/xhtml+xml"/>`),
    ...images.map((img, i) => `<item id="img${i}" href="img/${escape(img.name)}" media-type="${img.type}"${i === 0 ? ` properties="cover-image"` : ""}/>`),
  ];
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">urn:lumaread:${escape(meta.title)}</dc:identifier><dc:title>${escape(meta.title)}</dc:title>${meta.author ? `<dc:creator>${escape(meta.author)}</dc:creator>` : ""}<dc:language>${meta.lang}</dc:language><meta property="dcterms:modified">2000-01-01T00:00:00Z</meta>
</metadata><manifest>${manifest.join("")}</manifest><spine>${chapters.map((_, i) => `<itemref idref="${id(i)}"/>`).join("")}</spine></package>`;
  const nav = xhtml(meta.title, `<nav epub:type="toc"><ol>${chapters.map((c, i) => `<li><a href="${id(i)}.xhtml">${escape(c.title)}</a></li>`).join("")}</ol></nav>`);
  return writeZip([
    { name: "mimetype", data: enc.encode("application/epub+zip") }, // first and stored, as EPUB requires
    { name: "META-INF/container.xml", data: enc.encode(`<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`) },
    { name: "OEBPS/content.opf", data: enc.encode(opf) },
    { name: "OEBPS/nav.xhtml", data: enc.encode(nav) },
    { name: "OEBPS/style.css", data: enc.encode(meta.css) },
    ...chapters.map((c, i) => ({ name: `OEBPS/${id(i)}.xhtml`, data: enc.encode(xhtml(c.title, c.body)) })),
    ...images.map((img) => ({ name: `OEBPS/img/${img.name}`, data: img.data })),
  ]);
}

const TEXT_CSS = "body { margin: 0 1em; } h1, h2, h3 { line-height: 1.25; } pre { white-space: pre-wrap; } blockquote { margin-left: 1em; padding-left: 1em; border-left: 3px solid #ccc; }";
const CHAPTER_CHARS = 20_000; // plain text without headings is split near this size

// Inline Markdown on already-escaped text; links keep their text only (a book never navigates the app away)
const inline = (s: string) =>
  s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/!?\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g, "$1") // URLs may hold one level of (parentheses)
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => `<strong>${a ?? b}</strong>`)
    .replace(/(^|[^*\w])\*([^*\n]+)\*|(^|[^_\w])_([^_\n]+)_/g, (_, p1, a, p2, b) => `${p1 ?? p2}<em>${a ?? b}</em>`);

// Markdown blocks → XHTML, split into chapters at # and ## headings
export function markdownChapters(md: string, fallbackTitle: string): Chapter[] {
  const chapters: Chapter[] = [];
  let current: Chapter = { title: fallbackTitle, body: "" };
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (line.startsWith("```")) {
      const code: string[] = [];
      while (++i < lines.length && !lines[i].startsWith("```")) code.push(lines[i]);
      current.body += `<pre><code>${escape(code.join("\n"))}</code></pre>`;
    } else if (heading) {
      const level = heading[1].length;
      const text = heading[2].replace(/\s*#+\s*$/, "");
      if (level <= 2 && current.body.trim()) (chapters.push(current), (current = { title: text, body: "" }));
      else if (level <= 2) current.title = text;
      current.body += `<h${level}>${inline(escape(text))}</h${level}>`;
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      current.body += "<hr/>";
    } else if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      for (; i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i]); i++) items.push(lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, ""));
      i--;
      const tag = ordered ? "ol" : "ul";
      current.body += `<${tag}>${items.map((t) => `<li>${inline(escape(t))}</li>`).join("")}</${tag}>`;
    } else if (line.startsWith(">")) {
      const quote: string[] = [];
      for (; i < lines.length && lines[i].startsWith(">"); i++) quote.push(lines[i].replace(/^>\s?/, ""));
      i--;
      current.body += `<blockquote><p>${inline(escape(quote.join(" ")))}</p></blockquote>`;
    } else if (line.trim()) {
      const para: string[] = [];
      for (; i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>|\s*([-*+]|\d+[.)])\s)/.test(lines[i]); i++) para.push(lines[i].trim());
      i--;
      current.body += `<p>${inline(escape(para.join(" ")))}</p>`;
    }
  }
  if (current.body.trim() || !chapters.length) chapters.push(current);
  return chapters;
}

// Plain text: paragraphs at blank lines; chapters at "Chapter 3" / "Bab 3" style lines, else by size
export function textChapters(text: string, fallbackTitle: string): Chapter[] {
  const paras = text.replace(/\r\n?/g, "\n").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const isHeading = (p: string) => p.length < 80 && !p.includes("\n") && /^(chapter|bab|part|bagian|prologue|prolog|epilogue|epilog)\b/i.test(p);
  const chapters: Chapter[] = [];
  let current: Chapter = { title: fallbackTitle, body: "" };
  let size = 0;
  for (const p of paras) {
    if ((isHeading(p) || size > CHAPTER_CHARS) && current.body) {
      chapters.push(current);
      current = { title: isHeading(p) ? p : `Part ${chapters.length + 1}`, body: "" };
      size = 0;
    } else if (isHeading(p)) current.title = p;
    current.body += isHeading(p) ? `<h2>${escape(p)}</h2>` : `<p>${escape(p).replace(/\n/g, "<br/>")}</p>`;
    size += p.length;
  }
  if (current.body || !chapters.length) chapters.push(current);
  if (chapters.length > 1 && chapters[0].title === fallbackTitle) chapters[0].title = "Start";
  return chapters;
}

// UTF-8 when valid, otherwise Windows-1252 (older plain-text books)
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

export function textToEpub(bytes: Uint8Array, kind: "txt" | "md", title: string, author?: string): Uint8Array {
  const text = decodeText(bytes);
  const chapters = kind === "md" ? markdownChapters(text, title) : textChapters(text, title);
  return buildEpub({ title, author, lang: "und", css: TEXT_CSS }, chapters);
}

const IMAGE_TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" };
// One image per page, as large as the screen allows
const COMIC_CSS = "html, body { margin: 0; padding: 0; height: 100%; } .page { height: 100vh; display: flex; align-items: center; justify-content: center; } .page img { max-width: 100%; max-height: 100vh; }";

export async function cbzToEpub(bytes: Uint8Array<ArrayBuffer>, title: string, author?: string): Promise<Uint8Array> {
  const pages = readZip(bytes)
    .filter((e) => !/(^|\/)(__MACOSX|\.)/.test(e.name) && IMAGE_TYPES[e.name.split(".").pop()!.toLowerCase()])
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (!pages.length) throw new Error("no images");
  const images: Image[] = [];
  for (const [i, p] of pages.entries()) {
    const ext = p.name.split(".").pop()!.toLowerCase();
    images.push({ name: `${String(i + 1).padStart(4, "0")}.${ext}`, type: IMAGE_TYPES[ext], data: await p.read() });
  }
  const chapters = images.map((img, i) => ({ title: `Page ${i + 1}`, body: `<div class="page"><img src="img/${img.name}" alt="Page ${i + 1}"/></div>` }));
  return buildEpub({ title, author, lang: "und", css: COMIC_CSS }, chapters, images);
}
