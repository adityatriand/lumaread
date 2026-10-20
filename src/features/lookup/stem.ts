// Candidate dictionary forms for an inflected word, most likely first. Over-generating is fine:
// each candidate is only used if the dictionary actually has it.

const ID_PARTICLES = ["lah", "kah", "tah", "pun"];
const ID_POSSESSIVES = ["nya", "ku", "mu"];
const ID_SUFFIXES = ["kan", "an", "i"];
// meN-/peN- assimilate with the root's first letter: menatap ← tatap, memukul ← pukul, menyapu ← sapu, mengirim ← kirim
const ID_NASAL: [string, string[]][] = [
  ["meny", ["s"]], ["peny", ["s"]],
  ["meng", ["", "k"]], ["peng", ["", "k"]],
  ["mem", ["", "p"]], ["pem", ["", "p"]],
  ["men", ["", "t"]], ["pen", ["", "t"]],
  ["me", [""]], ["pe", [""]],
];
const ID_PREFIXES = ["di", "ke", "se", "ter", "ber", "be", "per"];

function stripSuffixes(w: string): string[] {
  const out = [w];
  for (const p of ID_PARTICLES) if (w.endsWith(p) && w.length > p.length + 3) out.push(w.slice(0, -p.length));
  for (const base of [...out]) {
    for (const p of ID_POSSESSIVES) if (base.endsWith(p) && base.length > p.length + 3) out.push(base.slice(0, -p.length));
  }
  for (const base of [...out]) {
    for (const s of ID_SUFFIXES) if (base.endsWith(s) && base.length > s.length + 3) out.push(base.slice(0, -s.length));
  }
  return out;
}

function stripPrefix(w: string): string[] {
  const out: string[] = [];
  for (const [prefix, restores] of ID_NASAL) {
    if (!w.startsWith(prefix)) continue;
    for (const r of restores) out.push(r + w.slice(prefix.length));
    break;
  }
  for (const p of ID_PREFIXES) if (w.startsWith(p)) out.push(w.slice(p.length));
  return out.filter((c) => c.length >= 3);
}

export function indonesianRoots(word: string): string[] {
  const w = word.toLowerCase();
  const out = new Set<string>();
  for (const s of stripSuffixes(w)) {
    out.add(s);
    for (const p of stripPrefix(s)) {
      out.add(p);
      // Two prefixes stack: diperbaiki → perbaiki → baiki → baik
      for (const p2 of stripPrefix(p)) out.add(p2);
    }
  }
  out.delete(w);
  return [...out];
}

export function englishLemmas(word: string): string[] {
  const w = word.toLowerCase();
  const out: string[] = [];
  const doubled = (s: string) => (s.length > 3 && s.at(-1) === s.at(-2) ? [s.slice(0, -1)] : []);
  if (w.endsWith("ies")) out.push(w.slice(0, -3) + "y");
  if (w.endsWith("es")) out.push(w.slice(0, -2));
  if (w.endsWith("s") && !w.endsWith("ss")) out.push(w.slice(0, -1));
  if (w.endsWith("ied")) out.push(w.slice(0, -3) + "y");
  for (const suffix of ["ed", "ing", "er", "est"]) {
    if (!w.endsWith(suffix) || w.length < suffix.length + 3) continue;
    const base = w.slice(0, -suffix.length);
    out.push(base, base + "e", ...doubled(base));
  }
  if (w.endsWith("ly")) out.push(w.slice(0, -2));
  return [...new Set(out)];
}
