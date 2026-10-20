import { englishLemmas, indonesianRoots } from "./stem";

export type Lang = "id" | "en";
export type Sense = [pos: string, gloss: string];
export interface Definition { lang: Lang; word: string; senses: Sense[]; via?: string }

type Shard = Record<string, Sense[]>;
const shards = new Map<string, Promise<Shard>>();

// Served by the vendor-assets plugin; one small file per first letter, loaded on first use
function shard(lang: Lang, word: string): Promise<Shard> {
  const key = `${lang}/${/^[a-z]/.test(word) ? word[0] : "_"}`;
  let p = shards.get(key);
  if (!p) {
    p = fetch(new URL(`/vendor/dict/${key}.json`, location.href)).then((r) => (r.ok ? r.json() : {}));
    p.catch(() => shards.delete(key)); // let a later lookup retry
    shards.set(key, p);
  }
  return p;
}

async function entry(lang: Lang, word: string): Promise<Sense[] | undefined> {
  const s = await shard(lang, word);
  return Object.hasOwn(s, word) ? s[word] : undefined;
}

// Strip quotes and punctuation that come along with a tapped or selected word
export const cleanWord = (s: string) => s.trim().toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

// Wiktionary often defines an inflected form only as "active of tatap"; pull in the root's meaning too
const ROOT_REF = /\bof ([\p{L}-]+)$/u;

async function defineIn(lang: Lang, word: string): Promise<Definition | undefined> {
  const candidates = [word, ...(lang === "id" ? indonesianRoots(word) : englishLemmas(word))];
  for (const candidate of candidates) {
    const senses = await entry(lang, candidate);
    if (!senses) continue;
    const root = senses.map(([, g]) => g.match(ROOT_REF)?.[1]).find(Boolean);
    const rootSenses = root && root !== candidate ? await entry(lang, root) : undefined;
    return {
      lang,
      word: candidate,
      senses: rootSenses ? [...senses, ...rootSenses.filter(([, g]) => !ROOT_REF.test(g))] : senses,
      via: candidate !== word ? word : undefined,
    };
  }
  return undefined;
}

export async function define(selection: string): Promise<Definition[]> {
  const word = cleanWord(selection);
  if (!word || /\s/.test(word)) return [];
  const results = await Promise.all((["id", "en"] as const).map((lang) => defineIn(lang, word)));
  return results.filter((d): d is Definition => !!d);
}
