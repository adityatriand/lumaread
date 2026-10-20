import { useEffect, useRef } from "react";
import { saveSession, type Session } from "../../lib/db";
import { dayKey } from "./stats";

const IDLE_MS = 2 * 60_000; // no input for this long = not reading (book left open)
const TICK_MS = 5_000;
const SAVE_MS = 30_000;
const MIN_SESSION_MS = 10_000; // opening a book by mistake isn't a session

// Records one reading session per opened book; call location() on every page turn
export function useReadingSession(docId: string) {
  const session = useRef<Session>(null);
  const seen = useRef(new Set<string>());
  const lastActive = useRef(0);

  useEffect(() => {
    const start = Date.now();
    session.current = { id: crypto.randomUUID(), docId, day: dayKey(start), startedAt: start, endedAt: start, activeMs: 0, pages: 0, startPercent: -1, endPercent: 0 };
    seen.current = new Set();
    lastActive.current = start;
    let lastTick = start;

    const mark = () => (lastActive.current = Date.now());
    const tick = () => {
      const now = Date.now();
      const s = session.current!;
      if (document.visibilityState === "visible" && now - lastActive.current < IDLE_MS) {
        // Capped so a suspended laptop or throttled timer can't credit the gap
        s.activeMs += Math.min(now - lastTick, TICK_MS * 2);
        s.endedAt = now;
      }
      lastTick = now;
    };
    const flush = () => {
      tick();
      const s = session.current!;
      if (s.activeMs < MIN_SESSION_MS) return;
      saveSession({ ...s, startPercent: s.startPercent < 0 ? s.endPercent : s.startPercent }).catch(() => undefined);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
      else lastTick = Date.now();
    };

    const activity = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const e of activity) window.addEventListener(e, mark, { passive: true });
    document.addEventListener("scroll", mark, { capture: true, passive: true }); // scroll doesn't bubble
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    const ticker = setInterval(tick, TICK_MS);
    const saver = setInterval(flush, SAVE_MS);

    return () => {
      clearInterval(ticker);
      clearInterval(saver);
      for (const e of activity) window.removeEventListener(e, mark);
      document.removeEventListener("scroll", mark, { capture: true });
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [docId]);

  return {
    // Page turns are activity too (EPUB input happens inside the book iframe, out of reach of window listeners)
    location(key: string, percent: number) {
      const s = session.current;
      if (!s) return;
      lastActive.current = Date.now();
      if (s.startPercent < 0) s.startPercent = percent;
      s.endPercent = percent;
      seen.current.add(key);
      s.pages = seen.current.size;
    },
  };
}
