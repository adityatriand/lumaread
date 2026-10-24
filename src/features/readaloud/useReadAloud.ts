import { useEffect, useRef, useState, type RefObject } from "react";
import { listTexts } from "../../lib/db";
import { detectLang } from "../lookup/translate";
import type { SpeechBridge } from "../reader/types";
import { chunks, speaker } from "./speech";

export type ReadAloudState = "off" | "playing" | "paused";
export const RATES = [0.75, 1, 1.25, 1.5, 2];
const RATE_KEY = "read-aloud-rate";

function storedRate() {
  try {
    const r = Number(localStorage.getItem(RATE_KEY));
    return RATES.includes(r) ? r : 1;
  } catch {
    return 1;
  }
}

// Reads the book's text (the search index, OCR included) from where the reader is, turning pages as it goes
export function useReadAloud(docId: string, bridge: RefObject<SpeechBridge | null>, onSpeak: () => void, onError: (message: string) => void) {
  const [state, setState] = useState<ReadAloudState>("off");
  const [rate, setRateState] = useState(storedRate);
  const rateRef = useRef(rate);
  const run = useRef(0); // bumped to cancel the running loop
  const pos = useRef<{ unit: number; offset: number }>(undefined); // sentence being read, for pause/resume
  const callbacks = useRef({ onSpeak, onError });
  callbacks.current = { onSpeak, onError };

  useEffect(
    () => () => {
      run.current++;
      speaker.stop();
    },
    [],
  );

  async function loop(gen: number, from: { unit: number; offset: number }) {
    const texts = (await listTexts(docId)).sort((a, b) => a.unit - b.unit);
    if (!texts.length) throw new Error("This book is still being prepared. Try again in a moment.");
    let lang: string | undefined; // from the first page with text: a scanned book has none until OCR
    let spoke = false;
    for (const t of texts.filter((t) => t.unit >= from.unit)) {
      if (t.unit !== from.unit) bridge.current?.show(t.unit, 0); // turn the page while OCR (if any) runs
      const text = (await bridge.current?.textOf?.(t.unit)) ?? t.text;
      if (run.current !== gen) return;
      lang ??= text.trim() ? (detectLang(text.slice(0, 3000)) === "id" ? "id-ID" : "en-US") : undefined;
      for (const c of chunks(text, t.unit === from.unit ? from.offset : 0)) {
        if (run.current !== gen) return;
        pos.current = { unit: t.unit, offset: c.start };
        bridge.current?.show(t.unit, c.start);
        bridge.current?.mark({ unit: t.unit, chunk: c });
        callbacks.current.onSpeak();
        spoke = true;
        await speaker.speak(c.text, lang!, rateRef.current);
      }
    }
    if (run.current !== gen) return;
    if (!spoke) throw new Error("No readable text from here on.");
    pos.current = undefined;
    bridge.current?.mark(null);
    setState("off");
  }

  function play() {
    const here = bridge.current?.position();
    // Paused, then moved to another page: start where the reader is now
    const from = pos.current && (!here || here.unit === pos.current.unit) ? pos.current : here;
    if (!from) return;
    const gen = ++run.current;
    setState("playing");
    loop(gen, from).catch((e: Error) => {
      if (run.current !== gen) return;
      bridge.current?.mark(null);
      setState("off");
      callbacks.current.onError(e.message);
    });
  }

  function halt(next: ReadAloudState) {
    run.current++;
    speaker.stop();
    setState(next);
  }

  return {
    state,
    rate,
    play,
    pause: () => halt("paused"),
    stop: () => ((pos.current = undefined), bridge.current?.mark(null), halt("off")), // a pause keeps the mark: it shows where to resume
    setRate(r: number) {
      rateRef.current = r;
      setRateState(r);
      try {
        localStorage.setItem(RATE_KEY, String(r));
      } catch {
        // Speed just won't persist
      }
      // Restart the current sentence at the new speed
      if (state === "playing") (run.current++, speaker.stop(), setTimeout(play, 50));
    },
  };
}
