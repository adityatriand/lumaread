import { useEffect, useRef } from "react";
import type { DocText } from "../../lib/db";
import { matchSnippet, type Match } from "./findMatches";

interface Props { matches: Match[]; texts: Map<number, DocText>; index: number; onPick: (i: number) => void }

export function FindResults({ matches, texts, index, onPick }: Props) {
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    listRef.current?.querySelector("[aria-current='true']")?.scrollIntoView({ block: "nearest" });
  }, [index]);

  return (
    <ul ref={listRef} className="find-results" aria-label="Matches">
      {matches.map((m, i) => {
        const text = texts.get(m.unit);
        const s = text && matchSnippet(text.text, m);
        return (
          <li key={`${m.unit}-${m.start}`}>
            <button className="find-result" aria-current={i === index} onClick={() => onPick(i)}>
              <span className="muted small">{text?.label}</span>
              {s && (
                <span className="result-snippet">
                  {s.before}
                  <mark>{s.hit}</mark>
                  {s.after}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
