// Okapi BM25 over the passage texts: the keyword baseline the semantic ranker is measured against.

const STOP = new Set(
  ("a an and are as at be been but by for from had has have he her his i if in into is it its me my no not of on or our " +
    "she so than that the their them there these they this those to us was we were what when which who will with would you your " +
    "do does did can could should may might must also just very more most some such any all about over out up only own same then too")
    .split(" "),
);

/** Lower-case word tokens with stopwords removed and a light suffix strip ("prices" → "price", "subsidies" → "subsidy"). */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const w of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (STOP.has(w) || w.length < 2) continue;
    out.push(stem(w));
  }
  return out;
}

function stem(w: string): string {
  if (w.length <= 4) return w;
  if (w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.endsWith("sses")) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us")) return w.slice(0, -1);
  return w;
}

export interface Bm25Index {
  postings: Map<string, { doc: number; tf: number }[]>;
  docLen: Uint32Array;
  avgLen: number;
  n: number;
}

export function buildBm25(texts: string[]): Bm25Index {
  const postings = new Map<string, { doc: number; tf: number }[]>();
  const docLen = new Uint32Array(texts.length);
  texts.forEach((t, doc) => {
    const toks = tokenize(t);
    docLen[doc] = toks.length;
    const tf = new Map<string, number>();
    for (const w of toks) tf.set(w, (tf.get(w) ?? 0) + 1);
    for (const [w, n] of tf) {
      let p = postings.get(w);
      if (!p) postings.set(w, (p = []));
      p.push({ doc, tf: n });
    }
  });
  const avgLen = docLen.reduce((a, b) => a + b, 0) / Math.max(1, texts.length);
  return { postings, docLen, avgLen, n: texts.length };
}

/** BM25 score for every passage (0 where no query term occurs). */
export function bm25Scores(ix: Bm25Index, query: string, k1 = 1.2, b = 0.75): Float32Array {
  const scores = new Float32Array(ix.n);
  for (const w of new Set(tokenize(query))) {
    const p = ix.postings.get(w);
    if (!p) continue;
    const idf = Math.log(1 + (ix.n - p.length + 0.5) / (p.length + 0.5));
    for (const { doc, tf } of p) {
      scores[doc]! += (idf * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * ix.docLen[doc]!) / ix.avgLen));
    }
  }
  return scores;
}
