import { Search, X } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { pdfAnchor, type Anchor } from "../../lib/anchor";
import { listAnnotations, listTexts, type Annotation, type DocText } from "../../lib/db";
import { Cover } from "../library/DocRow";
import type { LibraryItem } from "../library/types";
import { startAnchor } from "../reader/startAnchor";
import { searchAll, type ResultKind, type SearchResult } from "./search";

interface Props { items: LibraryItem[]; indexing: boolean; query: string; onQueryChange: (q: string) => void; onOpenAt: (item: LibraryItem, at?: Anchor) => void }

const TABS: { kind?: ResultKind; label: string }[] = [
  { label: "All" },
  { kind: "file", label: "Files" },
  { kind: "content", label: "Text" },
  { kind: "highlight", label: "Highlights" },
  { kind: "note", label: "Notes" },
];

function target(r: SearchResult): Anchor | undefined {
  if (r.annotation?.anchor) return startAnchor(r.annotation.anchor);
  if (!r.text) return undefined;
  return r.doc.format === "pdf" ? pdfAnchor(r.text.unit) : { v: 1, kind: "epub-section", href: r.text.href! };
}

export function SearchPage({ items, indexing, query, onQueryChange: setQuery, onOpenAt }: Props) {
  const [tab, setTab] = useState(0);
  const [corpus, setCorpus] = useState<{ texts: DocText[]; annotations: Annotation[] }>({ texts: [], annotations: [] });
  const deferred = useDeferredValue(query);

  // shortcut: whole library text held in memory; move to an inverted index past a few hundred books
  useEffect(() => {
    Promise.all([listTexts(), listAnnotations()]).then(([texts, annotations]) => setCorpus({ texts, annotations }));
  }, [indexing]);

  const byId = useMemo(() => new Map(items.map((i) => [i.doc.id, i])), [items]);
  const results = useMemo(() => searchAll(deferred, { docs: items.map((i) => i.doc), ...corpus }), [deferred, items, corpus]);
  const kind = TABS[tab].kind;
  const shown = kind ? results.filter((r) => r.kind === kind) : results;

  return (
    <div className="screen">
      {/* Desktop searches from the top bar; this box is the phone's */}
      <label className="search-box page-search">
        <Search size={18} aria-hidden="true" />
        <input type="search" placeholder="Search titles, book text, highlights and notes" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus aria-label="Search" />
        {query && <button className="icon-button" aria-label="Clear search" onClick={() => setQuery("")}><X size={18} /></button>}
      </label>

      <div className="tabs" role="tablist">
        {TABS.map((t, i) => (
          <button key={t.label} role="tab" aria-selected={tab === i} onClick={() => setTab(i)}>
            {t.label} <span className="count">{t.kind ? results.filter((r) => r.kind === t.kind).length : results.length}</span>
          </button>
        ))}
      </div>

      {indexing && <p className="muted small">Indexing your library… results may be incomplete.</p>}

      {deferred.trim().length < 2 ? (
        <p className="empty muted">Type at least two letters.</p>
      ) : shown.length === 0 ? (
        <p className="empty muted">No results for “{deferred.trim()}”.</p>
      ) : (
        <ul className="doc-list card">
          {shown.map((r, i) => (
            <li key={`${r.kind}-${r.doc.id}-${r.text?.unit ?? r.annotation?.id ?? i}`} className="doc-row">
              <button className="doc-open" onClick={() => onOpenAt(byId.get(r.doc.id)!, target(r))}>
                <Cover item={byId.get(r.doc.id)!} />
                <span className="doc-text">
                  <span className={r.kind === "file" ? "doc-title" : "doc-title result-title"}>{r.doc.title}</span>
                  {r.kind !== "file" && (
                    <span className="result-snippet">
                      {r.snippet.slice(0, r.match[0])}
                      <mark>{r.snippet.slice(...r.match)}</mark>
                      {r.snippet.slice(r.match[1])}
                    </span>
                  )}
                  <span className="muted small">
                    {[r.label, { file: "", content: "", highlight: "Highlight", note: "Note" }[r.kind]].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
