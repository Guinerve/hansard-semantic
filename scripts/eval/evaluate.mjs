// Score every retrieval system against the labelled set (eval/queries.json + eval/qrels.tsv).
// Writes eval/results.json and eval/RESULTS.md.
//
//   node scripts/eval/evaluate.mjs [--systems minilm,bm25,...]
import { readFileSync, writeFileSync } from "node:fs";
import { SYSTEMS, chunks } from "./systems.mjs";
import { readQrels } from "./qrels.mjs";
import { WEAK_MATCH } from "../../src/search.ts";

const at = process.argv.indexOf("--systems");
const systemNames = at < 0 ? ["minilm", "bm25", "hybrid-minilm"] : process.argv[at + 1].split(",");
for (const s of systemNames) if (!SYSTEMS[s]) throw new Error(`unknown system ${s}`);

const queries = JSON.parse(readFileSync("eval/queries.json", "utf8"));
const qrels = readQrels();
const DEPTH = 20;

// A query is "answerable" if at least one judged passage is relevant (grade >= 1). Out-of-scope queries were written to
// have no answer, but the labels decide: Hansard speeches mix topics, so some "irrelevant" queries do hit real passages.
const relevant = (qid) => [...(qrels.get(qid) ?? [])].filter(([, j]) => j.grade >= 1);
const answerable = (q) => relevant(q.id).length > 0;

const gain = (g) => 2 ** g - 1;
function ndcg(ids, qid, k = 10) {
  const j = qrels.get(qid) ?? new Map();
  const dcg = ids.slice(0, k).reduce((s, id, r) => s + gain(j.get(id)?.grade ?? 0) / Math.log2(r + 2), 0);
  const ideal = [...j.values()].map((x) => x.grade).sort((a, b) => b - a).slice(0, k);
  const idcg = ideal.reduce((s, g, r) => s + gain(g) / Math.log2(r + 2), 0);
  return idcg ? dcg / idcg : NaN;
}
/** Reciprocal rank of the first fully relevant (grade 2) passage in the top 10, else 0. */
function rr(ids, qid, k = 10) {
  const j = qrels.get(qid) ?? new Map();
  const r = ids.slice(0, k).findIndex((id) => j.get(id)?.grade === 2);
  return r < 0 ? 0 : 1 / (r + 1);
}
const precision = (ids, qid, k = 5) => ids.slice(0, k).filter((id) => (qrels.get(qid)?.get(id)?.grade ?? 0) >= 1).length / k;
function recall(ids, qid, k = 20) {
  const rel = new Set(relevant(qid).map(([id]) => id));
  return rel.size ? ids.slice(0, k).filter((id) => rel.has(id)).length / rel.size : NaN;
}
const judged = (ids, qid, k = 10) => ids.slice(0, k).filter((id) => qrels.get(qid)?.has(id)).length / Math.min(k, ids.length || 1);
/** Among top-10 passages that take a side on the question, the share that argue the opposite of what was asked. */
function wrongStance(ids, qid, k = 10) {
  const j = qrels.get(qid) ?? new Map();
  let right = 0, wrong = 0;
  for (const id of ids.slice(0, k)) {
    const x = j.get(id);
    if (x?.stance === "opposite") wrong++;
    else if ((x?.grade ?? 0) >= 1) right++;
  }
  return right + wrong ? wrong / (right + wrong) : NaN;
}

const mean = (xs) => { const v = xs.filter((x) => !Number.isNaN(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN; };
function bootstrap(xs, iters = 10000, seed = 1) {
  const v = xs.filter((x) => !Number.isNaN(x));
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const means = [];
  for (let i = 0; i < iters; i++) { let t = 0; for (let j = 0; j < v.length; j++) t += v[Math.floor(rnd() * v.length)]; means.push(t / v.length); }
  means.sort((a, b) => a - b);
  return [means[Math.floor(iters * 0.025)], means[Math.floor(iters * 0.975)]];
}
/** Area under the ROC curve for "top-1 score separates answerable from unanswerable queries". */
function auc(pos, neg) {
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

const runs = {};
for (const name of systemNames) {
  runs[name] = {};
  for (const q of queries) {
    const t0 = performance.now();
    const hits = await SYSTEMS[name](q.query, DEPTH);
    runs[name][q.id] = { ids: hits.map((h) => chunks[h.i].id), top: hits.top ?? hits[0]?.score ?? 0, ms: performance.now() - t0 };
  }
  console.error(`ran ${name}`);
}

const CATS = ["keyword", "paraphrase", "negation", "known-item"];
const ans = queries.filter(answerable);
const noAns = queries.filter((q) => !answerable(q));
const results = { generated: new Date().toISOString().slice(0, 10), depth: DEPTH, queries: queries.length, answerable: ans.length, unanswerable: noAns.map((q) => q.id), systems: {} };

for (const name of systemNames) {
  const run = runs[name];
  const per = Object.fromEntries(queries.map((q) => {
    const ids = run[q.id].ids;
    return [q.id, {
      ndcg10: ndcg(ids, q.id), rr: rr(ids, q.id), p5: precision(ids, q.id), r20: recall(ids, q.id), judged10: judged(ids, q.id),
      wrongStance10: q.category === "negation" ? wrongStance(ids, q.id) : undefined,
      targetRank: q.target ? (ids.indexOf(q.target) + 1 || null) : undefined,
      top1: run[q.id].top,
    }];
  }));
  const pick = (qs, key) => qs.map((q) => per[q.id][key]);
  const byCat = {};
  for (const c of [...CATS, "all"]) {
    const qs = ans.filter((q) => c === "all" || q.category === c);
    byCat[c] = { n: qs.length, ndcg10: mean(pick(qs, "ndcg10")), mrr: mean(pick(qs, "rr")), p5: mean(pick(qs, "p5")), r20: mean(pick(qs, "r20")), judged10: mean(pick(qs, "judged10")) };
  }
  byCat.all.ndcg10CI = bootstrap(pick(ans, "ndcg10"));
  const ki = queries.filter((q) => q.target);
  const ranks = ki.map((q) => per[q.id].targetRank);
  const knownItem = { hit1: ranks.filter((r) => r === 1).length, hit10: ranks.filter((r) => r && r <= 10).length, hit20: ranks.filter((r) => r).length, n: ki.length, mrr: mean(ranks.map((r) => (r && r <= 10 ? 1 / r : 0))) };
  const negation = { wrongStance10: mean(queries.filter((q) => q.category === "negation").map((q) => per[q.id].wrongStance10)) };
  const top1 = (qs) => qs.map((q) => per[q.id].top1);
  const inScope = queries.filter((q) => q.category !== "irrelevant"), outScope = queries.filter((q) => q.category === "irrelevant");
  const sep = noAns.length ? {
    auc: auc(top1(ans), top1(noAns)), outOfScopeAuc: auc(top1(inScope), top1(outScope)),
    answerableTop1: mean(top1(ans)), unanswerableTop1: mean(top1(noAns)), maxUnanswerableTop1: Math.max(...top1(noAns)), minAnswerableTop1: Math.min(...top1(ans)),
    weakFlagged: { unanswerable: noAns.filter((q) => per[q.id].top1 < WEAK_MATCH).length, answerable: ans.filter((q) => per[q.id].top1 < WEAK_MATCH).map((q) => q.id) },
  } : null;
  const ms = Object.values(run).map((r) => r.ms).sort((a, b) => a - b);
  results.systems[name] = { byCat, knownItem, negation, separation: sep, nodeQueryMsMedian: ms[ms.length >> 1], perQuery: per };
}

// Paired bootstrap: is each system's nDCG@10 different from embeddings alone (what v0.1 shipped)?
const BASE = "minilm";
const SHIPPED = "hybrid-minilm";
const label = (name) => name + (name === SHIPPED ? " (shipped)" : name === BASE ? " (v0.1 baseline)" : "");
if (results.systems[BASE]) for (const name of systemNames) {
  if (name === BASE) continue;
  const diffs = ans.map((q) => results.systems[name].perQuery[q.id].ndcg10 - results.systems[BASE].perQuery[q.id].ndcg10);
  results.systems[name].vsShipped = { meanDiff: mean(diffs), ci: bootstrap(diffs) };
}

writeFileSync("eval/results.json", JSON.stringify(results, null, 2) + "\n");

// ---- Markdown report ----
const f = (x, d = 3) => (x === undefined || Number.isNaN(x) ? "n/a" : x.toFixed(d));
const judges = new Map();
for (const m of qrels.values()) for (const j of m.values()) judges.set(j.judge, (judges.get(j.judge) ?? 0) + 1);
const lines = [];
lines.push(`# Retrieval evaluation`, ``, `Generated ${results.generated} by \`npm run eval\`. ${queries.length} queries (${ans.length} with at least one relevant passage), ${[...qrels.values()].reduce((s, m) => s + m.size, 0)} judgments (${[...judges].map(([k, v]) => `${v} \`${k}\``).join(", ")}).`, ``);
if (judges.has("model-draft")) lines.push(`No person has reviewed the \`model-draft\` labels yet. Treat these scores as exploratory results. They are not an independent relevance benchmark.`, ``);
lines.push(`## nDCG@10 by query type`, ``, `| System | ${CATS.join(" | ")} | All (95% CI) | Change from minilm (95% CI) |`, `|---|${CATS.map(() => "---:").join("|")}|---:|---:|`);
for (const name of systemNames) {
  const s = results.systems[name];
  const d = s.vsShipped;
  lines.push(`| ${label(name)} | ${CATS.map((c) => f(s.byCat[c].ndcg10)).join(" | ")} | ${f(s.byCat.all.ndcg10)} (${f(s.byCat.all.ndcg10CI[0], 2)} to ${f(s.byCat.all.ndcg10CI[1], 2)}) | ${d ? `${d.meanDiff >= 0 ? "+" : ""}${f(d.meanDiff)} (${f(d.ci[0], 2)} to ${f(d.ci[1], 2)})` : "n/a"} |`);
}
lines.push(``, `## Other measures (answerable queries)`, ``, `| System | MRR@10 (first grade 2) | P@5 | Recall@20 (pooled) | Judged@10 | Known item: target in top 1 / 10 / 20 | Negation: wrong-stance share of top 10 |`, `|---|---:|---:|---:|---:|---:|---:|`);
for (const name of systemNames) {
  const s = results.systems[name];
  lines.push(`| ${label(name)} | ${f(s.byCat.all.mrr)} | ${f(s.byCat.all.p5)} | ${f(s.byCat.all.r20)} | ${f(s.byCat.all.judged10, 2)} | ${s.knownItem.hit1} / ${s.knownItem.hit10} / ${s.knownItem.hit20} of ${s.knownItem.n} | ${f(s.negation.wrongStance10)} |`);
}
if (noAns.length) {
  lines.push(``, `## Does the score show when there is no answer?`, ``, `${noAns.length} queries have no relevant passage at all (${noAns.map((q) => `\`${q.id}\``).join(", ")}). AUC is the probability that the top score of an answerable query is higher than the top score of a query with no answer. At 1.0 a threshold separates them perfectly. At 0.5 the score gives no signal. AUC applies only to systems that score by cosine.`, ``, `| System | AUC (no answer) | AUC (8 out-of-scope queries) | Mean top score (answerable) | Mean top score (no answer) | Highest top score with no answer | Lowest top score with an answer |`, `|---|---:|---:|---:|---:|---:|---:|`);
  for (const name of systemNames) {
    const s = results.systems[name].separation;
   if (name === "bm25") lines.push(`| ${label(name)} | n/a | n/a | n/a | n/a | n/a | n/a |`);
   else lines.push(`| ${label(name)} | ${f(s.auc)} | ${f(s.outOfScopeAuc)} | ${f(s.answerableTop1)} | ${f(s.unanswerableTop1)} | ${f(s.maxUnanswerableTop1)} | ${f(s.minAnswerableTop1)} |`);
  }
  const w = results.systems[SHIPPED]?.separation?.weakFlagged;
  if (w) lines.push(``, `The site shows a "weak matches only" notice when the best cosine is below ${WEAK_MATCH}. On this set that flags ${w.unanswerable} of ${noAns.length} no-answer queries and ${w.answerable.length} of ${ans.length} answerable ones${w.answerable.length ? ` (${w.answerable.map((x) => `\`${x}\``).join(", ")})` : ""}. I chose the threshold on this same set, so expect it to be slightly optimistic. For hybrid systems this table uses the best embedding cosine in the collection, which is what the site checks. It does not use the fused score.`);
}
lines.push(``, `## Per query (nDCG@10)`, ``, `| Query | Type | ${systemNames.join(" | ")} |`, `|---|---|${systemNames.map(() => "---:").join("|")}|`);
for (const q of queries) lines.push(`| \`${q.id}\` ${q.query} | ${q.category}${answerable(q) ? "" : " (no answer)"} | ${systemNames.map((n) => f(results.systems[n].perQuery[q.id].ndcg10, 2)).join(" | ")} |`);
lines.push(``, `## How to read this`, ``,
  `- Grades: 2 means the passage answers the query. 1 means it is on topic but partial. 0 means it is not relevant. For negation queries, a passage that argues the opposite side gets grade 0 and the flag \`opposite\`.`,
  `- The judgments are pooled, as in TREC. For each query, the union of the top 10 from every system was judged. A passage that no system retrieved has no judgment and counts as not relevant. Judged@10 shows how complete the labels are for the top 10 of each system. Recall@20 uses the pooled relevant set, so it overstates true recall.`,
  `- MRR counts only grade 2 passages. It shows how far down the list the first passage that answers the question appears.`,
  `- The confidence intervals are bootstrap intervals over queries (10,000 resamples). With ${ans.length} answerable queries they are wide. If an interval includes 0, treat the difference as unproven.`);
writeFileSync("eval/RESULTS.md", lines.join("\n") + "\n");
console.log(lines.slice(0, 25).join("\n"));
