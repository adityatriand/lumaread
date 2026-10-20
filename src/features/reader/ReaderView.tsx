import { useEffect, useState } from "react";
import { deleteAnnotation, listAnnotations, saveAnnotation, type Annotation, type HighlightColor } from "../../lib/db";
import { LookupPanel } from "../lookup/LookupPanel";
import { ShareQuoteDialog } from "../share/ShareQuoteDialog";
import { AnnotationEditor } from "../notebook/AnnotationEditor";
import { citation } from "../notebook/citation";
import { EpubReader } from "./EpubReader";
import { PdfReader } from "./PdfReader";
import { SelectionToolbar } from "./SelectionToolbar";
import type { ReaderProps, TextSelection } from "./types";

type Props = Omit<ReaderProps, "annotations" | "onSelect" | "onAnnotationClick" | "tools">;

export function ReaderView(props: Props) {
  const { doc } = props;
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selection, setSelection] = useState<TextSelection | null>(null);
  const [editing, setEditing] = useState<Annotation>();
  const [message, setMessage] = useState<string>();
  const [lookup, setLookup] = useState<string>();
  const [sharing, setSharing] = useState<{ quote: string; location?: string }>();

  useEffect(() => {
    listAnnotations(doc.id).then(setAnnotations, () => setMessage("Highlights could not be loaded."));
  }, [doc.id]);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(undefined), 2500);
    return () => clearTimeout(t);
  }, [message]);

  async function persist(a: Annotation) {
    try {
      await saveAnnotation(a);
      setAnnotations((list) => [...list.filter((x) => x.id !== a.id), a]);
    } catch {
      setMessage("Could not save. Your device storage may be full.");
    }
  }

  function create(color: HighlightColor, openEditor = false) {
    if (!selection) return;
    const now = Date.now();
    const a: Annotation = { id: crypto.randomUUID(), docId: doc.id, anchor: selection.anchor, label: selection.label, color, createdAt: now, updatedAt: now, version: 1 };
    persist(a);
    selection.clear();
    setSelection(null);
    if (openEditor) setEditing(a);
  }

  async function copy() {
    if (!selection) return;
    try {
      await navigator.clipboard.writeText(citation(doc, selection.anchor));
      setMessage("Quote copied with source.");
    } catch {
      setMessage("Copy is not available here.");
    }
    selection.clear();
    setSelection(null);
  }

  const Reader = doc.format === "pdf" ? PdfReader : EpubReader;

  return (
    <>
      <Reader
        {...props}
        annotations={annotations}
        onSelect={setSelection}
        onAnnotationClick={(id) => setEditing(annotations.find((a) => a.id === id))}
      />
      {selection && (
        <SelectionToolbar
          selection={selection}
          onHighlight={(c) => create(c)}
          onNote={() => create("yellow", true)}
          onCopy={copy}
          onTranslate={() => (setLookup(selection.anchor.quote.exact), setSelection(null))}
          onShare={() => (setSharing({ quote: selection.anchor.quote.exact, location: selection.label }), setSelection(null))}
        />
      )}
      {lookup && <LookupPanel key={lookup} text={lookup} onClose={() => setLookup(undefined)} />}
      {editing && (
        <AnnotationEditor
          key={editing.id}
          annotation={editing}
          onSave={(a) => persist({ ...a, updatedAt: Date.now(), version: a.version + 1 })}
          onDelete={(a) =>
            deleteAnnotation(a.id).then(
              () => setAnnotations((list) => list.filter((x) => x.id !== a.id)),
              () => setMessage("Could not delete."),
            )
          }
          onClose={() => setEditing(undefined)}
          onShare={(a) => setSharing({ quote: a.anchor!.quote.exact, location: a.label })}
        />
      )}
      {sharing && <ShareQuoteDialog {...sharing} title={doc.title} author={doc.author} onClose={() => setSharing(undefined)} />}
      {message && <div className="toast info" role="status">{message}</div>}
    </>
  );
}
