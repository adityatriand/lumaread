import type { DocText } from "../../lib/db";
import type { ExtractedSummary } from "./summarize";
import { chunkBookForSummary, cleanSummaryText } from "./summarize";
import { detectLang, translate } from "../lookup/translate";

const MODEL = "Xenova/distilbart-cnn-6-6";
const ORT_STEM = "ort-wasm-simd-threaded.asyncify";
const MAX_NEW = 160;
const MAP_NEW = 96;
const vendor = (p: string) => new URL(`/vendor/${p}`, location.href).href;

export type Progress = (done: number, total: number) => void;
export type LoadProgress = (message: string) => void;

let packOk: Promise<boolean> | undefined;
let pipePromise: Promise<(text: string, opts?: { max_new_tokens?: number; min_new_tokens?: number }) => Promise<string>> | undefined;

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
      return async (text: string, opts?: { max_new_tokens?: number; min_new_tokens?: number }) => {
        const out = await summarizer(text, {
          max_new_tokens: opts?.max_new_tokens ?? MAX_NEW,
          min_new_tokens: opts?.min_new_tokens ?? 40,
          truncation: true,
        });
        const row = Array.isArray(out) ? out[0] : out;
        return finishSentence(String((row as { summary_text?: string }).summary_text ?? "").trim());
      };
    })().catch((err) => {
      pipePromise = undefined;
      throw err;
    });
  }
  return pipePromise;
}

function finishSentence(s: string): string {
  const t = cleanSummaryText(s);
  if (!t) return t;
  if (/[.!?…]"?$/.test(t)) return t;
  const cut = Math.max(t.lastIndexOf(". "), t.lastIndexOf("! "), t.lastIndexOf("? "));
  return cut > 48 ? t.slice(0, cut + 1) : t;
}

async function translatePass(text: string, from: "id" | "en", to: "id" | "en"): Promise<string> {
  const parts = text.split(/(?<=[.!?…])\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return cleanSummaryText(await translate(text, from, to));
  const out: string[] = [];
  for (const part of parts) out.push(await translate(part, from, to));
  return finishSentence(out.join(" "));
}

type SummarizeFn = (text: string, opts?: { max_new_tokens?: number; min_new_tokens?: number }) => Promise<string>;

async function summarizeInLang(text: string, summarize: SummarizeFn, opts?: { max_new_tokens?: number; min_new_tokens?: number }): Promise<string> {
  const trimmed = cleanSummaryText(text);
  if (trimmed.length < 80) return trimmed;
  const lang = detectLang(trimmed);
  const english = lang === "id" ? await translatePass(trimmed, "id", "en") : trimmed;
  const rewritten = await summarize(english, opts);
  if (!rewritten) return trimmed;
  return lang === "id" ? await translatePass(rewritten, "en", "id") : rewritten;
}

/**
 * Whole book → one wrap: DistilBART over every body chunk, then one reduce pass.
 * chapters always empty — UI shows a single summary.
 */
export async function rewriteSummary(
  _extracted: ExtractedSummary,
  onProgress?: Progress,
  onLoad?: LoadProgress,
  texts?: DocText[],
): Promise<ExtractedSummary> {
  const summarize = await loadPipe(onLoad);
  const chunks = texts?.length ? chunkBookForSummary(texts) : [];
  // Fallback: rewrite the extractive overview only if we have no page text
  if (!chunks.length) {
    const overview = _extracted.overview
      ? await summarizeInLang(_extracted.overview, summarize, { max_new_tokens: MAX_NEW, min_new_tokens: 48 })
      : "";
    onProgress?.(1, 1);
    return { overview, chapters: [] };
  }

  const total = chunks.length + 1;
  let done = 0;
  const tick = (msg?: string) => {
    done += 1;
    onProgress?.(done, total);
    if (msg) onLoad?.(msg);
  };

  const partials: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    onLoad?.(`Summarising book… ${i + 1}/${chunks.length}`);
    const part = await summarizeInLang(chunks[i], summarize, { max_new_tokens: MAP_NEW, min_new_tokens: 32 });
    if (part) partials.push(part);
    tick();
  }

  onLoad?.("Writing final summary…");
  const merged = partials.join(" ");
  const overview = merged.length >= 80
    ? await summarizeInLang(merged, summarize, { max_new_tokens: MAX_NEW, min_new_tokens: 64 })
    : merged;
  tick();

  return { overview, chapters: [] };
}
