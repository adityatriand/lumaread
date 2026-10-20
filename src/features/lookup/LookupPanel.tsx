import { ArrowLeftRight, Copy, X } from "lucide-react";
import { useEffect, useState } from "react";
import { define, type Definition, type Lang } from "./dictionary";
import { detectLang, translate } from "./translate";

interface Props { text: string; onClose: () => void }

const LANG_NAME: Record<Lang, string> = { id: "Indonesian", en: "English" };
const MAX_CHARS = 1000; // keeps one request well under the engine's sentence batch limits

type Result<T> = { state: "loading" } | { state: "done"; value: T } | { state: "error" };

export function LookupPanel({ text, onClose }: Props) {
  const source = text.trim().slice(0, MAX_CHARS);
  const [from, setFrom] = useState<Lang>(() => detectLang(source));
  const to: Lang = from === "id" ? "en" : "id";
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [translation, setTranslation] = useState<Result<string>>({ state: "loading" });
  const [copied, setCopied] = useState(false);
  const [swapped, setSwapped] = useState(false);

  useEffect(() => {
    define(source).then((defs) => {
      setDefinitions(defs);
      // A lone word found in only one dictionary settles the language better than function-word counting
      if (defs.length === 1 && !swapped) setFrom(defs[0].lang);
    }, () => setDefinitions([]));
  }, [source]);

  useEffect(() => {
    let current = true;
    setTranslation({ state: "loading" });
    translate(source, from, to).then(
      (value) => current && setTranslation({ state: "done", value }),
      () => current && setTranslation({ state: "error" }),
    );
    return () => {
      current = false;
    };
  }, [source, from, to]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function copy() {
    if (translation.state !== "done") return;
    await navigator.clipboard.writeText(translation.value).catch(() => undefined);
    setCopied(true);
  }

  return (
    <aside className="lookup-panel" role="dialog" aria-label="Translation and dictionary">
      <header className="lookup-header">
        <h2>Translation</h2>
        <button className="icon-button" aria-label="Close" onClick={onClose}><X size={20} /></button>
      </header>

      <p className="lookup-source">{source}</p>

      {definitions.map((d) => (
        <section key={d.lang} className="lookup-section">
          <h3 className="muted small">
            {LANG_NAME[d.lang]} dictionary{d.via ? ` · ${d.via} → ${d.word}` : ""}
          </h3>
          <ol className="senses">
            {d.senses.map(([pos, gloss], i) => (
              <li key={i}><span className="pos">{pos}</span> {gloss}</li>
            ))}
          </ol>
        </section>
      ))}

      <section className="lookup-section">
        <div className="lookup-direction">
          <span className="muted small">{LANG_NAME[from]} → {LANG_NAME[to]}</span>
          <button className="icon-button" aria-label="Swap languages" onClick={() => (setFrom(to), setSwapped(true))}><ArrowLeftRight size={18} /></button>
        </div>
        {translation.state === "loading" && <p className="muted" role="status">Translating on this device…</p>}
        {translation.state === "error" && <p className="alert" role="alert">Translation isn't available right now.</p>}
        {translation.state === "done" && <p className="lookup-result">{translation.value}</p>}
        <p className="muted small">Machine translation — runs offline, may be inexact.</p>
      </section>

      {translation.state === "done" && (
        <button className="button" onClick={copy}><Copy size={16} /> {copied ? "Copied" : "Copy translation"}</button>
      )}
    </aside>
  );
}
