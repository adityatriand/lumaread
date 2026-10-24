import { useEffect, useMemo, useState, type FormEvent } from "react";
import { confirmDanger } from "../../components/ConfirmDialog";
import { Select } from "../../components/Select";
import type { Anchor } from "../../lib/anchor";
import { deleteBookmark, listBookmarks, saveBookmark, type Bookmark } from "../../lib/db";
import { timeAgo } from "../../lib/format";
import type { LibraryItem } from "../library/types";
import { byPlace } from "../reader/BookmarkMenu";

interface Props { items: LibraryItem[]; onOpenAt: (item: LibraryItem, at?: Anchor) => void }

export function BookmarksPage({ items, onOpenAt }: Props) {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [docId, setDocId] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string }>();
  const [message, setMessage] = useState<string>();
  const byId = useMemo(() => new Map(items.map((i) => [i.doc.id, i])), [items]);

  useEffect(() => {
    listBookmarks().then(setBookmarks, () => setMessage("Your bookmarks could not be loaded."));
  }, []);

  // Grouped by book, then in reading order within it
  const shown = bookmarks
    .filter((b) => byId.has(b.docId) && (!docId || b.docId === docId))
    .sort((a, b) => byId.get(a.docId)!.doc.title.localeCompare(byId.get(b.docId)!.doc.title) || byPlace(a, b));

  async function rename(e: FormEvent, b: Bookmark) {
    e.preventDefault();
    const name = renaming!.name.trim() || b.label;
    setRenaming(undefined);
    if (name === b.name) return;
    const next = { ...b, name, updatedAt: Date.now() };
    try {
      await saveBookmark(next);
      setBookmarks((list) => list.map((x) => (x.id === b.id ? next : x)));
    } catch {
      setMessage("Could not save.");
    }
  }

  async function remove(b: Bookmark) {
    if (!(await confirmDanger(`Delete the bookmark “${b.name}”?`, "It's removed from this device and, at the next sync, from your other devices."))) return;
    deleteBookmark(b.id).then(() => setBookmarks((list) => list.filter((x) => x.id !== b.id)), () => setMessage("Could not delete."));
  }

  return (
    <div className="screen">
      <header className="page-header">
        <h1>Bookmarks</h1>
      </header>

      <div className="toolbar-row">
        <Select
          label="Document"
          className="doc-filter"
          value={docId}
          options={[{ value: "", label: "All documents" }, ...items.map((i) => ({ value: i.doc.id, label: i.doc.title }))]}
          onChange={setDocId}
        />
      </div>

      {shown.length === 0 ? (
        <p className="empty muted">Tap the bookmark icon while reading to name and save a place.</p>
      ) : (
        <ul className="note-list">
          {shown.map((b) => {
            const item = byId.get(b.docId)!;
            return (
              <li key={b.id} className="note-card">
                {renaming?.id === b.id ? (
                  <form className="bookmark-add" onSubmit={(e) => rename(e, b)}>
                    <input
                      autoFocus
                      type="text"
                      value={renaming.name}
                      maxLength={120}
                      aria-label="Bookmark name"
                      onChange={(e) => setRenaming({ id: b.id, name: e.currentTarget.value })}
                      onKeyDown={(e) => e.key === "Escape" && setRenaming(undefined)}
                    />
                    <button className="button primary" type="submit">Save</button>
                  </form>
                ) : (
                  <button className="note-open" onClick={() => onOpenAt(item, b.anchor)}>
                    <span className="note-text">{b.name}</span>
                    <span className="muted small">{[item.doc.title, b.name !== b.label && b.label, timeAgo(b.createdAt)].filter(Boolean).join(" · ")}</span>
                  </button>
                )}
                <div className="note-actions">
                  <button className="link" onClick={() => setRenaming({ id: b.id, name: b.name })}>Rename</button>
                  <button className="link" onClick={() => remove(b)}>Delete</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {message && <div className="toast info" role="status" onClick={() => setMessage(undefined)}>{message}</div>}
    </div>
  );
}
