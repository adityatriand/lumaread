import { RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { getFile, getSummary, listTexts, saveSummary, type DocMeta, type DocSummary } from "../../lib/db";
import { indexDoc } from "../search/indexText";
import { rewriteSummary, summarizationPackAvailable } from "./abstractive";
import { summarizeBook } from "./summarize";

interface Props { doc: DocMeta; onClose: () => void }

export function SummaryDialog({ doc, onClose }: Props) {
  const [summary, setSummary] = useState<DocSummary>();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string>();
  const [error, setError] = useState<string>();
  const [aiPack, setAiPack] = useState(false);

  useEffect(() => {
    summarizationPackAvailable().then(setAiPack);
  }, []);

  async function ensureTexts() {
    let texts = await listTexts(doc.id);
    if (!texts.length) {
      const bytes = await getFile(doc.id);
      if (!bytes) throw new Error("missing");
      await indexDoc(doc, bytes);
      texts = await listTexts(doc.id);
    }
    return texts;
  }

  async function buildExtractive() {
    setBusy(true);
    setError(undefined);
    setProgress("Picking key sentences…");
    try {
      const texts = await ensureTexts();
      const extracted = summarizeBook(texts);
      if (!extracted.overview && !extracted.chapters.length) {
        setSummary(undefined);
        setError(doc.scanned ? "Not enough recognised text yet. Open the book so OCR can run, then try again." : "Not enough text in this book to summarise.");
        return;
      }
      const next: DocSummary = { docId: doc.id, ...extracted, createdAt: Date.now(), method: "extractive" };
      await saveSummary(next);
      setSummary(next);
    } catch {
      setError("Could not summarise this book.");
    } finally {
      setBusy(false);
      setProgress(undefined);
    }
  }

  async function buildAbstractive() {
    setBusy(true);
    setError(undefined);
    try {
      const texts = await ensureTexts();
      const extracted = summarizeBook(texts);
      if (!extracted.overview && !extracted.chapters.length) {
        setError("Not enough text in this book to summarise.");
        return;
      }
      setProgress("Loading on-device model…");
      const rewritten = await rewriteSummary(extracted, (done, total) => setProgress(`Rewriting… ${done}/${total}`));
      const next: DocSummary = { docId: doc.id, ...rewritten, createdAt: Date.now(), method: "abstractive" };
      await saveSummary(next);
      setSummary(next);
    } catch {
      setError("On-device AI rewrite failed. Extractive summary is unchanged — try again, or run pnpm setup:summarize.");
    } finally {
      setBusy(false);
      setProgress(undefined);
    }
  }

  useEffect(() => {
    let alive = true;
    getSummary(doc.id).then((s) => {
      if (!alive) return;
      if (s) setSummary(s);
      else buildExtractive();
    }, () => alive && setError("Could not load the summary."));
    return () => {
      alive = false;
    };
  }, [doc.id]);

  const methodNote =
    summary?.method === "abstractive"
      ? "Rewritten on this device with DistilBART (optional pack). Indonesian text goes through Bergamot first."
      : "Key sentences picked on this device — not an AI rewrite.";

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="dialog share-dialog" role="dialog" aria-modal="true" aria-label={`Summary of ${doc.title}`} onClick={(e) => e.stopPropagation()}>
        <header className="page-header" style={{ margin: 0 }}>
          <div>
            <h2 style={{ margin: 0 }}>Summary</h2>
            <p className="muted small" style={{ margin: "4px 0 0" }}>{doc.title}{doc.author ? ` · ${doc.author}` : ""}</p>
          </div>
          <button className="icon-button" disabled={busy} onClick={buildExtractive} aria-label="Regenerate extractive summary" title="Regenerate">
            <RefreshCw size={18} className={busy && !progress?.startsWith("Rewriting") ? "spin" : undefined} />
          </button>
        </header>

        {busy && <p className="muted">{progress ?? "Working…"}</p>}
        {error && <p className="alert" role="alert">{error}</p>}

        {summary && (
          <div className="summary-body">
            <p className="muted small">{methodNote}</p>
            {summary.overview && (
              <section>
                <h3>Overview</h3>
                <p className="summary-text">{summary.overview}</p>
              </section>
            )}
            {summary.chapters.length > 0 && (
              <section>
                <h3>By chapter</h3>
                <ol className="summary-chapters">
                  {summary.chapters.map((c) => (
                    <li key={c.unit}>
                      <strong>{c.label}</strong>
                      <p className="summary-text">{c.text}</p>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </div>
        )}

        <div className="dialog-actions summary-actions">
          {aiPack ? (
            <button type="button" className="button" disabled={busy || !summary} onClick={buildAbstractive}>
              <Sparkles size={16} aria-hidden="true" /> Rewrite with on-device AI
            </button>
          ) : (
            <p className="muted small" style={{ margin: 0, maxWidth: "60%" }}>
              Optional AI pack not installed (`pnpm setup:summarize`, ~284 MB).
            </p>
          )}
          <button type="button" className="button" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
