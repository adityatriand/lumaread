// Builds the offline dictionaries in data/dictionaries/ from:
//   English: Open English WordNet 2025 (CC BY 4.0) https://github.com/globalwordnet/english-wordnet
//   Indonesian: Wiktionary via kaikki.org (CC BY-SA 4.0) https://kaikki.org/dictionary/Indonesian/
// Output: data/dictionaries/{en,id}/{shard}.json, shard = first letter (or "_"), each { word: [[pos, gloss], ...] }
// Run: node scripts/build-dictionaries.mjs   (downloads ~80 MB into .cache/, needs `unzip`)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const ROOT = path.resolve(import.meta.dirname, "..");
const CACHE = path.join(ROOT, ".cache/dictionaries");
const OUT = path.join(ROOT, "data/dictionaries");
const SOURCES = {
  oewn: "https://github.com/globalwordnet/english-wordnet/releases/download/2025-edition/english-wordnet-2025-json.zip",
  kaikki: "https://kaikki.org/dictionary/Indonesian/kaikki.org-dictionary-Indonesian.jsonl",
};
const MAX_SENSES = 3;
const MAX_GLOSS = 160;

async function download(url, file) {
  if (fs.existsSync(file)) return;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

const shardOf = (word) => (/^[a-z]/.test(word) ? word[0] : "_");
const clip = (s) => (s.length > MAX_GLOSS ? s.slice(0, MAX_GLOSS - 1).trimEnd() + "…" : s);

function add(dict, word, pos, gloss) {
  const key = word.toLowerCase();
  const senses = (dict[key] ??= []);
  if (senses.length < MAX_SENSES && !senses.some(([, g]) => g === gloss)) senses.push([pos, clip(gloss)]);
}

function write(lang, dict) {
  const shards = {};
  for (const [word, senses] of Object.entries(dict)) (shards[shardOf(word)] ??= Object.create(null))[word] = senses;
  fs.rmSync(path.join(OUT, lang), { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, lang), { recursive: true });
  for (const [shard, entries] of Object.entries(shards)) fs.writeFileSync(path.join(OUT, lang, `${shard}.json`), JSON.stringify(entries));
  console.log(`${lang}: ${Object.keys(dict).length} words in ${Object.keys(shards).length} shards`);
}

const OEWN_POS = { n: "noun", v: "verb", a: "adj", s: "adj", r: "adv" };

async function buildEnglish() {
  const zip = path.join(CACHE, "oewn.zip");
  const dir = path.join(CACHE, "oewn");
  await download(SOURCES.oewn, zip);
  if (!fs.existsSync(dir)) execFileSync("unzip", ["-q", "-o", zip, "-d", dir]);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  const synsets = {};
  for (const f of files.filter((f) => /^(noun|verb|adj|adv)\./.test(f))) Object.assign(synsets, JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
  const dict = Object.create(null); // no prototype: words like "constructor" are keys too
  for (const f of files.filter((f) => f.startsWith("entries-"))) {
    for (const [lemma, byPos] of Object.entries(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")))) {
      for (const [pos, entry] of Object.entries(byPos)) {
        // Senses are listed most-frequent first
        for (const sense of entry.sense ?? []) {
          const gloss = synsets[sense.synset]?.definition?.[0];
          if (gloss) add(dict, lemma, OEWN_POS[pos] ?? pos, gloss);
        }
      }
    }
  }
  write("en", dict);
}

async function buildIndonesian() {
  const file = path.join(CACHE, "kaikki-id.jsonl");
  await download(SOURCES.kaikki, file);
  const dict = Object.create(null); // no prototype: words like "constructor" are keys too
  for await (const line of readline.createInterface({ input: fs.createReadStream(file) })) {
    const entry = JSON.parse(line);
    if (entry.lang_code !== "id") continue;
    for (const sense of entry.senses ?? []) {
      const gloss = sense.glosses?.[0];
      if (gloss && !sense.tags?.includes("form-of")) add(dict, entry.word, entry.pos, gloss);
      // "form of" entries point at their root, e.g. menatap → tatap
      else if (sense.form_of?.[0]?.word) add(dict, entry.word, entry.pos, `form of ${sense.form_of[0].word}`);
    }
  }
  write("id", dict);
}

fs.mkdirSync(CACHE, { recursive: true });
await buildEnglish();
await buildIndonesian();
