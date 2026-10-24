import { Pause, Play, Square } from "lucide-react";
import { RATES, type useReadAloud } from "./useReadAloud";

// Floating player while reading aloud; the speed button cycles through RATES
export function ReadAloudBar({ player, location }: { player: ReturnType<typeof useReadAloud>; location?: string }) {
  if (player.state === "off") return null;
  const playing = player.state === "playing";
  const nextRate = RATES[(RATES.indexOf(player.rate) + 1) % RATES.length];
  return (
    <div className="read-aloud-bar" role="region" aria-label="Read aloud">
      <button className="icon-button" onClick={playing ? player.pause : player.play} aria-label={playing ? "Pause reading aloud" : "Resume reading aloud"}>
        {playing ? <Pause size={18} /> : <Play size={18} />}
      </button>
      <button className="icon-button" onClick={player.stop} aria-label="Stop reading aloud"><Square size={16} /></button>
      <button className="rate" onClick={() => player.setRate(nextRate)} aria-label={`Speed ${player.rate}×, change to ${nextRate}×`}>{player.rate}×</button>
      <span className="read-aloud-where" aria-live="polite">{playing ? "Reading" : "Paused"}{location ? ` · ${location}` : ""}</span>
    </div>
  );
}
