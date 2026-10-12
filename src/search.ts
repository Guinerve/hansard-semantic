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
  const n = index.length / dim;
  const best: { i: number; score: number }[] = [];
  for (let i = 0; i < n; i++) {
    if (!accept(i)) continue;
    let s = 0;
    const off = i * dim;
    for (let d = 0; d < dim; d++) s += query[d]! * index[off + d]!;
    s /= 127;
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
