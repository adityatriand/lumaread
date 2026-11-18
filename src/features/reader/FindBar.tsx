import { ChevronDown, ChevronUp, List, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { listTexts, type DocText } from "../../lib/db";
import { findMatches } from "./findMatches";
import { FindResults } from "./FindResults";
import type { TextBridge } from "./types";

interface Props { docId: string; bridge: RefObject<TextBridge | null>; scanned?: boolean; focusSignal: number; onClose: () => void }

// Find in the open book: Enter / Shift+Enter step through matches, Escape closes
export function FindBar({ docId, bridge, scanned, focusSignal, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [texts, setTexts] = useState<DocText[]>();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [index, setIndex] = useState(-1);
  const [showList, setShowList] = useState(true);

  useEffect(() => {
    listTexts(docId).then(setTexts, () => setTexts([]));
    return () => {
      bridge.current?.mark(null);
      bridge.current?.markAll?.(null);
    };
  }, [docId]);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusSignal]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  const matches = useMemo(() => (texts ? findMatches(texts, debounced) : []), [texts, debounced]);
  const byUnit = useMemo(() => new Map((texts ?? []).map((t) => [t.unit, t])), [texts]);

  function go(i: number) {
    const m = matches[i];
    if (!m) return;
    setIndex(i);
    bridge.current?.show(m.unit, m.start);
    bridge.current?.mark({ unit: m.unit, chunk: { start: m.start, end: m.end, text: m.text }, nth: m.nth, find: true });
  }

  // A new search starts at the first match from where the reader is
  useEffect(() => {
    bridge.current?.markAll?.(matches.map((m) => ({ unit: m.unit, chunk: { start: m.start, end: m.end, text: m.text } })));
    if (!matches.length) return (setIndex(-1), bridge.current?.mark(null));
    const here = bridge.current?.position()?.unit ?? 0;
    go(Math.max(0, matches.findIndex((m) => m.unit >= here)));
  }, [matches]);

  function step(d: number) {
    if (!matches.length) return;
    setShowList(false);
    go((index + d + matches.length) % matches.length);
  }

  function pick(i: number) {
    setShowList(false);
    go(i);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Enter") (e.preventDefault(), step(e.shiftKey ? -1 : 1));
    if (e.key === "Escape") (e.preventDefault(), onClose());
  }

  const status = !texts
    ? "Loading…"
    : !texts.length
      ? "Still preparing this book"
      : debounced.trim().length < 2
        ? ""
        : matches.length
          ? `${index + 1} / ${matches.length}`
          : "No matches";

  return (
    <div className="find-bar" role="search" aria-label="Find in book">
      <input
        ref={inputRef}
        type="search"
        autoFocus
        value={query}
        placeholder={scanned ? "Find (recognized pages)" : "Find in book"}
        aria-label="Find in book"
        onChange={(e) => (setQuery(e.currentTarget.value), setShowList(true))}
        onKeyDown={onKey}
      />
      <span className="find-status muted small" aria-live="polite">{status}</span>
      <button
        className="icon-button"
        aria-label={showList ? "Hide matches" : "Show matches"}
        aria-pressed={showList}
        disabled={!matches.length}
        onClick={() => setShowList((s) => !s)}
      >
        <List size={18} className={showList && matches.length ? "accent" : undefined} />
      </button>
      <button className="icon-button" aria-label="Previous match" disabled={!matches.length} onClick={() => step(-1)}><ChevronUp size={18} /></button>
      <button className="icon-button" aria-label="Next match" disabled={!matches.length} onClick={() => step(1)}><ChevronDown size={18} /></button>
      <button className="icon-button" aria-label="Close find" onClick={onClose}><X size={18} /></button>
      {showList && matches.length > 0 && <FindResults matches={matches} texts={byUnit} index={index} onPick={pick} />}
    </div>
  );
}
