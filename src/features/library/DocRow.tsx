import { MoreHorizontal } from "lucide-react";
import { formatSize, timeAgo } from "../../lib/format";
import type { LibraryItem } from "./types";

interface Props { item: LibraryItem; onOpen: () => void; onRemove: () => void; onStats?: () => void }

export function Cover({ item, large }: { item: LibraryItem; large?: boolean }) {
  const { doc } = item;
  return doc.cover ? (
    <img className={`cover${large ? " large" : ""}`} src={doc.cover} alt="" />
  ) : (
    <span className={`cover placeholder ${doc.format}${large ? " large" : ""}`} aria-hidden="true">{doc.format.toUpperCase()}</span>
  );
}

export function ProgressBar({ percent }: { percent: number }) {
  return (
    <span className="progress" role="progressbar" aria-valuenow={Math.round(percent * 100)} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${percent * 100}%` }} />
    </span>
  );
}

export function DocRow({ item, onOpen, onRemove, onStats }: Props) {
  const { doc, progress } = item;
  return (
    <li className="doc-row">
      <button className="doc-open" onClick={onOpen}>
        <Cover item={item} />
        <span className="doc-text">
          <span className="doc-title">{doc.title}</span>
          <span className="muted small">
            {doc.author ? `${doc.author} · ` : ""}{doc.format.toUpperCase()} · {formatSize(doc.size)}
          </span>
        </span>
        <span className="doc-status">
          <span className="muted small">{doc.openedAt ? `Last read ${timeAgo(doc.openedAt)}` : "Not started"}</span>
          {progress && (
            <span className="doc-progress">
              <ProgressBar percent={progress.percent} />
              <span className="muted small">{Math.round(progress.percent * 100)}%</span>
            </span>
          )}
        </span>
      </button>
      <details className="menu">
        <summary aria-label={`More actions for ${doc.title}`}><MoreHorizontal size={18} /></summary>
        <div className="menu-items">
          {onStats && <button className="menu-neutral" onClick={onStats}>Reading stats</button>}
          <button onClick={onRemove}>Remove from device</button>
        </div>
      </details>
    </li>
  );
}
