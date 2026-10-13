export interface Chunk {
  id: string;
  date: string;
  speaker: string;
  party: string;
  division: string;
  heading: string;
  text: string;
  url: string;
}
export interface Hit {
  chunk: Chunk;
  score: number;
}

/** Cosine similarity against an int8-quantised, L2-normalised index. `query` must be L2-normalised. */
export function topK(
  query: Float32Array,
  index: Int8Array,
  dim: number,
  k: number,
  accept: (i: number) => boolean = () => true,
): { i: number; score: number }[] {
  if (k <= 0) return [];
  const n = index.length / dim;
  const best: { i: number; score: number }[] = [];
  for (let i = 0; i < n; i++) {
    if (!accept(i)) continue;
    const s = cosineAt(query, index, dim, i);
    if (best.length < k || s > best[best.length - 1]!.score) {
      let j = best.length;
      best.push({ i, score: s });
      while (j > 0 && best[j - 1]!.score < s) { best[j] = best[j - 1]!; j--; }
      best[j] = { i, score: s };
      if (best.length > k) best.pop();
    }
  }
  return best;
}

/** Reciprocal-rank fusion of several ranked lists (k = 60, the usual default): each list adds 1 / (k + rank). */
export function rrf(lists: { i: number }[][], n: number, k = 60): { i: number; score: number }[] {
  const acc = new Map<number, number>();
  for (const list of lists) list.forEach(({ i }, r) => acc.set(i, (acc.get(i) ?? 0) + 1 / (k + r + 1)));
  return [...acc].sort((a, b) => b[1] - a[1]).slice(0, n).map(([i, score]) => ({ i, score }));
}

/** Indices of the n highest non-zero keyword scores, best first. */
export function topKeyword(scores: Float32Array, n: number, accept: (i: number) => boolean = () => true): { i: number; score: number }[] {
  const out: { i: number; score: number }[] = [];
  for (let i = 0; i < scores.length; i++) if (scores[i]! > 0 && accept(i)) out.push({ i, score: scores[i]! });
  return out.sort((a, b) => b.score - a.score).slice(0, n);
}

export interface HybridHit {
  i: number;
  /** Cosine similarity between the query and passage embeddings (-1..1). */
  cosine: number;
  /** 1-based ranks in the meaning (embedding) and keyword (BM25) lists, or null if the passage was not in that list's top 100. */
  denseRank: number | null;
  keywordRank: number | null;
}

/**
 * The shipped ranker: fuse the embedding ranking with a BM25 keyword ranking (top 100 of each) by reciprocal rank.
 * On the model-draft labels it improves mean nDCG@10, but regresses on some queries (eval/RESULTS.md).
 */
export function hybridSearch(
  query: Float32Array,
  index: Int8Array,
  dim: number,
  keywordScores: Float32Array,
  k: number,
  accept: (i: number) => boolean = () => true,
): { hits: HybridHit[]; bestCosine: number } {
  const dense = topK(query, index, dim, 100, accept);
  const keyword = topKeyword(keywordScores, 100, accept);
  const denseRank = new Map(dense.map(({ i }, r) => [i, r + 1]));
  const keywordRank = new Map(keyword.map(({ i }, r) => [i, r + 1]));
  const hits = rrf([dense, keyword], k).map(({ i }) => ({
    i,
    cosine: cosineAt(query, index, dim, i),
    denseRank: denseRank.get(i) ?? null,
    keywordRank: keywordRank.get(i) ?? null,
  }));
  // The weak-match check uses the best embedding match in the whole collection, not the fused top result.
  return { hits, bestCosine: dense[0]?.score ?? 0 };
}

export function cosineAt(query: Float32Array, index: Int8Array, dim: number, i: number): number {
  let s = 0;
  const off = i * dim;
  for (let d = 0; d < dim; d++) s += query[d]! * index[off + d]!;
  return s / 127;
}

/**
 * Below this best-match cosine the UI warns that nothing in the collection is a strong match. Chosen from the labelled
 * set: every query with no relevant passage scored ≤ 0.28 with the shipped model, and only 2 of 47 answerable queries did.
 */
export const WEAK_MATCH = 0.3;
