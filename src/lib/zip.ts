// Minimal ZIP read/write: reading inflates with the platform's DecompressionStream; writing stores files
// uncompressed (book images and EPUB text are small or already compressed).
// shortcut: no ZIP64 (archives over 4 GB or 65,535 entries), fine under the 200 MB import cap
type Bytes = Uint8Array<ArrayBuffer>;

export interface ZipEntry { name: string; read: () => Promise<Bytes> }

const u16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const u32 = (b: Uint8Array, at: number) => (u16(b, at) | (u16(b, at + 2) << 16)) >>> 0;

async function inflate(data: Bytes): Promise<Bytes> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function readZip(zip: Bytes): ZipEntry[] {
  // End of central directory: the last "PK\5\6", within the 64 KB a trailing comment can take
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (u32(zip, i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("Not a ZIP archive");
  const count = u16(zip, end + 10);
  let at = u32(zip, end + 16);
  const names = new TextDecoder();
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (u32(zip, at) !== 0x02014b50) throw new Error("Damaged ZIP archive");
    const method = u16(zip, at + 10);
    const size = u32(zip, at + 20);
    const nameLen = u16(zip, at + 28);
    const local = u32(zip, at + 42);
    const name = names.decode(zip.subarray(at + 46, at + 46 + nameLen));
    at += 46 + nameLen + u16(zip, at + 30) + u16(zip, at + 32);
    if (name.endsWith("/")) continue; // folder
    const start = local + 30 + u16(zip, local + 26) + u16(zip, local + 28);
    const data = zip.slice(start, start + size);
    if (method !== 0 && method !== 8) throw new Error(`"${name}" uses an unsupported compression`);
    entries.push({ name, read: () => (method === 8 ? inflate(data) : Promise.resolve(data)) });
  }
  return entries;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Stored (uncompressed) archive in the given order, with fixed timestamps so the same input always gives the same
// bytes (and so the same hash: a re-import is recognised as a duplicate)
export function writeZip(files: { name: string; data: Uint8Array }[]): Bytes {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new Uint8Array(30);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(12, 0x0021, true); // 1980-01-01
    lv.setUint32(14, crc, true);
    lv.setUint32(18, f.data.length, true);
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, name.length, true);
    const dir = new Uint8Array(46);
    const dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 20, true);
    dv.setUint16(8, 0x0800, true);
    dv.setUint16(14, 0x0021, true);
    dv.setUint32(16, crc, true);
    dv.setUint32(20, f.data.length, true);
    dv.setUint32(24, f.data.length, true);
    dv.setUint16(28, name.length, true);
    dv.setUint32(42, offset, true);
    parts.push(local, name, f.data);
    central.push(dir, name);
    offset += 30 + name.length + f.data.length;
  }
  const dirSize = central.reduce((a, p) => a + p.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, dirSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((a, p) => a + p.length, 0));
  let at = 0;
  for (const p of all) (out.set(p, at), (at += p.length));
  return out;
}
