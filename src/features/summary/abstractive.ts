import type { ExtractedSummary } from "./summarize";
import { detectLang, translate } from "../lookup/translate";

const MODEL = "Xenova/distilbart-cnn-6-6";
const vendor = (p: string) => new URL(`/vendor/${p}`, location.href).href;

export type Progress = (done: number, total: number) => void;

let packOk: Promise<boolean> | undefined;
let pipePromise: Promise<(text: string) => Promise<string>> | undefined;

/** True when `pnpm setup:summarize` was run and the pack is in /vendor/summarization. */
export function summarizationPackAvailable() {
  return (packOk ??= fetch(vendor("summarization/manifest.json"), { method: "GET" })
    .then((r) => r.ok)
    .catch(() => false));
}

async function loadPipe() {
  return (pipePromise ??= (async () => {
    const { env, pipeline } = await import("@huggingface/transformers");
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.localModelPath = vendor("summarization/");
    // Self-hosted ORT (CSP blocks the CDN transformers.js would use otherwise)
    env.backends.onnx = {
      ...env.backends.onnx,
      wasm: { ...env.backends.onnx?.wasm, wasmPaths: vendor("ort/") },
    };

    const summarizer = await pipeline("summarization", MODEL, { dtype: "q8" });
    return async (text: string) => {
      const out = await summarizer(text, { max_new_tokens: 96, truncation: true });
      const row = Array.isArray(out) ? out[0] : out;
      return String((row as { summary_text?: string }).summary_text ?? "").trim();
    };
  })());
}

async function rewriteOne(text: string, summarize: (t: string) => Promise<string>): Promise<string> {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length < 80) return trimmed;
  const lang = detectLang(trimmed);
  const english = lang === "id" ? await translate(trimmed, "id", "en") : trimmed;
  const rewritten = await summarize(english);
  if (!rewritten) return trimmed;
  return lang === "id" ? await translate(rewritten, "en", "id") : rewritten;
}

/**
 * One fluent rewrite of the overview (plus chapter wraps when present).
 * Indonesian text is bridged through Bergamot (model is English-centric).
 */
export async function rewriteSummary(extracted: ExtractedSummary, onProgress?: Progress): Promise<ExtractedSummary> {
  if (!(await summarizationPackAvailable())) throw new Error("Summarization pack not installed");
  const summarize = await loadPipe();
  // Cap chapter rewrites; page-mode extractive already has chapters: []
  const chapters = extracted.chapters.slice(0, 12);
  const total = Math.max(1, (extracted.overview ? 1 : 0) + chapters.length);
  let done = 0;
  const tick = () => onProgress?.(++done, total);

  const overview = extracted.overview ? await rewriteOne(extracted.overview, summarize) : "";
  if (extracted.overview) tick();

  const outChapters = [];
  for (const c of chapters) {
    outChapters.push({ ...c, text: await rewriteOne(c.text, summarize) });
    tick();
  }

  return { overview, chapters: outChapters };
}
