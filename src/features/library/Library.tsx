import { useState } from "react";
import { Select } from "../../components/Select";
import type { DocMeta } from "../../lib/db";
import { DocRow } from "./DocRow";
import { ManageShelvesDialog } from "./ManageShelvesDialog";
import { ImportButton } from "./ImportButton";
import type { LibraryItem } from "./types";

interface Props {
  items: LibraryItem[];
  onOpen: (item: LibraryItem) => void;
  onRemove: (item: LibraryItem) => void;
  onImported: () => void;
  onStats: (item: LibraryItem) => void;
  onSummary: (item: LibraryItem) => void;
  onEdit: (item: LibraryItem) => void;
  onReset: (item: LibraryItem) => void;
  onShelves: (item: LibraryItem) => void;
  onRenameShelf: (from: string, to: string) => Promise<void>;
  onDeleteShelf: (name: string) => Promise<void>;
}

const FORMATS: { label: string; match?: (d: DocMeta) => boolean }[] = [
  { label: "All" },
  { label: "EPUB", match: (d) => d.format === "epub" && !d.source },
  { label: "PDF", match: (d) => d.format === "pdf" },
  { label: "Comics", match: (d) => d.source === "cbz" },
  { label: "Text", match: (d) => d.source === "txt" || d.source === "md" },
];

type Status = "all" | "reading" | "unread" | "finished";
type Sort = "recent" | "added" | "title" | "author" | "progress";
interface View { status: Status; sort: Sort; shelf: string }

const statusOf = ({ doc, progress }: LibraryItem): Exclude<Status, "all"> =>
  (progress?.percent ?? 0) >= 0.99 ? "finished" : progress || doc.openedAt ? "reading" : "unread";

const byText = (a = "", b = "") => (a && b ? a.localeCompare(b) : a ? -1 : b ? 1 : 0); // missing values last
const SORTS: Record<Sort, (a: LibraryItem, b: LibraryItem) => number> = {
  recent: () => 0, // items arrive most recently opened first
  added: (a, b) => b.doc.addedAt - a.doc.addedAt,
  title: (a, b) => byText(a.doc.title, b.doc.title),
  author: (a, b) => byText(a.doc.author, b.doc.author) || byText(a.doc.title, b.doc.title),
  progress: (a, b) => (b.progress?.percent ?? 0) - (a.progress?.percent ?? 0),
};

const VIEW_KEY = "library-view";
function loadView(): View {
  const fallback: View = { status: "all", sort: "recent", shelf: "" };
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(VIEW_KEY) ?? "{}") };
  } catch {
    return fallback;
  }
}

export function Library({ items, onOpen, onRemove, onImported, onStats, onSummary, onEdit, onReset, onShelves, onRenameShelf, onDeleteShelf }: Props) {
  const [tab, setTab] = useState(0);
  const [view, setView] = useState(loadView);
  const [managing, setManaging] = useState(false);
  const shelves = [...new Set(items.flatMap((i) => i.doc.shelves ?? []))].sort((a, b) => a.localeCompare(b));
  const shelf = shelves.includes(view.shelf) || view.shelf === "-" ? view.shelf : ""; // a shelf emptied elsewhere falls back to all

  function change(patch: Partial<View>) {
    const next = { ...view, ...patch };
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify(next));
    } catch {
      // the choice just won't be remembered
    }
  }

  const match = FORMATS[tab].match;
  const shown = items
    .filter((i) => !match || match(i.doc))
    .filter((i) => view.status === "all" || statusOf(i) === view.status)
    .filter((i) => !shelf || (shelf === "-" ? !i.doc.shelves?.length : i.doc.shelves?.includes(shelf)))
    .sort(SORTS[view.sort]);
  // Format tabs appear once a library holds that kind of book
  const tabs = FORMATS.map((f, i) => ({ ...f, i, count: f.match ? items.filter((it) => f.match!(it.doc)).length : items.length })).filter((t) => !t.match || t.count);

  return (
    <div className="screen">
      <header className="page-header">
        <h1>Library</h1>
        <ImportButton onImported={onImported} />
      </header>

      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.label} role="tab" aria-selected={tab === t.i} onClick={() => setTab(t.i)}>
            {t.label} <span className="count">{t.count}</span>
          </button>
        ))}
      </div>

      {items.length > 0 && (
        <div className="filter-row library-filters">
          <Select
            label="Shelf"
            className="doc-filter"
            value={shelf}
            options={[{ value: "", label: "All shelves" }, ...shelves.map((s) => ({ value: s, label: s })), { value: "-", label: "Not on a shelf" }]}
            onChange={(s) => change({ shelf: s })}
          />
          <Select
            label="Status"
            className="doc-filter"
            value={view.status}
            options={[
              { value: "all", label: "Any status" },
              { value: "reading", label: "Reading" },
              { value: "unread", label: "Not started" },
              { value: "finished", label: "Finished" },
            ]}
            onChange={(s) => change({ status: s as Status })}
          />
          <Select
            label="Sort"
            className="doc-filter"
            value={view.sort}
            options={[
              { value: "recent", label: "Recently read" },
              { value: "added", label: "Recently added" },
              { value: "title", label: "Title A–Z" },
              { value: "author", label: "Author A–Z" },
              { value: "progress", label: "Most progress" },
            ]}
            onChange={(s) => change({ sort: s as Sort })}
          />
          <button className="link" onClick={() => setManaging(true)}>Manage shelves</button>
        </div>
      )}

      {managing && (
        <ManageShelvesDialog
          shelves={shelves.map((name) => ({ name, count: items.filter((i) => i.doc.shelves?.includes(name)).length }))}
          onRename={async (from, to) => {
            await onRenameShelf(from, to);
            if (view.shelf === from) change({ shelf: to });
          }}
          onDelete={onDeleteShelf}
          onClose={() => setManaging(false)}
        />
      )}

      {shown.length === 0 ? (
        <p className="empty muted">{items.length ? "No books match these filters." : "Your library is empty. Import an EPUB, PDF, comic (CBZ) or text file to start reading. Files stay on this device."}</p>
      ) : (
        <ul className="doc-list card">
          {shown.map((item) => (
            <DocRow key={item.doc.id} item={item} onOpen={() => onOpen(item)} onRemove={() => onRemove(item)} onStats={() => onStats(item)} onSummary={() => onSummary(item)} onEdit={() => onEdit(item)} onReset={() => onReset(item)} onShelves={() => onShelves(item)} />
          ))}
        </ul>
      )}
    </div>
  );
}
