import { ArrowRight } from "lucide-react";
import { Cover, DocRow, ProgressBar } from "./DocRow";
import { ImportButton } from "./ImportButton";
import type { LibraryItem } from "./types";

interface Props {
  items: LibraryItem[]; // most recent first
  onOpen: (item: LibraryItem) => void;
  onRemove: (item: LibraryItem) => void;
  onImported: () => void;
  onStats: (item: LibraryItem) => void;
  onViewAll: () => void;
}

function greeting(hour = new Date().getHours()) {
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

export function HomePage({ items, onOpen, onRemove, onImported, onStats, onViewAll }: Props) {
  const current = items.find((i) => i.doc.openedAt && i.progress && i.progress.percent < 1);

  return (
    <div className="screen">
      <header className="page-header">
        <div>
          <h1>{greeting()}</h1>
          <p className="muted">Continue reading, or explore your library.</p>
        </div>
        <ImportButton onImported={onImported} />
      </header>

      {items.length === 0 ? (
        <section className="card empty">
          <h2>Your personal reading space</h2>
          <p className="muted">Import EPUB books and PDFs to start reading. Files stay on this device.</p>
        </section>
      ) : (
        <>
          {current && (
            <section className="card">
              <h2>Continue reading</h2>
              <div className="continue">
                <Cover item={current} large />
                <div className="continue-body">
                  <span className="doc-title">{current.doc.title}</span>
                  <span className="muted small">
                    {current.doc.author ? `${current.doc.author} · ` : ""}{Math.round(current.progress!.percent * 100)}% read
                  </span>
                  <div className="continue-actions">
                    <ProgressBar percent={current.progress!.percent} />
                    <button className="pill" onClick={() => onOpen(current)}>Continue <ArrowRight size={14} /></button>
                  </div>
                </div>
              </div>
            </section>
          )}

          <section className="card">
            <div className="section-header">
              <h2>Recent files</h2>
              {items.length > 5 && <button className="link" onClick={onViewAll}>View all <ArrowRight size={14} /></button>}
            </div>
            <ul className="doc-list">
              {items.slice(0, 5).map((item) => (
                <DocRow key={item.doc.id} item={item} onOpen={() => onOpen(item)} onRemove={() => onRemove(item)} onStats={() => onStats(item)} />
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
