import { Share2, Trash2 } from "lucide-react";
import { useState } from "react";
import { HIGHLIGHT_COLORS, type Annotation } from "../../lib/db";

interface Props {
  annotation: Annotation;
  onSave: (a: Annotation) => void;
  onDelete: (a: Annotation) => void;
  onClose: () => void;
  onShare?: (a: Annotation) => void;
}

export function AnnotationEditor({ annotation, onSave, onDelete, onClose, onShare }: Props) {
  const [color, setColor] = useState(annotation.color);
  const [note, setNote] = useState(annotation.note ?? "");
  const quote = annotation.anchor?.quote.exact;

  function save() {
    onSave({ ...annotation, color, note: note.trim() || undefined });
    onClose();
  }

  return (
    <div className="backdrop" onClick={save}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={quote ? "Edit highlight" : "Edit note"} onClick={(e) => e.stopPropagation()}>
        {quote && <blockquote className={`quote hl-border-${color}`}>{quote}</blockquote>}
        {quote && (
          <div className="color-row" role="radiogroup" aria-label="Color">
            {HIGHLIGHT_COLORS.map((c) => (
              <button key={c} role="radio" aria-checked={color === c} aria-label={c} className={`swatch-button hl-${c}`} onClick={() => setColor(c)} />
            ))}
          </div>
        )}
        <label className="field">
          <span className="muted small">Note</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} autoFocus={!quote} placeholder="Write your thoughts…" />
        </label>
        <div className="dialog-actions">
          <button className="danger-button" onClick={() => (onDelete(annotation), onClose())}><Trash2 size={16} /> Delete</button>
          <div className="header-actions">
            {quote && onShare && <button className="button" onClick={() => (save(), onShare({ ...annotation, color, note: note.trim() || undefined }))}><Share2 size={16} /> Share</button>}
            <button className="button primary" onClick={save}>Done</button>
          </div>
        </div>
      </div>
    </div>
  );
}
