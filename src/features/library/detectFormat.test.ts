import { describe, expect, it } from "vitest";
import { detectFormat } from "./detectFormat";

const bytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const epubHeader = "PK\x03\x04" + "\0".repeat(26) + "mimetypeapplication/epub+zip";

describe("detectFormat", () => {
  it("detects PDF by header, even after leading junk", () => {
    expect(detectFormat(bytes("%PDF-1.7\n"), "a.bin")).toBe("pdf");
    expect(detectFormat(bytes("junk\n%PDF-1.4"), "a.pdf")).toBe("pdf");
  });

  it("detects OCF-compliant EPUB regardless of name", () => {
    expect(detectFormat(bytes(epubHeader), "book.zip")).toBe("epub");
  });

  it("accepts a non-compliant zip only when named .epub", () => {
    expect(detectFormat(bytes("PK\x03\x04whatever"), "Book.EPUB")).toBe("epub");
    expect(detectFormat(bytes("PK\x03\x04whatever"), "archive.zip")).toBeNull();
  });

  it("detects comics and text by name, text only without binary bytes", () => {
    expect(detectFormat(bytes("PK\x03\x04whatever"), "Issue 1.CBZ")).toBe("cbz");
    expect(detectFormat(bytes("Once upon a time"), "story.txt")).toBe("txt");
    expect(detectFormat(bytes("# Notes"), "notes.markdown")).toBe("md");
    expect(detectFormat(bytes("# Notes"), "notes.md")).toBe("md");
    expect(detectFormat(bytes("bin\0ary"), "data.txt")).toBeNull();
    expect(detectFormat(bytes("Once upon a time"), "story.doc")).toBeNull();
  });

  it("rejects other files, including ones misnamed .pdf", () => {
    expect(detectFormat(bytes("hello"), "fake.pdf")).toBeNull();
    expect(detectFormat(new Uint8Array(), "empty.epub")).toBeNull();
  });
});
