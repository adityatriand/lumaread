import { Channel, invoke } from "@tauri-apps/api/core";
import {
  addDoc, getFile, listAnnotations, listBookmarks, listDocs, listPeers, listProgress, listSessions, listTombstones, patchDoc,
  putRecords, removeRecords, savePeer, saveTombstones, type PeerDevice,
} from "../../lib/db";
import { sha256Hex } from "../../lib/hash";
import { isPhone } from "../settings/prefs";
import { planMerge, planSize, type MergePlan, type SyncDoc, type SyncState } from "./merge";
import { b64, concat, newKeyPair, open, pack, pairCode, seal, sha256, sharedKey, unb64, unpack } from "./wire";

export interface Nearby { id: string; name: string; host: string; port: number }
export interface PairRequest { name: string; code: string; accept: () => Promise<void> }
export interface SyncSummary { booksReceived: number; booksSent: number; received: number; sent: number }

// ---- This device ----

function stored(key: string, fallback: () => string) {
  try {
    const v = localStorage.getItem(key);
    if (v) return v;
    const fresh = fallback();
    localStorage.setItem(key, fresh);
    return fresh;
  } catch {
    return fallback();
  }
}
let memoryId: string | undefined; // only if storage is unavailable
export const deviceId = () => stored("device-id", () => (memoryId ??= crypto.randomUUID()));
export const deviceName = () => stored("device-name", () => (isPhone() ? "Android phone" : "Mac"));
export function setDeviceName(name: string) {
  try {
    localStorage.setItem("device-name", name.trim().slice(0, 60) || deviceName());
  } catch {
    // keeps the default name
  }
}

// ---- What this device has, by book hash ----

async function collectState(): Promise<SyncState> {
  const [docs, progress, annotations, bookmarks, sessions, tombstones] = await Promise.all([
    listDocs(), listProgress(), listAnnotations(), listBookmarks(), listSessions(), listTombstones(),
  ]);
  const hashOf = new Map(docs.map((d) => [d.id, d.hash]));
  const onDoc = <T extends { docId: string }>(list: T[]) =>
    list.flatMap(({ docId, ...rest }) => (hashOf.has(docId) ? [{ ...rest, doc: hashOf.get(docId)! }] : []));
  return {
    docs: docs.map(({ hash, title, author, format, size, addedAt, cover, fileName, editedAt, source, shelves }) => ({ hash, title, author, format, size, addedAt, cover, fileName, editedAt, source, shelves })),
    removed: tombstones.filter((t) => t.kind === "doc").map((t) => t.id),
    progress: onDoc(progress),
    annotations: onDoc(annotations),
    bookmarks: onDoc(bookmarks),
    sessions: onDoc(sessions),
    tombstones: tombstones.filter((t) => t.kind !== "doc"),
  };
}

// A received book is checked against its hash before it is stored: the hash is its identity on both devices
async function storeBook(doc: SyncDoc, bytes: ArrayBuffer) {
  if ((await sha256Hex(bytes)) !== doc.hash) throw new Error(`"${doc.title}" arrived damaged. Try syncing again.`);
  if ((await listDocs()).some((d) => d.hash === doc.hash)) return;
  await addDoc({ ...doc, id: crypto.randomUUID() }, bytes);
}

async function applyPlan(plan: MergePlan, fetchBook?: (doc: SyncDoc, index: number) => Promise<ArrayBuffer>) {
  if (fetchBook) for (const [i, doc] of plan.fetch.entries()) await storeBook(doc, await fetchBook(doc, i));
  const idOf = new Map((await listDocs()).map((d) => [d.hash, d.id]));
  const withId = <T extends { doc: string }>(list: T[]) =>
    list.flatMap(({ doc, ...rest }) => (idOf.has(doc) ? [{ ...rest, docId: idOf.get(doc)! }] : []));
  for (const { hash, patch } of plan.docPatches) if (idOf.has(hash)) await patchDoc(idOf.get(hash)!, patch);
  await saveTombstones(plan.tombstones);
  await removeRecords("annotations", plan.remove.annotations);
  await removeRecords("bookmarks", plan.remove.bookmarks);
  await removeRecords("progress", plan.remove.progress.flatMap((hash) => (idOf.has(hash) ? [idOf.get(hash)!] : [])));
  await putRecords("progress", withId(plan.put.progress));
  await putRecords("annotations", withId(plan.put.annotations));
  await putRecords("bookmarks", withId(plan.put.bookmarks));
  await putRecords("sessions", withId(plan.put.sessions));
}

// ---- Transport ----

type Target = Pick<Nearby, "host" | "port">;

async function call(to: Target, header: Record<string, unknown>, payload: Uint8Array) {
  const data = b64(pack({ v: 1, from: deviceId(), ...header }, payload)); // text: Android's IPC can't send raw bytes
  const reply = await invoke<ArrayBuffer>("plugin:lansync|send", { host: to.host, port: to.port, data });
  const { json, bin } = unpack<{ ok: boolean; error?: string }>(new Uint8Array(reply));
  if (!json.ok) throw new Error(json.error ?? "Sync failed.");
  return bin;
}

// Encrypted request to a paired device
async function request<T = Record<string, unknown>>(to: Target, key: string, op: string, body: object = {}, bin?: Uint8Array) {
  return unpack<T>(await open(key, await call(to, {}, await seal(key, pack({ op, ...body }, bin)))));
}

// ---- Pairing: ECDH keys confirmed by a 6-digit code on both screens. The responder commits to its nonce
// before seeing the initiator's, so a device in the middle can't steer both screens to the same code.

let pending: { from: string; name: string; pair: CryptoKeyPair; pub: Uint8Array; theirPub: Uint8Array; nr: Uint8Array } | undefined;
let onPairRequest: ((r: PairRequest) => void) | undefined;

async function respondPairing(op: string, from: string, body: Record<string, string>) {
  if (!onPairRequest) throw new Error("Open Sync on the other device first.");
  if (op === "pair-1") {
    const { pair, pub } = await newKeyPair();
    const nr = crypto.getRandomValues(new Uint8Array(16));
    pending = { from, name: String(body.name).slice(0, 60), pair, pub, theirPub: unb64(body.pk), nr };
    return { name: deviceName(), pk: b64(pub), commit: b64(await sha256(concat(pub, pending.theirPub, nr))) };
  }
  const p = pending;
  pending = undefined;
  if (!p || p.from !== from) throw new Error("Pairing failed. Try again.");
  const code = await pairCode(p.theirPub, p.pub, unb64(body.ni), p.nr);
  const key = await sharedKey(p.pair.privateKey, p.theirPub);
  onPairRequest({ name: p.name, code, accept: () => savePeer({ id: from, name: p.name, key, pairedAt: Date.now() }) });
  return { nr: b64(p.nr) };
}

export async function pairWith(peer: Nearby): Promise<PairRequest> {
  const { pair, pub } = await newKeyPair();
  const r1 = unpack<{ pk: string; commit: string }>(await call(peer, { op: "pair-1" }, pack({ name: deviceName(), pk: b64(pub) }))).json;
  const ni = crypto.getRandomValues(new Uint8Array(16));
  const { nr } = unpack<{ nr: string }>(await call(peer, { op: "pair-2" }, pack({ ni: b64(ni) }))).json;
  const theirPub = unb64(r1.pk);
  if (b64(await sha256(concat(theirPub, pub, unb64(nr)))) !== r1.commit) throw new Error("Pairing failed. Try again.");
  const code = await pairCode(pub, theirPub, ni, unb64(nr));
  const key = await sharedKey(pair.privateKey, theirPub);
  return { name: peer.name, code, accept: () => savePeer({ id: peer.id, name: peer.name, key, pairedAt: Date.now() }) };
}

// ---- Serving requests from other devices ----

async function serve(op: string, body: Record<string, unknown>, bin: Uint8Array, onChanged: () => void): Promise<{ json: object; bin?: Uint8Array }> {
  switch (op) {
    case "state":
      return { json: await collectState() };
    case "file": {
      const doc = (await listDocs()).find((d) => d.hash === body.hash);
      const bytes = doc && (await getFile(doc.id));
      if (!bytes) throw new Error("That book isn't on this device anymore.");
      return { json: {}, bin: new Uint8Array(bytes) };
    }
    case "put": {
      const doc = body.doc as SyncDoc;
      const removed = (await listTombstones()).some((t) => t.key === `doc:${doc.hash}`);
      if (!removed) await storeBook(doc, bin.slice().buffer);
      onChanged();
      return { json: {} };
    }
    case "apply": {
      const plan = planMerge(await collectState(), body.state as SyncState);
      await applyPlan(plan); // books were sent first with "put"
      onChanged();
      return { json: { changed: planSize(plan) } };
    }
    default:
      throw new Error("This device needs a newer LumaRead to sync.");
  }
}

async function handle(message: Uint8Array, onChanged: () => void): Promise<Uint8Array> {
  try {
    const { json: header, bin: payload } = unpack<{ from: string; op?: string }>(message);
    if (header.op === "pair-1" || header.op === "pair-2") return pack({ ok: true }, pack(await respondPairing(header.op, header.from, unpack<Record<string, string>>(payload).json)));
    const peer = (await listPeers()).find((p) => p.id === header.from);
    if (!peer) throw new Error("These devices aren't paired. Pair them again.");
    const inner = unpack<{ op: string }>(await open(peer.key, payload));
    const reply = await serve(inner.json.op, inner.json, inner.bin, onChanged);
    return pack({ ok: true }, await seal(peer.key, pack(reply.json, reply.bin)));
  } catch (e) {
    return pack({ ok: false, error: e instanceof Error ? e.message : "Sync failed." });
  }
}

// Visible to other devices (and able to answer them) until stopSync
export async function startSync(onChanged: () => void, onPair: (r: PairRequest) => void) {
  onPairRequest = onPair;
  const channel = new Channel<ArrayBuffer>();
  channel.onmessage = async (raw) => {
    const message = new Uint8Array(raw);
    const id = new DataView(raw).getUint32(0);
    const reply = await handle(message.subarray(4), onChanged);
    await invoke("plugin:lansync|respond", { id, data: b64(reply) });
  };
  await invoke("plugin:lansync|start", { id: deviceId(), name: deviceName(), onRequest: channel });
}

export function stopSync() {
  onPairRequest = undefined;
  pending = undefined;
  return invoke("plugin:lansync|stop").catch(() => undefined);
}

// Tauri rejects invoke() with the Rust error string, not an Error
export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const nearby = async () => (await invoke<Nearby[] | null>("plugin:lansync|peers")) ?? [];

// ---- Syncing with a paired device, both ways ----

export async function syncWith(peer: PeerDevice, at: Target, onStep: (text: string) => void): Promise<SyncSummary> {
  onStep("Comparing libraries…");
  const remote = (await request<SyncState>(at, peer.key, "state")).json;
  const plan = planMerge(await collectState(), remote);
  await applyPlan(plan, async (doc, i) => {
    onStep(`Copying “${doc.title}” (${i + 1} of ${plan.fetch.length})…`);
    return (await request(at, peer.key, "file", { hash: doc.hash })).bin.buffer;
  });

  const mine = await collectState();
  const theirs = new Set([...remote.docs.map((d) => d.hash), ...remote.removed]);
  const toSend = mine.docs.filter((d) => !theirs.has(d.hash));
  const idOf = new Map((await listDocs()).map((d) => [d.hash, d.id]));
  for (const [i, doc] of toSend.entries()) {
    onStep(`Sending “${doc.title}” (${i + 1} of ${toSend.length})…`);
    const bytes = await getFile(idOf.get(doc.hash)!);
    if (bytes) await request(at, peer.key, "put", { doc }, new Uint8Array(bytes));
  }

  onStep("Sending changes…");
  const { changed } = (await request<{ changed: number }>(at, peer.key, "apply", { state: mine })).json;
  await savePeer({ ...peer, lastSync: Date.now() });
  return { booksReceived: plan.fetch.length, booksSent: toSend.length, received: planSize(plan) - plan.fetch.length, sent: changed };
}
