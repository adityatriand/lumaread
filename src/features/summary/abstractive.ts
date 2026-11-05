import type { ExtractedSummary } from "./summarize";
import { detectLang, translate } from "../lookup/translate";

const MODEL = "Xenova/distilbart-cnn-6-6";
const ORT_STEM = "ort-wasm-simd-threaded.asyncify";
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

/**
 * Preload ORT for Tauri/WebView:
 * blob: .mjs (correct MIME) + wasmBinary (blob has no relative .wasm path) + single thread.
 * Mutate wasm config in place — replacing the object makes ORT fall back to jsDelivr.
 */
async function configureOrt(env: {
  useWasmCache: boolean;
  backends: { onnx: { wasm?: Record<string, unknown> } };
}) {
  const [mjsRes, wasmRes] = await Promise.all([
    fetch(vendor(`ort/${ORT_STEM}.mjs`)),
    fetch(vendor(`ort/${ORT_STEM}.wasm`)),
  ]);
  if (!mjsRes.ok || !wasmRes.ok) {
    throw new Error(`ORT assets missing (${ORT_STEM}: ${mjsRes.status}/${wasmRes.status})`);
  }
  let code = await mjsRes.text();
  code = code.replaceAll("globalThis.process?.versions?.node", "false");
  const mjs = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  const wasmBinary = await wasmRes.arrayBuffer();

  env.useWasmCache = false;
  const wasm = env.backends.onnx.wasm ?? (env.backends.onnx.wasm = {});
  wasm.wasmPaths = { mjs };
  wasm.wasmBinary = wasmBinary;
  wasm.numThreads = 1;
  wasm.proxy = false;
}

/**
 * transformers.js only probes local *filesystem* paths for tokenizer existence.
 * Browser/Tauri serve the pack over http(s), so that probe is skipped and the
 * tokenizer is dropped unless "remote" points at our own /vendor/summarization.
 */
function configureModelHost(env: {
  allowRemoteModels: boolean;
  allowLocalModels: boolean;
  remoteHost: string;
  remotePathTemplate: string;
  localModelPath: string;
}, local: boolean) {
  if (local) {
    const base = vendor("summarization/");
    env.allowRemoteModels = true;
    env.allowLocalModels = true;
    env.remoteHost = base;
    env.remotePathTemplate = "{model}/";
    env.localModelPath = base;
  } else {
    env.allowRemoteModels = true;
    env.allowLocalModels = false;
  }
}

async function loadPipe(onLoad?: LoadProgress) {
  if (!pipePromise) {
    pipePromise = (async () => {
      const local = await summarizationPackAvailable();
      const { env, pipeline } = await import("@huggingface/transformers");
      configureModelHost(env as Parameters<typeof configureModelHost>[0], local);
      await configureOrt(env as Parameters<typeof configureOrt>[0]);

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

/** One fluent rewrite of the overview (plus chapter wraps when present). */
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
