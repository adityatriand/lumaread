import { ArrowLeft, ChevronLeft, ChevronRight, Settings2 } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useOutsideClose } from "../../components/useOutsideClose";
import { ReadingPrefsForm } from "../settings/ReadingPrefsForm";
import type { ReadingPrefs } from "../settings/prefs";

interface Props {
  title: string;
  location: string;
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

export function ReaderChrome({ title, location, onClose, onPrev, onNext, canPrev = true, canNext = true, tools, prefs, theme = "light", prefsExtra, status, children }: Props) {
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
      <footer className="reader-bar footer">
        <button className="icon-button" onClick={onPrev} disabled={!canPrev} aria-label="Previous page"><ChevronLeft size={20} /></button>
        <span aria-live="polite">{location}</span>
        <button className="icon-button" onClick={onNext} disabled={!canNext} aria-label="Next page"><ChevronRight size={20} /></button>
      </footer>
    </div>
  );
}
