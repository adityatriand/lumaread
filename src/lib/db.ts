import { titleFromName } from "../features/library/titleFromName";
import { epubAnchor, pdfAnchor, type Anchor, type RangeAnchor, type Rect } from "./anchor";

export type Format = "pdf" | "epub";

export interface DocMeta {
  id: string;
  title: string;
  author?: string;
  format: Format;
  size: number;
  hash: string;
  addedAt: number;
  openedAt?: number;
  cover?: string; // small JPEG data URL
  fileName?: string; // as imported; the library keeps its own copy, so renames on disk don't reach it
  epubLocations?: string; // epub.js locations (stable page breaks), computed once per EPUB
  textIndexed?: boolean; // texts store holds every page/section
  pageCount?: number; // PDF pages, set when indexed
  scanned?: boolean; // PDF whose pages are mostly images without a text layer
  indexFailed?: boolean; // text extraction threw; not retried automatically
}

export interface Progress {
  docId: string;
  anchor: Anchor;
  percent: number;
  label: string; // "Page 4 / 120" or chapter title
  updatedAt: number;
  version: number; // bumped per write; single device, so last write wins
}

export const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink"] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

export interface Annotation {
  id: string;
  docId: string;
  anchor?: RangeAnchor; // absent for a note on the whole document
  label?: string; // "p. 12" or chapter title, captured when created
  color: HighlightColor;
  note?: string;
  createdAt: number;
  updatedAt: number;
  version: number;
}

// Searchable text per PDF page or EPUB spine section; OCR text replaces an empty scanned page
export interface DocText {
  docId: string;
  unit: number; // PDF page number, or EPUB spine index
  label: string; // "Page 12" or chapter title
  href?: string; // EPUB section href, for jumping to results
  text: string;
  source: "text" | "ocr";
}

// One stretch of reading in one book; only time with recent activity on a visible window counts
export interface Session {
  id: string;
  docId: string;
  day: string; // local YYYY-MM-DD the session started
  startedAt: number;
  endedAt: number;
  activeMs: number;
  pages: number; // distinct pages (PDF) or screens (EPUB) seen
  startPercent: number;
  endPercent: number;
}

export interface OcrWord { text: string; box: Rect; line: number }
export interface OcrPage { docId: string; page: number; words: OcrWord[] }

let dbPromise: Promise<IDBDatabase> | undefined;

function openDb() {
  return (dbPromise ??= new Promise((resolve, reject) => {
    const r = indexedDB.open("lumaread", 5);
    r.onupgradeneeded = (e) => {
      const db = r.result;
      if (e.oldVersion < 1) {
        db.createObjectStore("docs", { keyPath: "id" }).createIndex("hash", "hash", { unique: true });
        // File bytes live apart from metadata so listing the library never loads books
        db.createObjectStore("files");
      }
      if (e.oldVersion < 2) {
        const progress = db.createObjectStore("progress", { keyPath: "docId" });
        // v1 kept the reader library's raw location on the doc; move it into a versioned anchor
        r.transaction!.objectStore("docs").openCursor().onsuccess = (ev) => {
          const cursor = (ev.target as IDBRequest<IDBCursorWithValue | null>).result;
          if (!cursor) return;
          const { progress: old, ...doc } = cursor.value;
          if (old) {
            const anchor = doc.format === "pdf" ? pdfAnchor(Number(old.location) || 1) : epubAnchor(old.location);
            progress.put({ docId: doc.id, anchor, percent: old.percent, label: "", updatedAt: Date.now(), version: 1 });
          }
          cursor.update(doc);
          cursor.continue();
        };
      }
      if (e.oldVersion < 3) {
        db.createObjectStore("annotations", { keyPath: "id" }).createIndex("docId", "docId");
        db.createObjectStore("texts", { keyPath: ["docId", "unit"] }).createIndex("docId", "docId");
        db.createObjectStore("ocr", { keyPath: ["docId", "page"] }).createIndex("docId", "docId");
      }
      if (e.oldVersion < 4) {
        db.createObjectStore("sessions", { keyPath: "id" }).createIndex("docId", "docId");
      }
      if (e.oldVersion < 5) {
        // Earlier imports kept "Title - Author" filenames whole; split them so the author shows
        r.transaction!.objectStore("docs").openCursor().onsuccess = (ev) => {
          const cursor = (ev.target as IDBRequest<IDBCursorWithValue | null>).result;
          if (!cursor) return;
          const doc = cursor.value as DocMeta;
          if (!doc.author) {
            const { title, author } = titleFromName(`${doc.title}.x`);
            if (author) cursor.update({ ...doc, title, author });
          }
          cursor.continue();
        };
      }
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}

function req<T>(r: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(t: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = t.onabort = () => reject(t.error);
  });
}

async function getAll<T>(store: string, docId?: string): Promise<T[]> {
  const s = (await openDb()).transaction(store).objectStore(store);
  return req(docId === undefined ? s.getAll() : s.index("docId").getAll(docId));
}

async function getOne<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  return req((await openDb()).transaction(store).objectStore(store).get(key));
}

async function putAll(store: string, values: unknown[]) {
  const t = (await openDb()).transaction(store, "readwrite");
  for (const v of values) t.objectStore(store).put(v);
  return done(t);
}

export const listDocs = () => getAll<DocMeta>("docs");
export const listProgress = () => getAll<Progress>("progress");
export const getProgress = (docId: string) => getOne<Progress>("progress", docId);
export const getFile = (id: string) => getOne<ArrayBuffer>("files", id);

export const listAnnotations = (docId?: string) => getAll<Annotation>("annotations", docId);
export const saveAnnotation = (a: Annotation) => putAll("annotations", [a]);
export async function deleteAnnotation(id: string) {
  const t = (await openDb()).transaction("annotations", "readwrite");
  t.objectStore("annotations").delete(id);
  return done(t);
}

export const listTexts = (docId?: string) => getAll<DocText>("texts", docId);
export const saveTexts = (texts: DocText[]) => putAll("texts", texts);
export const saveOcrPage = (p: OcrPage) => putAll("ocr", [p]);
export const listSessions = (docId?: string) => getAll<Session>("sessions", docId);
export const saveSession = (s: Session) => putAll("sessions", [s]);
export const listOcrPages = (docId: string) => getAll<OcrPage>("ocr", docId);

export async function findByHash(hash: string): Promise<DocMeta | undefined> {
  return req((await openDb()).transaction("docs").objectStore("docs").index("hash").get(hash));
}

export async function addDoc(meta: DocMeta, bytes: ArrayBuffer) {
  const t = (await openDb()).transaction(["docs", "files"], "readwrite");
  t.objectStore("docs").add(meta);
  t.objectStore("files").put(bytes, meta.id);
  return done(t);
}

// Read-modify-write in one transaction so background work (indexing, OCR) never clobbers newer fields
export async function patchDoc(id: string, patch: Partial<DocMeta>) {
  const t = (await openDb()).transaction("docs", "readwrite");
  const store = t.objectStore("docs");
  store.get(id).onsuccess = (e) => {
    const doc = (e.target as IDBRequest<DocMeta | undefined>).result;
    if (doc) store.put({ ...doc, ...patch });
  };
  return done(t);
}

export async function saveProgress(p: Omit<Progress, "updatedAt" | "version">) {
  const t = (await openDb()).transaction("progress", "readwrite");
  const store = t.objectStore("progress");
  // Callback, not await: the read and write must share one live transaction
  store.get(p.docId).onsuccess = (e) => {
    const prev = (e.target as IDBRequest<Progress | undefined>).result;
    store.put({ ...p, updatedAt: Date.now(), version: (prev?.version ?? 0) + 1 });
  };
  return done(t);
}

const DOC_STORES = ["docs", "files", "progress", "annotations", "texts", "ocr", "sessions"];

// Removes the document and everything derived from it in one transaction
export async function deleteDoc(id: string) {
  const t = (await openDb()).transaction(DOC_STORES, "readwrite");
  t.objectStore("docs").delete(id);
  t.objectStore("files").delete(id);
  t.objectStore("progress").delete(id);
  for (const store of ["annotations", "texts", "ocr", "sessions"]) {
    t.objectStore(store).index("docId").openKeyCursor(IDBKeyRange.only(id)).onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursor | null>).result;
      if (!cursor) return;
      t.objectStore(store).delete(cursor.primaryKey);
      cursor.continue();
    };
  }
  return done(t);
}
