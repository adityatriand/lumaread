import { useEffect, useRef, useState } from "react";
import { AppShell, type View } from "./components/AppShell";
import type { Anchor } from "./lib/anchor";
import { deleteDoc, getFile, getProgress, listDocs, listProgress, patchDoc, saveProgress, type DocMeta } from "./lib/db";
import { HomePage } from "./features/library/HomePage";
import { Library } from "./features/library/Library";
import type { LibraryItem } from "./features/library/types";
import { NotebookPage } from "./features/notebook/NotebookPage";
import { ReaderView } from "./features/reader/ReaderView";
import { indexPending } from "./features/search/indexText";
import { SearchPage } from "./features/search/SearchPage";
import { loadPrefs, storePrefs, type ReadingPrefs } from "./features/settings/prefs";
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
  const openIdRef = useRef<string>(null);

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
    setOpen({ doc: opened, bytes, initial: at ?? progress?.anchor });
  }

  async function removeDoc({ doc }: LibraryItem) {
    if (!confirm(`Remove "${doc.title}" from this device? Its reading progress will be lost.`)) return;
    await deleteDoc(doc.id).catch(() => setError(`"${doc.title}" could not be removed.`));
    refresh();
  }

  function onLocation(anchor: Anchor, percent: number, label: string) {
    if (!openIdRef.current) return;
    saveProgress({ docId: openIdRef.current, anchor, percent, label }).catch(() => setError("Reading progress could not be saved."));
  }

  function changePrefs(p: ReadingPrefs) {
    setPrefs(p);
    storePrefs(p);
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
        <ReaderView key={open.doc.id} {...open} prefs={prefs} onPrefsChange={changePrefs} onLocation={onLocation} onClose={close} />
      </>
    );
  }

  const pageProps = { items, onOpen: (item: LibraryItem) => openDoc(item), onRemove: removeDoc, onImported: imported };
  return (
    <AppShell view={view} onNavigate={setView}>
      {banner}
      {view === "home" && <HomePage {...pageProps} onViewAll={() => setView("library")} />}
      {view === "library" && <Library {...pageProps} />}
      {view === "notebook" && <NotebookPage items={items} onOpenAt={openDoc} />}
      {view === "search" && <SearchPage items={items} indexing={indexing} onOpenAt={openDoc} />}
      {view === "settings" && <SettingsPage prefs={prefs} onChange={changePrefs} />}
    </AppShell>
  );
}
