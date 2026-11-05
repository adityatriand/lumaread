import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import tauriConf from "./src-tauri/tauri.conf.json";
const host = process.env.TAURI_DEV_HOST;

// Runtime files that libraries fetch by URL rather than import, served from the app at /vendor/* so they work offline:
// pdf.js decoders (JBIG2/JPEG 2000 wasm), CJK cmaps, standard fonts, ICC profiles; tesseract worker, engine, language data;
// offline dictionaries; ORT wasm for optional summarization
const require = createRequire(import.meta.url);
const pkgDir = (name: string, from?: string) =>
  path.dirname(createRequire(from ?? import.meta.url).resolve(`${name}/package.json`));
const pdfjs = pkgDir("pdfjs-dist");
const tesseract = pkgDir("tesseract.js");
// Package exports hide subpaths; resolve("onnxruntime-web") lands in dist/
const ortDist = path.dirname(require.resolve("onnxruntime-web"));
const SUMMARIZE_ROOT = path.resolve("data/summarization");

// Generated data isn't committed; fail with the fix instead of shipping an app without it
function dataFiles(dir: string): [string, string][] {
  const root = path.resolve("data", dir);
  if (!fs.existsSync(root)) throw new Error(`data/${dir} is missing; run \`pnpm setup:data\` once`);
  return fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && !e.name.endsWith(".md"))
    .map((e) => {
      const file = path.join(e.parentPath, e.name);
      return [`${dir === "dictionaries" ? "dict" : dir}/${path.relative(root, file)}`, file];
    });
}

const VENDOR_FILES: Record<string, string> = {
  ...Object.fromEntries(
    ["wasm", "cmaps", "standard_fonts", "iccs"].flatMap((folder) =>
      fs
        .readdirSync(path.join(pdfjs, folder))
        // quickjs only runs PDF-embedded JavaScript, which we never enable
        .filter((f) => !f.startsWith("quickjs"))
        .map((f) => [`pdfjs/${folder}/${f}`, path.join(pdfjs, folder, f)]),
    ),
  ),
  "tesseract/worker.min.js": path.join(tesseract, "dist/worker.min.js"),
  // shortcut: SIMD build only (WKWebView 16.4+ and Android Chromium 91+ have it); add the plain build for older webviews
  "tesseract/core/tesseract-core-simd-lstm.wasm.js": path.join(pkgDir("tesseract.js-core", require.resolve("tesseract.js")), "tesseract-core-simd-lstm.wasm.js"),
  "tesseract/lang/eng.traineddata.gz": require.resolve("@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz"),
  "tesseract/lang/ind.traineddata.gz": require.resolve("@tesseract.js-data/ind/4.0.0_best_int/ind.traineddata.gz"),
  // Bergamot's worker loads its glue script and wasm relative to itself, so all three ship unchanged side by side
  ...Object.fromEntries(
    ["translator-worker.js", "bergamot-translator-worker.js", "bergamot-translator-worker.wasm"].map((f) => [
      `bergamot/${f}`,
      path.join(pkgDir("@browsermt/bergamot-translator"), "worker", f),
    ]),
  ),
  // ONNX Runtime for DistilBART — transformers.js defaults to asyncify; plain for older Safari
  "ort/ort-wasm-simd-threaded.asyncify.mjs": path.join(ortDist, "ort-wasm-simd-threaded.asyncify.mjs"),
  "ort/ort-wasm-simd-threaded.asyncify.wasm": path.join(ortDist, "ort-wasm-simd-threaded.asyncify.wasm"),
  "ort/ort-wasm-simd-threaded.mjs": path.join(ortDist, "ort-wasm-simd-threaded.mjs"),
  "ort/ort-wasm-simd-threaded.wasm": path.join(ortDist, "ort-wasm-simd-threaded.wasm"),
  "ort/ort-wasm-simd-threaded.jsep.mjs": path.join(ortDist, "ort-wasm-simd-threaded.jsep.mjs"),
  "ort/ort-wasm-simd-threaded.jsep.wasm": path.join(ortDist, "ort-wasm-simd-threaded.jsep.wasm"),
  // Downloaded by scripts/fetch-translation-models.mjs
  ...Object.fromEntries(dataFiles("translation")),
  // Built by scripts/build-dictionaries.mjs
  ...Object.fromEntries(dataFiles("dictionaries")),
};

// Optional ~284 MB pack from `pnpm setup:summarize` — not required to build; copied, not emitFile'd (avoids OOM)
function summarizeFile(urlPath: string): string | undefined {
  if (!urlPath.startsWith("summarization/")) return undefined;
  const file = path.resolve(SUMMARIZE_ROOT, urlPath.slice("summarization/".length));
  if (!file.startsWith(SUMMARIZE_ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return undefined;
  return file;
}

function vendorAssets(): Plugin {
  return {
    name: "vendor-assets",
    configureServer(server) {
      server.middlewares.use("/vendor", (req, res, next) => {
        const url = decodeURIComponent((req.url ?? "").split("?")[0]).replace(/^\//, "");
        const file = VENDOR_FILES[url] ?? summarizeFile(url);
        if (!file) return next();
        if (file.endsWith(".wasm")) res.setHeader("Content-Type", "application/wasm");
        else if (file.endsWith(".mjs") || file.endsWith(".js")) res.setHeader("Content-Type", "text/javascript");
        else if (file.endsWith(".onnx")) res.setHeader("Content-Type", "application/octet-stream");
        fs.createReadStream(file).pipe(res);
      });
    },
    generateBundle(_, bundle) {
      // Tauri picks MIME types by sniffing content (infer: "%PDF" anywhere in the first 1 KB = PDF);
      // a script mislabelled that way fails to load in the app, so refuse to build one
      for (const [name, out] of Object.entries(bundle)) {
        const text = out.type === "chunk" ? out.code : typeof out.source === "string" ? out.source : "";
        if (/\.(m?js|css|html)$/.test(name) && text.slice(0, 1024).includes("%PDF")) this.error(`${name} contains "%PDF" in its first 1 KB; Tauri would serve it as application/pdf`);
      }
      for (const [url, file] of Object.entries(VENDOR_FILES)) {
        this.emitFile({ type: "asset", fileName: `vendor/${url}`, source: fs.readFileSync(file) });
      }
    },
    writeBundle(options) {
      // Opt-in only: default releases stay ~50 MB. Dev still serves data/ via middleware.
      // Embed with: LUMAREAD_EMBED_SUMMARIZE=1 pnpm build
      if (process.env.LUMAREAD_EMBED_SUMMARIZE !== "1" || !fs.existsSync(SUMMARIZE_ROOT)) return;
      const outDir = options.dir;
      if (!outDir) return;
      fs.cpSync(SUMMARIZE_ROOT, path.join(outDir, "vendor/summarization"), {
        recursive: true,
        filter: (src) => !src.endsWith(".md"),
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), vendorAssets()],
  build: {
    // Vite 8 defaults to oxc minify (no separate esbuild install)
    minify: true,
    cssMinify: true,
    sourcemap: false,
    target: "es2022",
    chunkSizeWarningLimit: 2500,
    // Do not manualChunks transformers/onnx — that pulled them into the entry preload and blanked the app
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // E2E tests run against preview, so serve the same CSP the app ships with
  preview: { headers: { "Content-Security-Policy": tauriConf.app.security.csp } },
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
