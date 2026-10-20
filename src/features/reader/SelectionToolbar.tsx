import { Copy, Languages, NotebookPen, Share2 } from "lucide-react";
import { HIGHLIGHT_COLORS, type HighlightColor } from "../../lib/db";
import type { TextSelection } from "./types";

interface Props {
  selection: TextSelection;
  onHighlight: (color: HighlightColor) => void;
  onNote: () => void;
  onCopy: () => void;
  onTranslate?: () => void;
  onShare?: () => void;
}

const WIDTH = 340;

export function SelectionToolbar({ selection, onHighlight, onNote, onCopy, onTranslate, onShare }: Props) {
  const { rect } = selection;
  const above = rect.top > 72;
  const style = {
    left: Math.min(Math.max(8, rect.left + rect.width / 2 - WIDTH / 2), window.innerWidth - WIDTH - 8),
    top: above ? rect.top - 56 : rect.bottom + 8,
    width: WIDTH,
  };

  return (
    // preventDefault on pointerdown keeps the text selection alive while a button is pressed
    <div className="selection-toolbar" role="toolbar" aria-label="Selection actions" style={style} onPointerDown={(e) => e.preventDefault()}>
      {HIGHLIGHT_COLORS.map((c) => (
        <button key={c} className={`swatch-button hl-${c}`} aria-label={`Highlight ${c}`} onClick={() => onHighlight(c)} />
      ))}
      <span className="divider" />
      <button className="icon-button" aria-label="Add note" onClick={onNote}><NotebookPen size={18} /></button>
      {onTranslate && <button className="icon-button" aria-label="Translate" onClick={onTranslate}><Languages size={18} /></button>}
      <button className="icon-button" aria-label="Copy quote" onClick={onCopy}><Copy size={18} /></button>
      {onShare && <button className="icon-button" aria-label="Share quote" onClick={onShare}><Share2 size={18} /></button>}
    </div>
  );
}
