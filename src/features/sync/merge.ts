import type { Annotation, Bookmark, DocMeta, Progress, Session, Tombstone } from "../../lib/db";

// What one device sends another. Device-local doc ids are replaced by the book's SHA-256 (`doc`), the one id
// both devices share; derived data (search text, OCR, page breaks) is rebuilt on arrival instead of sent.
type OnDoc<T extends { docId: string }> = Omit<T, "docId"> & { doc: string };
export type SyncDoc = Pick<DocMeta, "hash" | "title" | "author" | "format" | "size" | "addedAt" | "cover" | "fileName" | "editedAt" | "source" | "shelves">;
export interface SyncState {
  docs: SyncDoc[];
  removed: string[]; // hashes this device removed: don't send those books here
  progress: OnDoc<Progress>[];
  annotations: OnDoc<Annotation>[];
  bookmarks: OnDoc<Bookmark>[];
  sessions: OnDoc<Session>[];
  tombstones: Tombstone[]; // record deletions to pass on (never "doc": a removal stays on its device)
}

export interface MergePlan {
  fetch: SyncDoc[]; // books to copy here
  docPatches: { hash: string; patch: Pick<DocMeta, "title" | "author" | "shelves" | "editedAt"> }[];
  put: { progress: OnDoc<Progress>[]; annotations: OnDoc<Annotation>[]; bookmarks: OnDoc<Bookmark>[]; sessions: OnDoc<Session>[] };
  remove: { annotations: string[]; bookmarks: string[]; progress: string[] }; // ids; book hashes for progress
  tombstones: Tombstone[]; // remote tombstones newer than ours
}

const byKey = <T>(list: T[], key: (x: T) => string) => new Map(list.map((x) => [key(x), x]));
const bookmarkTime = (b: Pick<Bookmark, "createdAt" | "updatedAt">) => b.updatedAt ?? b.createdAt;

// How `local` takes in `remote`. Newest change wins per record, and a deletion counts as a change: a record
// survives only if it was edited after the newest deletion of it. Records of books this device doesn't have
// (and won't fetch) are skipped.
export function planMerge(local: SyncState, remote: SyncState): MergePlan {
  const removedHere = new Set(local.removed);
  const localDocs = byKey(local.docs, (d) => d.hash);
  const fetch = remote.docs.filter((d) => !localDocs.has(d.hash) && !removedHere.has(d.hash));
  const present = new Set([...localDocs.keys(), ...fetch.map((d) => d.hash)]);

  const docPatches = remote.docs.flatMap((r) => {
    const l = localDocs.get(r.hash);
    return l && (r.editedAt ?? 0) > (l.editedAt ?? 0) ? [{ hash: r.hash, patch: { title: r.title, author: r.author, shelves: r.shelves, editedAt: r.editedAt } }] : [];
  });

  const localTombs = byKey(local.tombstones, (t) => t.key);
  const tombstones = remote.tombstones.filter((t) => t.kind !== "doc" && t.deletedAt > (localTombs.get(t.key)?.deletedAt ?? -1));
  const deletedAt = (key: string) => Math.max(localTombs.get(key)?.deletedAt ?? -1, ...tombstones.filter((t) => t.key === key).map((t) => t.deletedAt));

  function records<T extends { doc: string }>(kind: string, mine: T[], theirs: T[], id: (x: T) => string, time: (x: T) => number) {
    const ours = byKey(mine, id);
    const put = theirs.filter((r) => present.has(r.doc) && time(r) > (ours.has(id(r)) ? time(ours.get(id(r))!) : -1) && time(r) > deletedAt(`${kind}:${id(r)}`));
    const remove = mine.filter((l) => time(l) < deletedAt(`${kind}:${id(l)}`)).map(id);
    return { put, remove };
  }

  const annotations = records("annotation", local.annotations, remote.annotations, (a) => a.id, (a) => a.updatedAt);
  const bookmarks = records("bookmark", local.bookmarks, remote.bookmarks, (b) => b.id, bookmarkTime);
  const progress = records("progress", local.progress, remote.progress, (p) => p.doc, (p) => p.updatedAt);
  // Sessions only grow (a book open on a device keeps extending its session); never deleted by sync
  const sessions = records("session", local.sessions, remote.sessions, (s) => s.id, (s) => s.endedAt).put;

  return {
    fetch,
    docPatches,
    put: { progress: progress.put, annotations: annotations.put, bookmarks: bookmarks.put, sessions },
    remove: { annotations: annotations.remove, bookmarks: bookmarks.remove, progress: progress.remove },
    tombstones,
  };
}

export function planSize(p: MergePlan): number {
  return p.fetch.length + p.docPatches.length + Object.values(p.put).reduce((a, l) => a + l.length, 0) + Object.values(p.remove).reduce((a, l) => a + l.length, 0);
}
