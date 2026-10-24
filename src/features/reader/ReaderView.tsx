import { Headphones } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { confirmDanger } from "../../components/ConfirmDialog";
import type { Anchor } from "../../lib/anchor";
import { deleteAnnotation, deleteBookmark, listAnnotations, listBookmarks, saveAnnotation, saveBookmark, type Annotation, type Bookmark, type HighlightColor } from "../../lib/db";
import { LookupPanel } from "../lookup/LookupPanel";
import { ShareQuoteDialog } from "../share/ShareQuoteDialog";
import { ReadAloudBar } from "../readaloud/ReadAloudBar";
import { useReadAloud } from "../readaloud/useReadAloud";
import { ReadingTimer } from "../stats/ReadingTimer";
import { useReadingSession } from "../stats/useReadingSession";
import { AnnotationEditor } from "../notebook/AnnotationEditor";
import { citation } from "../notebook/citation";
import { BookmarkMenu } from "./BookmarkMenu";
import { EpubReader } from "./EpubReader";
import { PdfReader } from "./PdfReader";
import { SelectionToolbar } from "./SelectionToolbar";
import type { ReaderProps, SpeechBridge, TextSelection } from "./types";

type Props = Omit<ReaderProps, "annotations" | "onSelect" | "onAnnotationClick" | "tools" | "goTo" | "speechRef">;

export function ReaderView(props: Props) {
  const { doc } = props;
  const session = useReadingSession(doc.id);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selection, setSelection] = useState<TextSelection | null>(null);
  const [editing, setEditing] = useState<Annotation>();
  const [message, setMessage] = useState<string>();
  const [lookup, setLookup] = useState<string>();
  const [sharing, setSharing] = useState<{ quote: string; location?: string }>();
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [here, setHere] = useState<{ anchor: Anchor; label: string }>();
  const [goTo, setGoTo] = useState<{ anchor: Anchor }>();
  const speechRef = useRef<SpeechBridge>(null);
  // Listening counts as reading for the timer, even with no input
  const player = useReadAloud(doc.id, speechRef, session.touch, setMessage);

  useEffect(() => {
    listAnnotations(doc.id).then(setAnnotations, () => setMessage("Highlights could not be loaded."));
    listBookmarks(doc.id).then(setBookmarks, () => setMessage("Bookmarks could not be loaded."));
  }, [doc.id]);

  async function addBookmark(name: string) {
    if (!here) return;
    const b: Bookmark = { id: crypto.randomUUID(), docId: doc.id, anchor: here.anchor, label: here.label, name: name || here.label, createdAt: Date.now() };
    try {
      await saveBookmark(b);
      setBookmarks((list) => [...list, b]);
      setMessage("Bookmark saved.");
    } catch {
      setMessage("Could not save. Your device storage may be full.");
    }
  }

  async function removeBookmark(id: string) {
    const b = bookmarks.find((x) => x.id === id);
    if (!b || !(await confirmDanger(`Delete the bookmark “${b.name}”?`, "It's removed from this device and, at the next sync, from your other devices."))) return;
    deleteBookmark(id).then(() => setBookmarks((list) => list.filter((b) => b.id !== id)), () => setMessage("Could not delete."));
  }

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
  const marked = !!here && bookmarks.some((b) => b.label === here.label);

  return (
    <>
      <Reader
        {...props}
        goTo={goTo}
        speechRef={speechRef}
        tools={
          <>
            <button
              className="icon-button"
              aria-label={player.state === "off" ? "Read aloud" : "Stop reading aloud"}
              aria-pressed={player.state !== "off"}
              onClick={player.state === "off" ? player.play : player.stop}
            >
              <Headphones size={20} className={player.state !== "off" ? "accent" : undefined} />
            </button>
            <BookmarkMenu bookmarks={bookmarks} here={here} onAdd={addBookmark} onDelete={removeBookmark} onGo={(b) => setGoTo({ anchor: b.anchor })} />
          </>
        }
        onLocation={(anchor, percent, label) => {
          session.location(JSON.stringify(anchor), percent);
          setHere({ anchor, label });
          props.onLocation(anchor, percent, label);
        }}
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
      {marked && <div className="bookmark-ribbon" aria-hidden="true" />}
      <ReadingTimer docId={doc.id} session={session} />
      <ReadAloudBar player={player} location={here?.label} />
      {message && <div className="toast info" role="status">{message}</div>}
    </>
  );
}
