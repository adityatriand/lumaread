import type { Lang } from "./dictionary";

const vendor = (p: string) => new URL(`/vendor/${p}`, location.href).href;

type Call = (name: string, ...args: unknown[]) => Promise<unknown>;

let clientPromise: Promise<Call> | undefined;

// Talks to Bergamot's own worker (served unchanged from /vendor/bergamot) over its {id, name, args} protocol
function client(): Promise<Call> {
  return (clientPromise ??= (async () => {
    const worker = new Worker(vendor("bergamot/translator-worker.js"));
    const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
    let serial = 0;
    worker.onmessage = ({ data: { id, result, error } }) => {
      const p = pending.get(id);
      pending.delete(id);
      if (error) p?.reject(new Error(error.message));
      else p?.resolve(result);
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || "Translation engine crashed"));
      pending.clear();
      clientPromise = undefined; // next call starts a fresh worker
      models.clear();
    };
    const call: Call = (name, ...args) =>
      new Promise((resolve, reject) => {
        const id = ++serial;
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, name, args });
      });
    // Native int gemm is Firefox-only; the wasm fallback works everywhere
    await call("initialize", { useNativeIntGemm: false, cacheSize: 0 });
    return call;
  })());
}

const models = new Map<string, Promise<void>>();

// ~21 MB per direction: loaded into the worker on first use, then kept for the session
function loadModel(call: Call, from: Lang, to: Lang) {
  const pair = `${from}${to}`;
  let p = models.get(pair);
  if (!p) {
    p = (async () => {
      const manifest = await (await fetch(vendor("translation/manifest.json"))).json();
      const files: { model: string; lex: string; vocab: string } = manifest[pair];
      const [model, shortlist, vocab] = await Promise.all(
        [files.model, files.lex, files.vocab].map(async (f) => (await fetch(vendor(`translation/${pair}/${f}`))).arrayBuffer()),
      );
      await call("loadTranslationModel", { from, to }, { model, shortlist, vocabs: [vocab], config: {} });
    })();
    p.catch(() => models.delete(pair));
    models.set(pair, p);
  }
  return p;
}

export async function translate(text: string, from: Lang, to: Lang): Promise<string> {
  const call = await client();
  await loadModel(call, from, to);
  const [response] = (await call("translate", { models: [{ from, to }], texts: [{ text, html: false, qualityScores: false }] })) as { target: { text: string } }[];
  return response.target.text;
}

const ID_WORDS = new Set("yang dan di ke dari ini itu dengan untuk tidak ada saya kau anda dia kami kita mereka akan sudah juga atau karena pada dalam bisa apa nya lagi tapi kata".split(" "));
const EN_WORDS = new Set("the and of to a in is it that was for on with as he she you i be at by this had not but from have they his her are were what".split(" "));

// Function-word vote; good enough to pick a direction, and the panel lets the reader flip it
export function detectLang(text: string): Lang {
  let id = 0;
  let en = 0;
  for (const w of text.toLowerCase().match(/\p{L}+/gu) ?? []) {
    if (ID_WORDS.has(w)) id++;
    if (EN_WORDS.has(w)) en++;
    // Indonesian affixes are a strong hint on short selections
    if (/^(meng|meny|mem|men|ber|ter|di|ke)\p{L}{3,}(kan|an|nya|i)$/u.test(w)) id += 0.5;
  }
  return en > id ? "en" : "id";
}
