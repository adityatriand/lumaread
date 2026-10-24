import { describe, expect, it } from "vitest";
import { readZip, writeZip } from "../../lib/zip";
import { cbzToEpub, decodeText, markdownChapters, textChapters, textToEpub } from "./convert";

const text = (s: string) => new TextEncoder().encode(s);
const files = async (epub: Uint8Array) =>
  Object.fromEntries(await Promise.all(readZip(epub as Uint8Array<ArrayBuffer>).map(async (e) => [e.name, new TextDecoder().decode(await e.read())])));

describe("TXT / Markdown / CBZ to EPUB", () => {
  it("splits plain text into chapters at chapter lines, keeping paragraphs", () => {
    const chapters = textChapters("Opening words.\n\nChapter 1\n\nIt began.\nSecond line.\n\nBab 2\n\nLalu.", "Book");
    expect(chapters.map((c) => c.title)).toEqual(["Start", "Chapter 1", "Bab 2"]);
    expect(chapters[1].body).toBe("<h2>Chapter 1</h2><p>It began.<br/>Second line.</p>");
  });

  it("renders Markdown blocks and inline marks, one chapter per # / ## heading", () => {
    const chapters = markdownChapters("# One\n\nSome **bold** and *em* and `code`.\n\n- a\n- b\n\n## Two\n\n> quoted\n\n```\nx < y\n```", "Book");
    expect(chapters.map((c) => c.title)).toEqual(["One", "Two"]);
    expect(chapters[0].body).toBe("<h1>One</h1><p>Some <strong>bold</strong> and <em>em</em> and <code>code</code>.</p><ul><li>a</li><li>b</li></ul>");
    expect(chapters[1].body).toBe("<h2>Two</h2><blockquote><p>quoted</p></blockquote><pre><code>x &lt; y</code></pre>");
  });

  it("never lets file content become markup or a link", () => {
    const [c] = markdownChapters('<script>alert(1)</script> [click](javascript:alert(1)) ![x](file.png) "q"', "Book");
    expect(c.body).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt; click x &quot;q&quot;</p>");
  });

  it("reads Windows-1252 text that isn't valid UTF-8", () => {
    expect(decodeText(new Uint8Array([0x63, 0x61, 0x66, 0xe9]))).toBe("café");
    expect(decodeText(text("﻿halo"))).toBe("halo");
  });

  it("builds a valid, deterministic EPUB from text", async () => {
    const epub = textToEpub(text("# Hello\n\nWorld"), "md", "My Notes", "Me");
    expect(textToEpub(text("# Hello\n\nWorld"), "md", "My Notes", "Me")).toEqual(epub);
    const f = await files(epub);
    expect(Object.keys(f)[0]).toBe("mimetype");
    expect(f["OEBPS/content.opf"]).toContain("<dc:title>My Notes</dc:title>");
    expect(f["OEBPS/content.opf"]).toContain('<itemref idref="c0001"/>');
    expect(f["OEBPS/nav.xhtml"]).toContain('<a href="c0001.xhtml">Hello</a>');
    expect(f["OEBPS/c0001.xhtml"]).toContain("<p>World</p>");
  });

  it("turns a CBZ into one page per image, in natural order, first image as cover", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const cbz = writeZip([
      { name: "comic/page10.png", data: png },
      { name: "comic/page2.png", data: png },
      { name: "__MACOSX/comic/._page2.png", data: png },
      { name: "comic/notes.txt", data: text("skip") },
    ]);
    const f = await files(await cbzToEpub(cbz, "Comic"));
    expect(Object.keys(f).filter((n) => n.startsWith("OEBPS/img/"))).toEqual(["OEBPS/img/0001.png", "OEBPS/img/0002.png"]);
    expect(f["OEBPS/content.opf"]).toContain('href="img/0001.png" media-type="image/png" properties="cover-image"');
    expect(f["OEBPS/c0002.xhtml"]).toContain('<img src="img/0002.png" alt="Page 2"/>');
    await expect(cbzToEpub(writeZip([{ name: "a.txt", data: text("x") }]), "Empty")).rejects.toThrow("no images");
  });
});
