import { useState } from "react";
import type { Format } from "../../lib/db";
import { DocRow } from "./DocRow";
import { ImportButton } from "./ImportButton";
import type { LibraryItem } from "./types";

interface Props {
  items: LibraryItem[];
  onOpen: (item: LibraryItem) => void;
  onRemove: (item: LibraryItem) => void;
  onImported: () => void;
  onStats: (item: LibraryItem) => void;
}

const TABS: { label: string; format?: Format }[] = [{ label: "All" }, { label: "EPUB", format: "epub" }, { label: "PDF", format: "pdf" }];

export function Library({ items, onOpen, onRemove, onImported, onStats }: Props) {
  const [tab, setTab] = useState(0);
  const format = TABS[tab].format;
  const shown = format ? items.filter((i) => i.doc.format === format) : items;

  return (
    <div className="screen">
      <header className="page-header">
        <h1>Library</h1>
        <ImportButton onImported={onImported} />
      </header>

      <div className="tabs" role="tablist">
        {TABS.map((t, i) => (
          <button key={t.label} role="tab" aria-selected={tab === i} onClick={() => setTab(i)}>
            {t.label} <span className="count">{t.format ? items.filter((it) => it.doc.format === t.format).length : items.length}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="empty muted">{items.length ? "Nothing here yet." : "Your library is empty. Import an EPUB or PDF to start reading. Files stay on this device."}</p>
      ) : (
        <ul className="doc-list card">
          {shown.map((item) => (
            <DocRow key={item.doc.id} item={item} onOpen={() => onOpen(item)} onRemove={() => onRemove(item)} onStats={() => onStats(item)} />
          ))}
        </ul>
      )}
    </div>
  );
}
