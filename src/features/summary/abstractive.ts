import type { ExtractedSummary } from "./summarize";
import { detectLang, translate } from "../lookup/translate";

const MODEL = "Xenova/distilbart-cnn-6-6";
const vendor = (p: string) => new URL(`/vendor/${p}`, location.href).href;

export type Progress = (done: number, total: number) => void;
export type LoadProgress = (message: string) => void;

let packOk: Promise<boolean> | undefined;
let pipePromise: Promise<(text: string) => Promise<string>> | undefined;

/** True when DistilBART is shipped under /vendor/summarization. */
export function summarizationPackAvailable() {
  return (packOk ??= fetch(vendor("summarization/manifest.json"))
    .then(async (r) => {
      if (!r.ok) return false;
      const j = (await r.json().catch(() => null)) as { model?: string } | null;
      return typeof j?.model === "string" && j.model.length > 0;
    })
    .catch(() => false));
}

/** Tauri asset protocol often serves .mjs with a non-JS MIME; blob URLs make module import work. */
async function ortWasmPaths(): Promise<{ mjs: string; wasm: string }> {
  // transformers.js defaults to asyncify (Safari <26 without WebGPU uses plain)
  const safariOld = /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
    && !("gpu" in navigator);
  const stem = safariOld ? "ort-wasm-simd-threaded" : "ort-wasm-simd-threaded.asyncify";
  const [mjsRes, wasmRes] = await Promise.all([
    fetch(vendor(`ort/${stem}.mjs`)),
    fetch(vendor(`ort/${stem}.wasm`)),
  ]);
  if (!mjsRes.ok || !wasmRes.ok) {
    throw new Error(`ORT wasm missing (${stem}, ${mjsRes.status}/${wasmRes.status})`);
  }
  const [mjsBuf, wasmBuf] = await Promise.all([mjsRes.arrayBuffer(), wasmRes.arrayBuffer()]);
  return {
    mjs: URL.createObjectURL(new Blob([new Uint8Array(mjsBuf)], { type: "text/javascript" })),
    wasm: URL.createObjectURL(new Blob([new Uint8Array(wasmBuf)], { type: "application/wasm" })),
  };
}

async function loadPipe(onLoad?: LoadProgress) {
  if (!pipePromise) {
    pipePromise = (async () => {
      const local = await summarizationPackAvailable();
      const { env, pipeline } = await import("@huggingface/transformers");
      // Prefer embedded pack; otherwise first run downloads ~284 MB into the WebView cache
      env.allowRemoteModels = !local;
      env.allowLocalModels = local;
      if (local) env.localModelPath = vendor("summarization/");
      const wasmPaths = await ortWasmPaths();
      env.backends.onnx = {
        ...env.backends.onnx,
        wasm: { ...env.backends.onnx?.wasm, wasmPaths, proxy: false },
      };

      onLoad?.(local ? "Loading on-device model…" : "Downloading AI model (~284 MB, once)…");
      const summarizer = await pipeline("summarization", MODEL, {
        dtype: "q8",
        progress_callback: (info: { status?: string; progress?: number; file?: string }) => {
          if (!onLoad) return;
          if (typeof info.progress === "number" && info.file) {
            onLoad(`Downloading ${info.file.split("/").pop()}… ${Math.round(info.progress)}%`);
          } else if (info.status === "ready") {
            onLoad("Model ready…");
          }
        },
      });
      return async (text: string) => {
        const out = await summarizer(text, { max_new_tokens: 96, truncation: true });
        const row = Array.isArray(out) ? out[0] : out;
        return String((row as { summary_text?: string }).summary_text ?? "").trim();
      };
    })().catch((err) => {
      pipePromise = undefined;
      throw err;
    });
  }
  return pipePromise;
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
 * Uses embedded pack when present; otherwise downloads DistilBART once (needs network).
 * Indonesian text is bridged through Bergamot (model is English-centric).
 */
export async function rewriteSummary(
  extracted: ExtractedSummary,
  onProgress?: Progress,
  onLoad?: LoadProgress,
): Promise<ExtractedSummary> {
  const summarize = await loadPipe(onLoad);
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
