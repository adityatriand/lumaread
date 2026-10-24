import { describe, expect, it } from "vitest";
import { b64, newKeyPair, open, pack, pairCode, seal, sharedKey, unpack } from "./wire";

describe("sync wire format and crypto", () => {
  it("packs JSON with a binary tail and reads it back", () => {
    const bin = new Uint8Array([1, 2, 3, 250]);
    const { json, bin: back } = unpack(pack({ op: "put", n: 1 }, bin));
    expect(json).toEqual({ op: "put", n: 1 });
    expect([...back]).toEqual([1, 2, 3, 250]);
  });

  it("both devices derive the same key and code; sealed data opens only with that key", async () => {
    const a = await newKeyPair();
    const b = await newKeyPair();
    const keyA = await sharedKey(a.pair.privateKey, b.pub);
    expect(await sharedKey(b.pair.privateKey, a.pub)).toBe(keyA);

    const ni = crypto.getRandomValues(new Uint8Array(16));
    const nr = crypto.getRandomValues(new Uint8Array(16));
    const code = await pairCode(a.pub, b.pub, ni, nr);
    expect(code).toMatch(/^\d{3} \d{3}$/);
    expect(await pairCode(a.pub, b.pub, ni, nr)).toBe(code);

    const sealed = await seal(keyA, new TextEncoder().encode("progress"));
    expect(new TextDecoder().decode(await open(keyA, sealed))).toBe("progress");
    const other = b64(crypto.getRandomValues(new Uint8Array(32)));
    await expect(open(other, sealed)).rejects.toThrow(/Pair the devices again/);
    sealed[sealed.length - 1] ^= 1;
    await expect(open(keyA, sealed)).rejects.toThrow();
  });
});
