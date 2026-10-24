import { invoke } from "@tauri-apps/api/core";

export interface Chunk { start: number; end: number; text: string } // [start, end) in the page text

const MAX_CHUNK = 220;

// Sentence-sized pieces with their offset in the page text: speech can pause and resume mid-page, and engines
// cut off very long utterances. Over-long sentences break at the last space before the limit.
export function chunks(text: string, from = 0): Chunk[] {
  const out: Chunk[] = [];
  for (const m of text.matchAll(/[^.!?…]+(?:[.!?…]+["”’)\]]*|$)/g)) {
    let start = m.index;
    let piece = m[0];
    if (start + piece.length <= from) continue;
    if (start < from) (piece = piece.slice(from - start), (start = from));
    while (piece.trim()) {
      const lead = piece.length - piece.trimStart().length;
      start += lead;
      piece = piece.slice(lead);
      let cut = piece.length;
      if (cut > MAX_CHUNK) {
        const space = piece.lastIndexOf(" ", MAX_CHUNK);
        cut = space > 0 ? space : MAX_CHUNK;
      }
      const raw = piece.slice(0, cut).trimEnd();
      if (raw) out.push({ start, end: start + raw.length, text: raw.replace(/\s+/g, " ") });
      start += cut;
      piece = piece.slice(cut);
    }
  }
  return out;
}

interface Speaker {
  speak: (text: string, lang: string, rate: number) => Promise<void>; // resolves when spoken or stopped
  stop: () => void;
}

// Installed voices only (localService), so reading aloud never needs the network
function pickVoice(lang: string) {
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.replace("_", "-").toLowerCase().startsWith(lang.slice(0, 2)));
  return voices.find((v) => v.localService && v.default) ?? voices.find((v) => v.localService) ?? null;
}

const web: Speaker = {
  speak: (text, lang, rate) =>
    new Promise((resolve, reject) => {
      if (typeof speechSynthesis === "undefined") return reject(new Error("Read aloud isn't available on this device."));
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      u.rate = rate;
      u.voice = pickVoice(lang);
      u.onend = () => resolve();
      u.onerror = (e) => (e.error === "interrupted" || e.error === "canceled" ? resolve() : reject(new Error("Speech failed")));
      speechSynthesis.speak(u);
    }),
  stop: () => globalThis.speechSynthesis?.cancel(),
};

// Android's WebView has no speechSynthesis; the readaloud plugin drives the system TextToSpeech instead
const android: Speaker = {
  speak: (text, lang, rate) => invoke("plugin:readaloud|speak", { payload: { text, lang, rate } }),
  stop: () => void invoke("plugin:readaloud|stop").catch(() => undefined),
};

export const speaker: Speaker = /Android/i.test(navigator.userAgent) ? android : web;
