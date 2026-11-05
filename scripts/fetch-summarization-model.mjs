// Downloads Xenova/distilbart-cnn-6-6 (q8 ONNX) into data/summarization/ for on-device abstractive rewrite.
// Optional: ~284 MB. Build works without it; Summary stays extractive until you run this and rebuild.
// Licence: Apache-2.0 (sshleifer/distilbart-cnn-6-6 via Xenova ONNX export)
// Run: node scripts/fetch-summarization-model.mjs
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const MODEL = "Xenova/distilbart-cnn-6-6";
const OUT = path.join(ROOT, "data/summarization", MODEL);
const BASE = `https://huggingface.co/${MODEL}/resolve/main`;

// Smallest useful encoder–decoder pair for transformers.js dtype "q8"
// tokenizer.json is enough (skip separate vocab.json / merges.txt ~1.2 MB)
const FILES = [
  "config.json",
  "generation_config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "special_tokens_map.json",
  "onnx/encoder_model_quantized.onnx",
  "onnx/decoder_model_merged_quantized.onnx",
];

fs.mkdirSync(path.join(OUT, "onnx"), { recursive: true });

for (const rel of FILES) {
  const dest = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    console.log(`ok (cached) ${rel}`);
    continue;
  }
  process.stdout.write(`get ${rel}… `);
  const res = await fetch(`${BASE}/${rel}`);
  if (!res.ok) throw new Error(`${rel}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  console.log(`${(buf.length / 1e6).toFixed(1)} MB  sha256 ${crypto.createHash("sha256").update(buf).digest("hex").slice(0, 12)}`);
}

fs.writeFileSync(
  path.join(ROOT, "data/summarization/manifest.json"),
  JSON.stringify({ model: MODEL, dtype: "q8", files: FILES }, null, 2) + "\n",
);
console.log("done → data/summarization/");
