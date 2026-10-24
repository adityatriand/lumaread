import { useEffect, useRef, useState } from "react";
import { AppShell, type View } from "./components/AppShell";
import { ConfirmHost, confirmDanger } from "./components/ConfirmDialog";
import type { Anchor } from "./lib/anchor";
import { deleteDoc, deleteProgress, getFile, getProgress, listDocs, listProgress, patchDoc, saveProgress, type DocMeta } from "./lib/db";
import { EditDetailsDialog } from "./features/library/EditDetailsDialog";
import { HomePage } from "./features/library/HomePage";
import { BookmarksPage } from "./features/bookmarks/BookmarksPage";
import { Library } from "./features/library/Library";
import type { LibraryItem } from "./features/library/types";
import { NotebookPage } from "./features/notebook/NotebookPage";
import { ReaderView } from "./features/reader/ReaderView";
import { indexPending } from "./features/search/indexText";
import { SearchPage } from "./features/search/SearchPage";
import { StatsPage } from "./features/stats/StatsPage";
import { SyncPage } from "./features/sync/SyncPage";
import { applyAppTheme, loadPrefs, storePrefs, type ReadingPrefs } from "./features/settings/prefs";
import { SettingsPage } from "./features/settings/SettingsPage";
import "@fontsource-variable/source-serif-4/wght.css";
import "./App.css";

interface OpenDoc { doc: DocMeta; bytes: ArrayBuffer; initial?: Anchor }

export default function App() {
  const [view, setView] = useState<View>("home");
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [open, setOpen] = useState<OpenDoc>();
  const [prefs, setPrefs] = useState(loadPrefs);
  const [error, setError] = useState<string>();
  const [indexing, setIndexing] = useState(false);
  const [statsDocId, setStatsDocId] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<DocMeta>();
  const openIdRef = useRef<string>(null);
  // Opened at a highlight, note or search hit: last-read stays put until the reader moves away from that spot.
  // Holds the first location reported after the jump (undefined = not reported yet, null = not a jump)
  const jumpRef = useRef<string | null | undefined>(null);

  async function refresh() {
    try {
      const [docs, progress] = await Promise.all([listDocs(), listProgress()]);
      const byDoc = new Map(progress.map((p) => [p.docId, p]));
      setItems(
        docs
          .map((doc) => ({ doc, progress: byDoc.get(doc.id) }))
          .sort((a, b) => (b.doc.openedAt ?? b.doc.addedAt) - (a.doc.openedAt ?? a.doc.addedAt)),
      );
    } catch {
      setError("Your library could not be loaded.");
    }
  }

  // Builds search text (and spots scanned PDFs) for new imports in the background
  function indexLibrary() {
    setIndexing(true);
    indexPending(() => {
      setIndexing(false);
      refresh();
    });
  }

  function imported() {
    refresh();
    indexLibrary();
  }

  useEffect(() => {
    // Ask the webview not to evict the library under storage pressure
    navigator.storage?.persist?.();
    refresh();
    indexLibrary();
  }, []);

  async function openDoc({ doc }: LibraryItem, at?: Anchor) {
    const [bytes, progress] = await Promise.all([getFile(doc.id), getProgress(doc.id)]);
    if (!bytes) return setError(`The file for "${doc.title}" is missing. Remove it and import it again.`);
    const opened = { ...doc, openedAt: Date.now() };
    await patchDoc(doc.id, { openedAt: opened.openedAt });
    openIdRef.current = doc.id;
    jumpRef.current = at ? undefined : null;
    setOpen({ doc: opened, bytes, initial: at ?? progress?.anchor });
  }

  async function removeDoc({ doc }: LibraryItem) {
    const ok = await confirmDanger(
      `Remove “${doc.title}”?`,
      "The book, its reading progress, highlights, notes, bookmarks and reading stats are deleted from this device. Export your notes first if you want to keep them. Sync won't copy it back here.",
      "Remove",
    );
    if (!ok) return;
    await deleteDoc(doc.id).catch(() => setError(`"${doc.title}" could not be removed.`));
    refresh();
  }

  // Back to the first page and "Not started"; highlights, notes, bookmarks and reading stats stay
  async function resetProgress({ doc }: LibraryItem) {
    const ok = await confirmDanger(
      `Reset progress in “${doc.title}”?`,
      "Your place in the book is cleared and it opens at the beginning. Highlights, notes, bookmarks and reading stats are kept.",
      "Reset",
    );
    if (!ok) return;
    await Promise.all([deleteProgress(doc.id), patchDoc(doc.id, { openedAt: undefined })]).catch(() => setError(`Progress in "${doc.title}" could not be reset.`));
    refresh();
  }

  function onLocation(anchor: Anchor, percent: number, label: string) {
    if (!openIdRef.current) return;
    if (jumpRef.current !== null) {
      const key = JSON.stringify(anchor);
      jumpRef.current ??= key;
      if (jumpRef.current === key) return;
      jumpRef.current = null;
    }
    saveProgress({ docId: openIdRef.current, anchor, percent, label }).catch(() => setError("Reading progress could not be saved."));
  }

  function changePrefs(p: ReadingPrefs) {
    setPrefs(p);
    storePrefs(p);
    applyAppTheme(p.appTheme);
  }

  function close() {
    openIdRef.current = null;
    setOpen(undefined);
    refresh();
  }

  const banner = error && (
    <div className="toast" role="alert">
      <p>{error}</p>
      <button onClick={() => setError(undefined)}>Dismiss</button>
    </div>
  );

  if (open) {
    return (
      <>
        {banner}
        <ConfirmHost />
        <ReaderView key={open.doc.id} {...open} prefs={prefs} onPrefsChange={changePrefs} onLocation={onLocation} onClose={close} />
      </>
    );
  }

  const showStats = (item: LibraryItem) => (setStatsDocId(item.doc.id), setView("stats"));
  const pageProps = { items, onOpen: (item: LibraryItem) => openDoc(item), onRemove: removeDoc, onImported: imported, onStats: showStats, onEdit: (item: LibraryItem) => setEditing(item.doc), onReset: resetProgress };
  return (
    <AppShell view={view} query={query} onNavigate={setView} onSearch={(q) => (setQuery(q), q && setView("search"))}>
      {banner}
      <ConfirmHost />
      {view === "home" && <HomePage {...pageProps} onViewAll={() => setView("library")} />}
      {view === "library" && <Library {...pageProps} />}
      {(view === "notebook" || view === "notes") && <NotebookPage key={view} items={items} initialTab={view === "notes" ? "notes" : "highlights"} onOpenAt={openDoc} />}
      {view === "bookmarks" && <BookmarksPage items={items} onOpenAt={openDoc} />}
      {view === "stats" && <StatsPage items={items} docId={statsDocId} onDocChange={setStatsDocId} onOpen={(item) => openDoc(item)} />}
      {view === "search" && <SearchPage items={items} indexing={indexing} query={query} onQueryChange={setQuery} onOpenAt={openDoc} />}
      {view === "sync" && <SyncPage onChanged={imported} />}
      {view === "settings" && <SettingsPage prefs={prefs} onChange={changePrefs} />}
      {editing && (
        <EditDetailsDialog
          doc={editing}
          onSave={(patch) => patchDoc(editing.id, { ...patch, editedAt: Date.now() }).then(refresh, () => setError("Could not save the details."))}
          onClose={() => setEditing(undefined)}
        />
      )}
    </AppShell>
  );
}
