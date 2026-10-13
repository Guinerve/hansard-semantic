import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pipeline } from "@huggingface/transformers";
import { hybridSearch, topK, type Chunk } from "./search";
import { bm25Scores, buildBm25 } from "./bm25";

const manifest = JSON.parse(readFileSync("public/index/manifest.json", "utf8"));
const chunks: Chunk[] = JSON.parse(readFileSync("public/index/chunks.json", "utf8"));
const buf = readFileSync("public/index/embeddings.i8");
const index = new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength);
const dim = manifest.dim as number;

const embedder = pipeline("feature-extraction", manifest.model, { dtype: manifest.dtype });
const embed = async (t: string) =>
  ((await (await embedder)(t, { pooling: "mean", normalize: true })) as { data: Float32Array }).data;

describe("index", () => {
  it("has one vector per chunk, each with unit norm (within int8 rounding)", () => {
    expect(index.length).toBe(chunks.length * dim);
    for (const i of [0, 7, Math.floor(chunks.length / 2), chunks.length - 1]) {
      let n = 0;
      for (let d = 0; d < dim; d++) n += (index[i * dim + d]! / 127) ** 2;
      expect(Math.sqrt(n)).toBeGreaterThan(0.98);
      expect(Math.sqrt(n)).toBeLessThan(1.02);
    }
  });

  it("embedding parity: re-embedding stored chunks reproduces their stored vectors", async () => {
    const sims: number[] = [];
    for (const i of [3, 500, 1700, 3000]) {
      const v = await embed(chunks[i]!.text);
      let dot = 0;
      for (let d = 0; d < dim; d++) dot += v[d]! * (index[i * dim + d]! / 127);
      sims.push(dot);
    }
    // Stored vectors are int8-rounded (costs ~0.004) and were built on macOS arm64; CI re-embeds on Linux x86 with
    // different q8 kernels. Measured worst case: 0.9946 locally, 0.9891 on CI. Same model, small numeric noise.
    expect(Math.min(...sims)).toBeGreaterThan(0.98);
  }, 120_000);
});

// Hand-written queries. A hit = at least one of the top 5 results contains every "must" pattern.
const QUERIES: { q: string; must: RegExp[] }[] = [
  { q: "building nuclear power stations in Australia", must: [/nuclear/i] },
  { q: "how rooftop solar is helping households cut power bills", must: [/solar/i] },
  { q: "closing coal-fired power stations and reliability of supply", must: [/coal/i] },
  { q: "the cost of transmission lines and community opposition", must: [/transmission/i] },
  { q: "home batteries subsidy", must: [/batter/i] },
  { q: "gas reservation and the east coast gas shortfall", must: [/\bgas\b/i] },
  { q: "reaching net zero emissions by 2050", must: [/net zero|emissions/i] },
  { q: "offshore wind farms and local jobs", must: [/wind/i] },
  { q: "Australia's 2035 emissions reduction target", must: [/2035|target/i] },
  { q: "hydrogen industry investment", must: [/hydrogen/i] },
  { q: "electricity prices rising for small business", must: [/electricity|power price|energy price/i] },
  { q: "renewable energy zones and the grid", must: [/renewable|grid/i] },
];

describe("search quality (keyword-checked)", () => {
  it(`top-5 hit rate on ${QUERIES.length} hand-written queries`, async () => {
    const rows: string[] = [];
    let hits = 0;
    for (const { q, must } of QUERIES) {
      const r = topK(await embed(q), index, dim, 5);
      const ok = r.some((h) => must.every((re) => re.test(chunks[h.i]!.text)));
      if (ok) hits++;
      rows.push(`${ok ? "HIT " : "MISS"}  ${q}  (top score ${r[0]!.score.toFixed(3)})`);
    }
    mkdirSync("data", { recursive: true });
    writeFileSync("data/eval-results.txt", `${hits}/${QUERIES.length} top-5 hits\n${rows.join("\n")}\n`);
    expect(hits / QUERIES.length).toBeGreaterThanOrEqual(0.75);
  }, 180_000);
});

// The labelled set (eval/queries.json + eval/qrels.tsv). Labels are pooled judgments; see eval/RESULTS.md.
const labelQueries: { id: string; query: string; target?: string }[] = JSON.parse(readFileSync("eval/queries.json", "utf8"));
const qrels = new Map<string, Map<string, number>>();
for (const line of readFileSync("eval/qrels.tsv", "utf8").trim().split("\n").slice(1)) {
  const [q, p, g] = line.split("\t");
  if (!qrels.has(q!)) qrels.set(q!, new Map());
  qrels.get(q!)!.set(p!, Number(g));
}

describe("labelled set", () => {
  it("is consistent with the index: every judged passage exists and every known-item target is judged relevant", () => {
    const ids = new Set(chunks.map((c) => c.id));
    for (const q of labelQueries) {
      const j = qrels.get(q.id);
      expect(j, q.id).toBeDefined();
      for (const [p, g] of j!) {
        expect(ids.has(p), `${q.id} → ${p}`).toBe(true);
        expect([0, 1, 2]).toContain(g);
      }
      if (q.target) expect(j!.get(q.target), q.target).toBe(2);
    }
  });

  it("shipped hybrid ranking keeps nDCG@10 above the regression floor", async () => {
    const keywords = buildBm25(chunks.map((c) => c.text));
    const gain = (g: number) => 2 ** g - 1;
    const scores: number[] = [];
    for (const q of labelQueries) {
      const j = qrels.get(q.id)!;
      const ideal = [...j.values()].sort((a, b) => b - a).slice(0, 10);
      const idcg = ideal.reduce((s, g, r) => s + gain(g) / Math.log2(r + 2), 0);
      if (!idcg) continue; // no relevant passage: nothing to rank
      const { hits } = hybridSearch(await embed(q.query), index, dim, bm25Scores(keywords, q.query), 10);
      const dcg = hits.reduce((s, h, r) => s + gain(j.get(chunks[h.i]!.id) ?? 0) / Math.log2(r + 2), 0);
      scores.push(dcg / idcg);
    }
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    // Measured 0.659 on macOS (npm run eval). The floor leaves room for CI's different q8 kernels.
    expect(mean).toBeGreaterThan(0.62);
  }, 180_000);
});
