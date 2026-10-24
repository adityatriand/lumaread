import { describe, expect, it } from "vitest";
import { crc32, readZip, writeZip } from "./zip";

const text = (s: string) => new TextEncoder().encode(s);

describe("zip", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(text("123456789"))).toBe(0xcbf43926);
  });

  it("writes a stored archive that reads back in order, deterministically", async () => {
    const files = [{ name: "mimetype", data: text("application/epub+zip") }, { name: "OEBPS/ch 1.xhtml", data: text("<p>Halo</p>") }];
    const zip = writeZip(files);
    expect(writeZip(files)).toEqual(zip);
    // EPUB rule: "mimetype" first and uncompressed, right after its 30-byte header
    expect(new TextDecoder().decode(zip.subarray(38, 58))).toBe("application/epub+zip");
    const entries = readZip(zip);
    expect(entries.map((e) => e.name)).toEqual(["mimetype", "OEBPS/ch 1.xhtml"]);
    expect(new TextDecoder().decode(await entries[1].read())).toBe("<p>Halo</p>");
  });

  it("inflates deflated entries (how most CBZ files are made)", async () => {
    const original = text("comic page ".repeat(200));
    const deflated = new Uint8Array(await new Response(new Blob([original]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
    // Patch a stored archive into a deflated one: method 8 and the compressed size, in both headers
    const stored = writeZip([{ name: "p1.txt", data: deflated }]);
    const v = new DataView(stored.buffer);
    v.setUint16(8, 8, true);
    v.setUint32(22, original.length, true);
    const dir = 30 + 6 + deflated.length;
    v.setUint16(dir + 10, 8, true);
    v.setUint32(dir + 24, original.length, true);
    expect(await readZip(stored)[0].read()).toEqual(original);
  });

  it("rejects files that aren't ZIP archives", () => {
    expect(() => readZip(text("not a zip at all, just text"))).toThrow(/Not a ZIP/);
  });
});
