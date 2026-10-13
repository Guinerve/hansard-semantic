import { describe, expect, it } from "vitest";
import { bm25Scores, buildBm25, tokenize } from "./bm25";
import { hybridSearch, rrf, topK, topKeyword } from "./search";

describe("ranking", () => {
  const query = new Float32Array([1, 0]);
  const vectors = new Int8Array([127, 0, 100, 0, 0, 127]);

  it("returns no semantic results when zero results are requested", () => {
    expect(topK(new Float32Array([1, 0]), new Int8Array([127, 0]), 2, 0)).toEqual([]);
  });

  it("orders semantic matches and applies the party predicate", () => {
    expect(topK(query, vectors, 2, 8).map((h) => h.i)).toEqual([0, 1, 2]);
    expect(topK(query, vectors, 2, 8, (i) => i !== 0).map((h) => h.i)).toEqual([1, 2]);
  });

  it("fuses meaning and keyword ranks, rather than their incompatible scores", () => {
    const fused = rrf([[{ i: 0 }, { i: 1 }], [{ i: 1 }, { i: 2 }]], 3);
    expect(fused.map((h) => h.i)).toEqual([1, 0, 2]);
    expect(fused[0]!.score).toBeCloseTo(1 / 62 + 1 / 61);
  });

  it("reports both rank sources and keeps the best cosine separate from fusion", () => {
    const result = hybridSearch(query, vectors, 2, new Float32Array([0, 5, 10]), 3);
    expect(result.hits).toEqual([
      { i: 2, cosine: 0, denseRank: 3, keywordRank: 1 },
      { i: 1, cosine: 100 / 127, denseRank: 2, keywordRank: 2 },
      { i: 0, cosine: 1, denseRank: 1, keywordRank: null },
    ]);
    expect(result.bestCosine).toBe(1);
  });

  it("excludes rejected passages from both halves of the hybrid ranking", () => {
    const result = hybridSearch(query, vectors, 2, new Float32Array([10, 5, 0]), 8, (i) => i !== 0);
    expect(result.hits.map((h) => h.i)).toEqual([1, 2]);
    expect(result.bestCosine).toBeCloseTo(100 / 127);
    expect(hybridSearch(query, vectors, 2, new Float32Array(3), 8, () => false)).toEqual({ hits: [], bestCosine: 0 });
  });

  it("uses meaning alone when no query words occur in the corpus", () => {
    const result = hybridSearch(query, vectors, 2, new Float32Array(3), 8);
    expect(result.hits.map((h) => h.i)).toEqual([0, 1, 2]);
    expect(result.hits.every((h) => h.keywordRank === null)).toBe(true);
  });

  it("ranks only positive accepted keyword matches", () => {
    expect(topKeyword(new Float32Array([0, 2, 5, 1]), 2, (i) => i !== 2)).toEqual([
      { i: 1, score: 2 }, { i: 3, score: 1 },
    ]);
  });
});

describe("BM25", () => {
  it("normalises case, punctuation, stopwords and simple plural suffixes", () => {
    expect(tokenize("The PRICES, subsidies and businesses!")).toEqual(["price", "subsidy", "business"]);
  });

  it("rewards rare query words over common words", () => {
    const ix = buildBm25(["solar hydrogen", "solar battery", "solar coal"]);
    const scores = bm25Scores(ix, "solar hydrogen");
    expect(scores[0]).toBeGreaterThan(scores[1]!);
    expect(scores[1]).toBe(scores[2]);
    expect(bm25Scores(ix, "hydrogen hydrogen")).toEqual(bm25Scores(ix, "hydrogen"));
  });

  it("handles empty corpora, empty texts and unmatched queries", () => {
    expect(bm25Scores(buildBm25([]), "solar")).toEqual(new Float32Array(0));
    expect(bm25Scores(buildBm25(["", "the and"]), "solar")).toEqual(new Float32Array(2));
    expect(bm25Scores(buildBm25(["solar battery"]), "the and")).toEqual(new Float32Array(1));
  });
});
