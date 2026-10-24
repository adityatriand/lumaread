import { useState } from "react";
import type { DocMeta } from "../../lib/db";

interface Props { doc: DocMeta; allShelves: string[]; onSave: (shelves: string[]) => void; onClose: () => void }

// A shelf exists while at least one book is on it, so there is nothing separate to create or delete
export function ShelvesDialog({ doc, allShelves, onSave, onClose }: Props) {
  const [chosen, setChosen] = useState(new Set(doc.shelves ?? []));
  const [shelves, setShelves] = useState(allShelves);
  const [name, setName] = useState("");

  const toggle = (s: string) => setChosen((c) => new Set(c.has(s) ? [...c].filter((x) => x !== s) : [...c, s]));

  function add() {
    const s = name.trim().slice(0, 40);
    if (!s) return;
    if (!shelves.includes(s)) setShelves([...shelves, s].sort((a, b) => a.localeCompare(b)));
    setChosen((c) => new Set([...c, s]));
    setName("");
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Shelves" onClick={(e) => e.stopPropagation()}>
        <h2>Shelves</h2>
        <p className="muted small">Put “{doc.title}” on any number of shelves.</p>
        {shelves.length > 0 && (
          <div className="shelf-options">
            {shelves.map((s) => (
              <label key={s} className="theme-option">
                <input type="checkbox" checked={chosen.has(s)} onChange={() => toggle(s)} /> {s}
              </label>
            ))}
          </div>
        )}
        <form className="bookmark-add" onSubmit={(e) => (e.preventDefault(), add())}>
          <input className="text-input" value={name} maxLength={40} placeholder="New shelf, e.g. To read" aria-label="New shelf" onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="button">Add</button>
        </form>
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="button primary" onClick={() => (onSave([...chosen].sort((a, b) => a.localeCompare(b))), onClose())}>Save</button>
        </div>
      </div>
    </div>
  );
}
