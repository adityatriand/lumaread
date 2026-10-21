import { useState } from "react";
import type { DocMeta } from "../../lib/db";

interface Props { doc: DocMeta; onSave: (patch: Pick<DocMeta, "title" | "author">) => void; onClose: () => void }

export function EditDetailsDialog({ doc, onSave, onClose }: Props) {
  const [title, setTitle] = useState(doc.title);
  const [author, setAuthor] = useState(doc.author ?? "");

  function save() {
    if (!title.trim()) return;
    onSave({ title: title.trim(), author: author.trim() || undefined });
    onClose();
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <form className="dialog" role="dialog" aria-modal="true" aria-label="Edit details" onClick={(e) => e.stopPropagation()} onSubmit={(e) => (e.preventDefault(), save())}>
        <h2>Edit details</h2>
        <label className="field">
          <span className="muted small">Title</span>
          <input className="text-input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required />
        </label>
        <label className="field">
          <span className="muted small">Author</span>
          <input className="text-input" value={author} onChange={(e) => setAuthor(e.target.value)} />
        </label>
        {doc.fileName && <p className="muted small">Imported from “{doc.fileName}”. LumaRead keeps its own copy, so renaming the file later doesn't change it here.</p>}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="button primary">Save</button>
        </div>
      </form>
    </div>
  );
}
