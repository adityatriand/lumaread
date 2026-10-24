import { Pause, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { listSessions } from "../../lib/db";
import { formatClock } from "./stats";
import type { ReadingSession } from "./useReadingSession";

// Total time spent on this book across every session; ticks on its own so the reader doesn't re-render each second
export function ReadingTimer({ docId, session }: { docId: string; session: ReadingSession }) {
  const [before, setBefore] = useState(0);
  const [snap, setSnap] = useState(session.snapshot);

  useEffect(() => {
    listSessions(docId).then(
      (list) => setBefore(list.filter((s) => s.id !== session.snapshot().id).reduce((a, s) => a + s.activeMs, 0)),
      () => undefined,
    );
  }, [docId, session]);

  useEffect(() => {
    const t = setInterval(() => setSnap(session.snapshot()), 1000);
    return () => clearInterval(t);
  }, [session]);

  const manual = snap.state === "paused";
  const toggle = () => (session.setPaused(!manual), setSnap(session.snapshot()));
  const time = formatClock(before + snap.activeMs);

  return (
    <button
      className={`reading-timer${snap.state !== "reading" ? " paused" : ""}`}
      onClick={toggle}
      aria-label={`Reading time on this book ${time}${manual ? ", paused. Resume" : snap.state === "idle" ? ", paused while idle. Pause" : ". Pause"}`}
      title={manual ? "Resume timer" : snap.state === "idle" ? "Paused while you're away — it resumes when you read" : "Pause timer"}
    >
      {manual ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
      <span className="timer-time">{time}</span>
      {snap.state !== "reading" && <span className="timer-state">{manual ? "Paused" : "Idle"}</span>}
    </button>
  );
}
