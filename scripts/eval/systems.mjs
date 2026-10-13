// Retrieval systems compared by the evaluation. Each returns a ranked list of passage indices with scores.
//
// - minilm:   exactly what ships (the int8 index in public/index + the same q8 model, mean pooling)
// - bge-small, gte-small: alternative small embedding models of the same dimension (384), so the index size is unchanged
// - bm25:     keyword baseline
// - hybrid-*: reciprocal-rank fusion of an embedding model and BM25. hybrid-minilm is what the site ships
//             (src/search.ts hybridSearch, called here exactly as the browser calls it).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pipeline } from "@huggingface/transformers";
import { hybridSearch, topK, topKeyword } from "../../src/search.ts";
import { buildBm25, bm25Scores } from "../../src/bm25.ts";

export const manifest = JSON.parse(readFileSync("public/index/manifest.json", "utf8"));
export const chunks = JSON.parse(readFileSync("public/index/chunks.json", "utf8"));
export const DIM = manifest.dim;
export const idToIndex = new Map(chunks.map((c, i) => [c.id, i]));

export const MODELS = {
  minilm: { model: manifest.model, pooling: "mean", queryPrefix: "", shipped: "public/index/embeddings.i8" },
  "bge-small": { model: "Xenova/bge-small-en-v1.5", pooling: "cls", queryPrefix: "Represent this sentence for searching relevant passages: " },
  "gte-small": { model: "Xenova/gte-small", pooling: "mean", queryPrefix: "" },
};

const extractors = new Map();
function extractor(name) {
  if (!extractors.has(name)) extractors.set(name, pipeline("feature-extraction", MODELS[name].model, { dtype: "q8" }));
  return extractors.get(name);
}

export async function embedQuery(name, text) {
  const spec = MODELS[name];
  const out = await (await extractor(name))(spec.queryPrefix + text, { pooling: spec.pooling, normalize: true });
  return out.data;
}

/** Corpus vectors as int8 (same quantisation as the shipped index). Non-shipped models are embedded once and cached in data/. */
async function corpus(name) {
  const spec = MODELS[name];
  const path = spec.shipped ?? `data/eval-cache/${name}.i8`;
  if (existsSync(path)) {
    const buf = readFileSync(path);
    const v = new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    if (v.length === chunks.length * DIM) return v;
    if (spec.shipped) throw new Error(`${path} does not match chunks.json`);
  }
  console.error(`embedding ${chunks.length} passages with ${spec.model} (cached afterwards in ${path})…`);
  const ex = await extractor(name);
  const q = new Int8Array(chunks.length * DIM);
  for (let i = 0; i < chunks.length; i += 32) {
    const batch = chunks.slice(i, i + 32);
    const out = await ex(batch.map((c) => c.text), { pooling: spec.pooling, normalize: true });
    for (let j = 0; j < batch.length * DIM; j++) q[i * DIM + j] = Math.round(out.data[j] * 127);
    if ((i / 32) % 20 === 0) console.error(`  ${Math.min(i + 32, chunks.length)}/${chunks.length}`);
  }
  mkdirSync("data/eval-cache", { recursive: true });
  writeFileSync(path, Buffer.from(q.buffer));
  return q;
}

const corpora = new Map();
const bm25 = buildBm25(chunks.map((c) => c.text));

async function vectors(name) {
  if (!corpora.has(name)) corpora.set(name, await corpus(name));
  return corpora.get(name);
}

async function dense(name, query, n) {
  return topK(await embedQuery(name, query), await vectors(name), DIM, n);
}

async function hybrid(name, query, n) {
  const { hits, bestCosine } = hybridSearch(await embedQuery(name, query), await vectors(name), DIM, bm25Scores(bm25, query), n);
  return Object.assign(hits.map(({ i, cosine }) => ({ i, score: cosine })), { top: bestCosine });
}

export const SYSTEMS = {
  minilm: (q, n) => dense("minilm", q, n),
  "bge-small": (q, n) => dense("bge-small", q, n),
  "gte-small": (q, n) => dense("gte-small", q, n),
  bm25: async (q, n) => topKeyword(bm25Scores(bm25, q), n),
  "hybrid-minilm": (q, n) => hybrid("minilm", q, n),
  "hybrid-bge": (q, n) => hybrid("bge-small", q, n),
};
