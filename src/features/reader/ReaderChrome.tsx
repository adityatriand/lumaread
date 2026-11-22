import { ArrowLeft, ChevronLeft, ChevronRight, Settings2 } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { useOutsideClose } from "../../components/useOutsideClose";
import { ReadingPrefsForm } from "../settings/ReadingPrefsForm";
import type { ReadingPrefs } from "../settings/prefs";

interface Props {
  title: string;
  location: string;
  /** Current page and length, so a side slider can show "12/240" and jump. Omitted until the book has pages. */
  scrub?: { page: number; total: number; onSeek: (page: number) => void };
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  canPrev?: boolean;
  canNext?: boolean;
  tools?: ReactNode;
  prefs?: { value: ReadingPrefs; onChange: (p: ReadingPrefs) => void; format?: "pdf" | "epub" };
  theme?: string;
  prefsExtra?: ReactNode; // shown above the reading options (e.g. zoom on phones)
  status?: ReactNode; // strip under the header, e.g. OCR progress
  children: ReactNode;
}

const INTRO_MS = 3000; // bars show briefly on open so the reader knows they exist

// The page pill follows the thumb, and the book turns as the thumb moves. The last page stays shown until the
// reader catches up, so the thumb does not jump backward at the end of a drag.
function PageSlider({ page, total, onSeek }: { page: number; total: number; onSeek: (page: number) => void }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const sent = useRef<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [showPill, setShowPill] = useState(false);
  const hide = useRef(0);

  useEffect(() => {
    if (dragging.current) return;
    if (drag != null && page !== drag) return;
    if (drag != null) setDrag(null);
    setShowPill(true);
    window.clearTimeout(hide.current);
    hide.current = window.setTimeout(() => setShowPill(false), 800);
    return () => window.clearTimeout(hide.current);
  }, [page, drag]);

  const shown = drag ?? page;
  const ratio = total <= 1 ? 0 : (shown - 1) / (total - 1);
  const at = `clamp(28px, ${ratio * 100}%, calc(100% - 28px))`;

  function pageAt(clientY: number) {
    const box = trackRef.current!.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (clientY - box.top) / Math.max(box.height, 1)));
    return Math.round(t * (total - 1)) + 1;
  }

  function seek(n: number) {
    setDrag(n);
    if (sent.current === n || (sent.current == null && n === page)) return;
    sent.current = n;
    onSeek(n);
  }

  function onPointerDown(e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragging.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setShowPill(true);
    seek(pageAt(e.clientY));
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging.current) return;
    seek(pageAt(e.clientY));
  }

  function onPointerUp(e: PointerEvent) {
    if (!dragging.current) return;
    dragging.current = false;
    seek(pageAt(e.clientY));
    sent.current = null;
  }

  return (
    <div
      ref={trackRef}
      className={`page-slider${showPill ? " active" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={(e) => e.stopPropagation()}
      role="slider"
      aria-label="Page"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={shown}
      aria-valuetext={`${shown} of ${total}`}
    >
      <span className="page-slider-pill" style={{ top: at }}>{shown}/{total}</span>
      <span className="page-slider-thumb" style={{ top: at }} />
    </div>
  );
}

export function ReaderChrome({ title, location, scrub, onClose, onPrev, onNext, canPrev = true, canNext = true, tools, prefs, theme = "light", prefsExtra, status, children }: Props) {
  const [showPrefs, setShowPrefs] = useState(false);
  // The book fills the screen; the bars float over it, hidden until a tap on the page (or hovering an edge on desktop)
  const [showBars, setShowBars] = useState(true);
  const popoverRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setShowBars(false), INTRO_MS);
    return () => clearTimeout(t);
  }, []);

  useOutsideClose(showPrefs, () => setShowPrefs(false), popoverRef, toggleRef);

  function onBodyClick(e: MouseEvent) {
    // Ending a selection, following a link or opening a highlight isn't asking for the bars
    if (e.defaultPrevented || !document.getSelection()?.isCollapsed || (e.target as Element).closest("a, button, .hl")) return;
    setShowBars((s) => !s);
  }

  return (
    <div className={`reader theme-${theme}${showBars || showPrefs ? " bars-on" : ""}`}>
      <div className="reader-top">
        <header className="reader-bar" data-tauri-drag-region>
          <button className="icon-button" onClick={onClose} aria-label="Back to library"><ArrowLeft size={20} /></button>
          <div className="reader-heading">
            <h1>{title}</h1>
            <span className="muted small">{location}</span>
          </div>
          {tools}
          {prefs && (
            <button ref={toggleRef} className="icon-button" aria-label="Reading preferences" aria-expanded={showPrefs} onClick={() => setShowPrefs((s) => !s)}>
              <Settings2 size={20} />
            </button>
          )}
        </header>
        {status}
        {prefs && showPrefs && (
          <div ref={popoverRef} className="popover" role="dialog" aria-label="Reading preferences">
            {prefsExtra}
            <ReadingPrefsForm prefs={prefs.value} onChange={prefs.onChange} format={prefs.format} />
          </div>
        )}
      </div>
      <div className="reader-body" onClick={onBodyClick}>{children}</div>
      {scrub && scrub.total > 1 && scrub.page > 0 && <PageSlider page={scrub.page} total={scrub.total} onSeek={scrub.onSeek} />}
      <footer className="reader-bar footer">
        <button className="icon-button" onClick={onPrev} disabled={!canPrev} aria-label="Previous page"><ChevronLeft size={20} /></button>
        <span aria-live="polite">{location}</span>
        <button className="icon-button" onClick={onNext} disabled={!canNext} aria-label="Next page"><ChevronRight size={20} /></button>
      </footer>
    </div>
  );
}
