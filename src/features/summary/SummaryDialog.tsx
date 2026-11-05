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
      const rewritten = await rewriteSummary(
        extracted,
        (done, total) => setProgress(`Summarising book… ${done}/${total}`),
        setProgress,
        texts,
      );
      const next: DocSummary = { docId: doc.id, ...rewritten, createdAt: Date.now(), method: "abstractive" };
      await saveSummary(next);
      setSummary(next);
      setAiPack(true);
    } catch (e) {
      const detail = e instanceof Error && e.message ? e.message : "unknown error";
      setError(`AI rewrite failed (${detail}). Check the network on first download, then try again.`);
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
      ? "One summary of the whole book (every body page), rewritten on-device with DistilBART."
      : "Key sentences from every body page, joined into one wrap — not an AI rewrite.";

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="dialog share-dialog" role="dialog" aria-modal="true" aria-label={`Summary of ${doc.title}`} onClick={(e) => e.stopPropagation()}>
        <header className="page-header" style={{ margin: 0 }}>
          <div>
            <h2 style={{ margin: 0 }}>Summary</h2>
            <p className="muted small" style={{ margin: "4px 0 0" }}>{doc.title}{doc.author ? ` · ${doc.author}` : ""}</p>
          </div>
          <button className="icon-button" disabled={busy} onClick={buildExtractive} aria-label="Regenerate extractive summary" title="Regenerate">
            <RefreshCw size={18} className={busy && !progress?.startsWith("Summarising") && !progress?.startsWith("Writing") && !progress?.startsWith("Loading") && !progress?.startsWith("Downloading") ? "spin" : undefined} />
          </button>
        </header>

        {busy && <p className="muted">{progress ?? "Working…"}</p>}
        {error && <p className="alert" role="alert">{error}</p>}

        {summary && (
          <div className="summary-body">
            <p className="muted small">{methodNote}</p>
            {summary.overview && (
              <section>
                {summary.chapters.length > 0 && <h3>Overview</h3>}
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
          <button type="button" className="button" disabled={busy || !summary} onClick={buildAbstractive}>
            <Sparkles size={16} aria-hidden="true" />
            {aiPack ? "AI: whole book → 1 summary" : "Download AI model & summarise book"}
          </button>
          <button type="button" className="button" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
