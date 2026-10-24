import { Bookmark as BookmarkIcon, BookmarkCheck, X } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { useOutsideClose } from "../../components/useOutsideClose";
import { pdfPage, type Anchor } from "../../lib/anchor";
import type { Bookmark } from "../../lib/db";

interface Props {
  bookmarks: Bookmark[];
  here?: { anchor: Anchor; label: string };
  onAdd: (name: string) => void;
  onDelete: (id: string) => void;
  onGo: (b: Bookmark) => void;
}

// PDFs list in page order; EPUB positions (CFIs) don't sort as text, so newest last
export const byPlace = (a: Bookmark, b: Bookmark) => (pdfPage(a.anchor) ?? 0) - (pdfPage(b.anchor) ?? 0) || a.createdAt - b.createdAt;

export function BookmarkMenu({ bookmarks, here, onAdd, onDelete, onGo }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const popoverRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  useOutsideClose(open, () => setOpen(false), popoverRef, toggleRef);
  const marked = !!here && bookmarks.some((b) => b.label === here.label);

  function add(e: FormEvent) {
    e.preventDefault();
    onAdd(name.trim());
    setName("");
  }

  return (
    <>
      <button ref={toggleRef} className="icon-button" aria-label={marked ? "Bookmarks (this page is bookmarked)" : "Bookmarks"} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {marked ? <BookmarkCheck size={20} className="accent" /> : <BookmarkIcon size={20} />}
      </button>
      {open && (
        <div ref={popoverRef} className="popover bookmarks" role="dialog" aria-label="Bookmarks">
          <form className="bookmark-add" onSubmit={add}>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              placeholder={here ? `Name this place · ${here.label}` : "Loading…"}
              aria-label="Bookmark name"
              maxLength={120}
              disabled={!here}
            />
            <button className="button primary" type="submit" disabled={!here}>Add</button>
          </form>
          {bookmarks.length ? (
            <ul className="bookmark-list">
              {[...bookmarks].sort(byPlace).map((b) => (
                <li key={b.id}>
                  <button className="bookmark-go" onClick={() => (onGo(b), setOpen(false))}>
                    <span>{b.name}</span>
                    {b.name !== b.label && <span className="muted small">{b.label}</span>}
                  </button>
                  <button className="icon-button" aria-label={`Delete bookmark ${b.name}`} onClick={() => onDelete(b.id)}><X size={16} /></button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">No bookmarks yet. Name this place to save it.</p>
          )}
        </div>
      )}
    </>
  );
}
