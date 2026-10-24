import { Moon, Pause, Play, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { RATES, type Sleep, type useReadAloud } from "./useReadAloud";

const SLEEPS: Sleep[] = ["off", 15, 30, 60, "chapter"];

// Floating player while reading aloud; the speed button cycles through RATES, the moon through sleep timers
export function ReadAloudBar({ player, location, chapters }: { player: ReturnType<typeof useReadAloud>; location?: string; chapters: boolean }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (typeof player.sleep !== "number") return;
    const t = setInterval(() => tick((n) => n + 1), 15_000); // keeps "12m" current
    return () => clearInterval(t);
  }, [player.sleep]);

  if (player.state === "off") return null;
  const playing = player.state === "playing";
  const nextRate = RATES[(RATES.indexOf(player.rate) + 1) % RATES.length];
  const options = chapters ? SLEEPS : SLEEPS.filter((s) => s !== "chapter"); // a PDF has pages, not chapters
  const nextSleep = options[(options.indexOf(player.sleep) + 1) % options.length];
  const until = player.sleepUntil();
  const sleepText = player.sleep === "off" ? "" : player.sleep === "chapter" ? "End of chapter" : `${Math.max(1, Math.ceil(((until ?? 0) - Date.now()) / 60_000))}m`;
  const describe = (s: Sleep) => (s === "off" ? "off" : s === "chapter" ? "at the end of the chapter" : `in ${s} minutes`);

  return (
    <div className="read-aloud-bar" role="region" aria-label="Read aloud">
      <button className="icon-button" onClick={playing ? player.pause : player.play} aria-label={playing ? "Pause reading aloud" : "Resume reading aloud"}>
        {playing ? <Pause size={18} /> : <Play size={18} />}
      </button>
      <button className="icon-button" onClick={player.stop} aria-label="Stop reading aloud"><Square size={16} /></button>
      <button className="rate" onClick={() => player.setRate(nextRate)} aria-label={`Speed ${player.rate}×, change to ${nextRate}×`}>{player.rate}×</button>
      <button
        className={`rate sleep${player.sleep === "off" ? " off" : ""}`}
        onClick={() => player.setSleep(nextSleep)}
        aria-label={`Sleep timer ${describe(player.sleep)}; change to ${describe(nextSleep)}`}
      >
        <Moon size={14} aria-hidden="true" />{sleepText && ` ${sleepText}`}
      </button>
      <span className="read-aloud-where" aria-live="polite">{playing ? "Reading" : "Paused"}{location ? ` · ${location}` : ""}</span>
    </div>
  );
}
