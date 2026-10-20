// Downloads Firefox Translations (Bergamot) models for Indonesian <-> English into data/translation/
// and verifies each file against the SHA-256 published in Mozilla's Remote Settings.
// Models: MPL-2.0, https://github.com/mozilla/firefox-translations-models
// Run: node scripts/fetch-translation-models.mjs
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "data/translation");
const RECORDS = "https://firefox.settings.services.mozilla.com/v1/buckets/main/collections/translations-models/records";
const PAIRS = [["id", "en"], ["en", "id"]];
const VERSION = "1.0"; // pinned; bump deliberately after testing a newer release

const { data: records } = await (await fetch(RECORDS)).json();
const { capabilities } = await (await fetch("https://firefox.settings.services.mozilla.com/v1/")).json();
const base = capabilities.attachments.base_url;
const manifest = {};

for (const [from, to] of PAIRS) {
  const pair = `${from}${to}`;
  fs.mkdirSync(path.join(OUT, pair), { recursive: true });
  manifest[pair] = {};
  for (const type of ["model", "lex", "vocab"]) {
    const record = records.find((r) => r.fromLang === from && r.toLang === to && r.fileType === type && r.version === VERSION);
    if (!record) throw new Error(`No ${type} v${VERSION} for ${pair}`);
    const { filename, hash, location } = record.attachment;
    const file = path.join(OUT, pair, filename);
    const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
    if (!fs.existsSync(file) || sha(fs.readFileSync(file)) !== hash) {
      const buf = Buffer.from(await (await fetch(base + location)).arrayBuffer());
      if (sha(buf) !== hash) throw new Error(`Checksum mismatch for ${filename}`);
      fs.writeFileSync(file, buf);
    }
    manifest[pair][type] = filename;
    console.log(`${pair} ${type}: ${filename} ok`);
  }
}
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
