import { useState } from "react";
import { confirmDanger } from "../../components/ConfirmDialog";

interface Props {
  shelves: { name: string; count: number }[];
  onRename: (from: string, to: string) => Promise<void>;
  onDelete: (name: string) => Promise<void>;
  onClose: () => void;
}

// Rename or delete a shelf across every book on it. New shelves are made from a book's Shelves… menu.
export function ManageShelvesDialog({ shelves, onRename, onDelete, onClose }: Props) {
  const [editing, setEditing] = useState<{ from: string; to: string }>();

  async function rename() {
    const to = editing!.to.trim().slice(0, 40);
    const from = editing!.from;
    setEditing(undefined);
    if (to && to !== from) await onRename(from, to);
  }

  async function remove(name: string, count: number) {
    const books = `${count} book${count === 1 ? "" : "s"}`;
    if (await confirmDanger(`Delete the shelf “${name}”?`, `It's taken off ${books}. The books themselves stay in your library.`)) await onDelete(name);
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Manage shelves" onClick={(e) => e.stopPropagation()}>
        <h2>Manage shelves</h2>
        {shelves.length === 0 ? (
          <p className="muted">No shelves yet. Use “Shelves…” in a book's menu to put it on one.</p>
        ) : (
          <ul className="sync-list">
            {shelves.map(({ name, count }) => (
              <li key={name}>
                {editing?.from === name ? (
                  <form className="bookmark-add shelf-rename" onSubmit={(e) => (e.preventDefault(), rename())}>
                    <input
                      className="text-input"
                      autoFocus
                      value={editing.to}
                      maxLength={40}
                      aria-label={`New name for ${name}`}
                      onChange={(e) => setEditing({ from: name, to: e.target.value })}
                      onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setEditing(undefined))}
                    />
                    <button type="submit" className="button primary">Save</button>
                  </form>
                ) : (
                  <>
                    <span className="sync-name">
                      <strong>{name}</strong>
                      <span className="muted small">{count} book{count === 1 ? "" : "s"}</span>
                    </span>
                    <button className="link" onClick={() => setEditing({ from: name, to: name })}>Rename</button>
                    <button className="link danger-link" onClick={() => remove(name, count)}>Delete</button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="dialog-actions">
          <span />
          <button className="button primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
