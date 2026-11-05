// Verifies DistilBART + ORT under the app CSP (WebKit ≈ macOS WKWebView).
// LUMAREAD_EMBED_SUMMARIZE=1 pnpm build && node scripts/verify-ai-rewrite.mjs
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "@playwright/test";
import tauriConf from "../src-tauri/tauri.conf.json" with { type: "json" };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const csp = tauriConf.app.security.csp;

for (const need of [
  "vendor/summarization/manifest.json",
  "vendor/ort/ort-wasm-simd-threaded.asyncify.mjs",
  "vendor/ort/ort-wasm-simd-threaded.asyncify.wasm",
]) {
  if (!existsSync(path.join(dist, need))) {
    console.error(`Missing dist/${need}`);
    process.exit(1);
  }
}

const tfHit = readdirSync(path.join(dist, "assets")).find((f) => f.startsWith("transformers.web-") && f.endsWith(".js"));
const transformersUrl = `/assets/${tfHit}`;
console.log("transformers", transformersUrl);

const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".onnx": "application/octet-stream",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const file = path.join(dist, url === "/" ? "index.html" : url);
  if (!file.startsWith(dist) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404);
    res.end("missing");
    return;
  }
  const body = readFileSync(file);
  res.writeHead(200, {
    "Content-Type": mime[path.extname(file)] ?? "application/octet-stream",
    "Content-Length": body.length,
    "Content-Security-Policy": csp,
    "Cache-Control": "no-store",
  });
  res.end(body);
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

async function probe(browserType, name) {
  const browser = await browserType.launch();
  const page = await (await browser.newContext()).newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log(`[${name}:error]`, msg.text());
  });
  page.on("pageerror", (err) => console.log(`[${name}:pageerror]`, err.message));
  await page.goto(base + "/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async (tfUrl) => {
    const vendor = (p) => new URL(`/vendor/${p}`, location.href).href;
    const ORT_STEM = "ort-wasm-simd-threaded.asyncify";
    const MODEL = "Xenova/distilbart-cnn-6-6";
    try {
      const { env, pipeline } = await import(tfUrl);
      const base = vendor("summarization/");
      env.allowRemoteModels = true;
      env.allowLocalModels = true;
      env.remoteHost = base;
      env.remotePathTemplate = "{model}/";
      env.localModelPath = base;
      env.useBrowserCache = false;
      env.useWasmCache = false;

      const [mjsRes, wasmRes] = await Promise.all([
        fetch(vendor(`ort/${ORT_STEM}.mjs`)),
        fetch(vendor(`ort/${ORT_STEM}.wasm`)),
      ]);
      if (!mjsRes.ok || !wasmRes.ok) return { ok: false, stage: "ort-fetch", detail: `${mjsRes.status}/${wasmRes.status}` };
      let code = await mjsRes.text();
      code = code.replaceAll("globalThis.process?.versions?.node", "false");
      const wasm = env.backends.onnx.wasm ?? (env.backends.onnx.wasm = {});
      wasm.wasmPaths = { mjs: URL.createObjectURL(new Blob([code], { type: "text/javascript" })) };
      wasm.wasmBinary = await wasmRes.arrayBuffer();
      wasm.numThreads = 1;
      wasm.proxy = false;

      const summarizer = await pipeline("summarization", MODEL, { dtype: "q8" });
      if (!summarizer.tokenizer) return { ok: false, stage: "tokenizer-null" };
      const out = await summarizer(
        "Ayane waters the pansies while detectives wait downstairs. The dry pot keeps coming up in every interview about that evening at the house.",
        { max_new_tokens: 48, truncation: true },
      );
      const row = Array.isArray(out) ? out[0] : out;
      const text = String(row?.summary_text ?? "").trim();
      return { ok: text.length > 10, stage: "summarize", text: text.slice(0, 240) };
    } catch (e) {
      return { ok: false, stage: "exception", detail: String(e?.message ?? e), stack: String(e?.stack ?? "").slice(0, 500) };
    }
  }, transformersUrl);

  await browser.close();
  console.log(`[${name}]`, result);
  return result;
}

let failed = false;
for (const [type, name] of [
  [webkit, "webkit"],
  [chromium, "chromium"],
]) {
  try {
    if (!(await probe(type, name))?.ok) failed = true;
  } catch (e) {
    console.error(`[${name}] FAIL`, e);
    failed = true;
  }
}
server.close();
process.exit(failed ? 1 : 0);
