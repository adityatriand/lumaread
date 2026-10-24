// Message framing and crypto for Wi-Fi sync. All WebCrypto, so the native transport only ever sees ciphertext.
type Bytes = Uint8Array<ArrayBuffer>;
const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64(u: Uint8Array): string {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
export const unb64 = (s: string): Bytes => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let at = 0;
  for (const p of parts) (out.set(p, at), (at += p.length));
  return out;
}

// [u32 JSON length][JSON][binary]: one shape for headers, bodies and replies; a book travels as the binary part
export function pack(json: unknown, bin: Uint8Array = new Uint8Array()): Bytes {
  const head = enc.encode(JSON.stringify(json));
  const out = new Uint8Array(4 + head.length + bin.length);
  new DataView(out.buffer).setUint32(0, head.length);
  out.set(head, 4);
  out.set(bin, 4 + head.length);
  return out;
}

export function unpack<T = Record<string, unknown>>(bytes: Uint8Array): { json: T; bin: Bytes } {
  const len = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (4 + len > bytes.length) throw new Error("Malformed sync message");
  return { json: JSON.parse(dec.decode(bytes.subarray(4, 4 + len))) as T, bin: bytes.slice(4 + len) };
}

export const sha256 = async (data: Uint8Array): Promise<Bytes> => new Uint8Array(await crypto.subtle.digest("SHA-256", data as Bytes));

const aes = (keyB64: string) => crypto.subtle.importKey("raw", unb64(keyB64), "AES-GCM", false, ["encrypt", "decrypt"]);

// iv (12 bytes) + AES-256-GCM ciphertext; GCM also proves the message came from the paired device unaltered
export async function seal(keyB64: string, plain: Uint8Array): Promise<Bytes> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return concat(iv, new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aes(keyB64), plain as Bytes)));
}

export async function open(keyB64: string, data: Uint8Array): Promise<Bytes> {
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: data.slice(0, 12) }, await aes(keyB64), data.slice(12)));
  } catch {
    throw new Error("Couldn't read the other device's message. Pair the devices again.");
  }
}

const P256 = { name: "ECDH", namedCurve: "P-256" } as const;

export async function newKeyPair() {
  const pair = await crypto.subtle.generateKey(P256, false, ["deriveBits"]);
  return { pair, pub: new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)) };
}

// ECDH secret → AES key (base64), the same on both devices
export async function sharedKey(own: CryptoKey, peerPub: Uint8Array): Promise<string> {
  const peer = await crypto.subtle.importKey("raw", peerPub as Bytes, P256, false, []);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: peer }, own, 256));
  return b64(await sha256(concat(bits, enc.encode("lumaread-sync key v1"))));
}

// Six digits both screens show; equal only if both devices hold the same two public keys and nonces
export async function pairCode(initiatorPub: Uint8Array, responderPub: Uint8Array, ni: Uint8Array, nr: Uint8Array): Promise<string> {
  const h = await sha256(concat(initiatorPub, responderPub, ni, nr));
  const n = new DataView(h.buffer).getUint32(0) % 1_000_000;
  const s = String(n).padStart(6, "0");
  return `${s.slice(0, 3)} ${s.slice(3)}`;
}
