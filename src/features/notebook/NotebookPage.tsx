import { Download, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Anchor } from "../../lib/anchor";
import { deleteAnnotation, listAnnotations, saveAnnotation, type Annotation } from "../../lib/db";
import { timeAgo } from "../../lib/format";
import { saveTextFile } from "../../lib/saveFile";
import type { LibraryItem } from "../library/types";
import { startAnchor } from "../reader/startAnchor";
import { ShareQuoteDialog } from "../share/ShareQuoteDialog";
import { AnnotationEditor } from "./AnnotationEditor";
import { toCsv, toMarkdown, type ExportRow } from "./exportNotes";

interface Props { items: LibraryItem[]; initialTab?: Tab; onOpenAt: (item: LibraryItem, at?: Anchor) => void }

type Tab = "highlights" | "notes";

export function NotebookPage({ items, initialTab = "highlights", onOpenAt }: Props) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [docId, setDocId] = useState("");
  const [editing, setEditing] = useState<Annotation>();
  const [message, setMessage] = useState<string>();
  const [sharing, setSharing] = useState<Annotation>();

  const byId = useMemo(() => new Map(items.map((i) => [i.doc.id, i])), [items]);

  useEffect(() => {
    listAnnotations().then(setAnnotations, () => setMessage("Your notebook could not be loaded."));
  }, []);

  const inScope = annotations.filter((a) => byId.has(a.docId) && (!docId || a.docId === docId));
  const shown = inScope
    .filter((a) => (tab === "highlights" ? a.anchor : a.note))
    .sort((a, b) => b.updatedAt - a.updatedAt);

  async function persist(a: Annotation) {
    await saveAnnotation(a);
    setAnnotations((list) => [...list.filter((x) => x.id !== a.id), a]);
  }

  async function exportAs(kind: "md" | "csv") {
    // Document order, then position within it, so the export reads like the book
    const rows: ExportRow[] = inScope
      .map((a) => ({ doc: byId.get(a.docId)!.doc, annotation: a }))
      .sort((x, y) => x.doc.title.localeCompare(y.doc.title) || x.annotation.createdAt - y.annotation.createdAt);
    const name = `lumaread-notes-${new Date().toISOString().slice(0, 10)}.${kind}`;
    try {
      if (await saveTextFile(name, kind === "md" ? toMarkdown(rows) : toCsv(rows))) setMessage(`Exported ${rows.length} items.`);
    } catch {
      setMessage("Export failed. Try another location.");
    }
  }

  function newNote() {
    const now = Date.now();
    setEditing({ id: crypto.randomUUID(), docId, color: "yellow", createdAt: now, updatedAt: now, version: 0 });
  }

  return (
    <div className="screen">
      <header className="page-header">
        <h1>Highlights &amp; Notes</h1>
        <div className="header-actions">
          <button className="button" onClick={() => exportAs("md")} disabled={!inScope.length}><Download size={16} /> Markdown</button>
          <button className="button" onClick={() => exportAs("csv")} disabled={!inScope.length}><Download size={16} /> CSV</button>
        </div>
      </header>

      <div className="toolbar-row">
        <div className="tabs" role="tablist">
          {(["highlights", "notes"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
              {t === "highlights" ? "Highlights" : "Notes"}
            </button>
          ))}
        </div>
        <select aria-label="Document" value={docId} onChange={(e) => setDocId(e.target.value)}>
          <option value="">All documents</option>
          {items.map((i) => <option key={i.doc.id} value={i.doc.id}>{i.doc.title}</option>)}
        </select>
      </div>

      {shown.length === 0 ? (
        <p className="empty muted">
          {tab === "highlights" ? "Select text while reading to highlight it." : "Notes you add to highlights or documents appear here."}
        </p>
      ) : (
        <ul className="note-list">
          {shown.map((a) => {
            const item = byId.get(a.docId)!;
            return (
              <li key={a.id} className={`note-card hl-border-${a.color}`}>
                <button className="note-open" onClick={() => onOpenAt(item, a.anchor && startAnchor(a.anchor))}>
                  {a.anchor && <span className="note-quote">“{a.anchor.quote.exact}”</span>}
                  {a.note && <span className="note-text">{a.note}</span>}
                  <span className="muted small">{[item.doc.title, a.label, timeAgo(a.updatedAt)].filter(Boolean).join(" · ")}</span>
                </button>
                <div className="note-actions">
                  {a.anchor && <button className="link" onClick={() => setSharing(a)}>Share</button>}
                  <button className="link" onClick={() => setEditing(a)}>Edit</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {tab === "notes" && (
        <button className="fab" onClick={newNote} disabled={!docId} title={docId ? "New note" : "Pick a document first"} aria-label="New note">
          <Plus size={22} />
        </button>
      )}

      {editing && (
        <AnnotationEditor
          annotation={editing}
          onSave={(a) => {
            // A new document note with no text isn't worth keeping
            if (!a.anchor && !a.note) return;
            persist({ ...a, updatedAt: Date.now(), version: a.version + 1 }).catch(() => setMessage("Could not save."));
          }}
          onDelete={(a) => deleteAnnotation(a.id).then(() => setAnnotations((list) => list.filter((x) => x.id !== a.id)))}
          onClose={() => setEditing(undefined)}
          onShare={setSharing}
        />
      )}
      {sharing && (
        <ShareQuoteDialog
          quote={sharing.anchor!.quote.exact}
          title={byId.get(sharing.docId)!.doc.title}
          author={byId.get(sharing.docId)!.doc.author}
          location={sharing.label}
          onClose={() => setSharing(undefined)}
        />
      )}
      {message && <div className="toast info" role="status" onClick={() => setMessage(undefined)}>{message}</div>}
    </div>
  );
}
