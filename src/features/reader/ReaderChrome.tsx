import { ArrowLeft, ChevronLeft, ChevronRight, Settings2 } from "lucide-react";
import { useState, type ReactNode } from "react";
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
  children: ReactNode;
}

export function ReaderChrome({ title, location, onClose, onPrev, onNext, canPrev = true, canNext = true, tools, prefs, theme = "light", children }: Props) {
  const [showPrefs, setShowPrefs] = useState(false);

  return (
    <div className={`reader theme-${theme}`}>
      <header className="reader-bar">
        <button className="icon-button" onClick={onClose} aria-label="Back to library"><ArrowLeft size={20} /></button>
        <div className="reader-heading">
          <h1>{title}</h1>
          <span className="muted small">{location}</span>
        </div>
        {tools}
        {prefs && (
          <button className="icon-button" aria-label="Reading preferences" aria-expanded={showPrefs} onClick={() => setShowPrefs((s) => !s)}>
            <Settings2 size={20} />
          </button>
        )}
      </header>
      {prefs && showPrefs && (
        <div className="popover" role="dialog" aria-label="Reading preferences">
          <ReadingPrefsForm prefs={prefs.value} onChange={prefs.onChange} format={prefs.format} />
        </div>
      )}
      <div className="reader-body">{children}</div>
      <footer className="reader-bar footer">
        <button className="icon-button" onClick={onPrev} disabled={!canPrev} aria-label="Previous page"><ChevronLeft size={20} /></button>
        <span aria-live="polite">{location}</span>
        <button className="icon-button" onClick={onNext} disabled={!canNext} aria-label="Next page"><ChevronRight size={20} /></button>
      </footer>
    </div>
  );
}
