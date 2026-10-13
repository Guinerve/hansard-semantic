// Build judgment pools (TREC-style): the union of every system's top-N for each query, minus passages already judged.
// Writes data/pool.json for the labelling page (npm run label) and prints how many passages still need a judgment.
//
//   node scripts/eval/pool.mjs [--depth 10]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { SYSTEMS, chunks } from "./systems.mjs";
import { readQrels } from "./qrels.mjs";

const at = process.argv.indexOf("--depth");
const depth = at < 0 ? 10 : Number(process.argv[at + 1]);
if (!(depth > 0)) throw new Error("--depth needs a positive number");
const queries = JSON.parse(readFileSync("eval/queries.json", "utf8"));
const qrels = readQrels();

const pool = {};
let todo = 0;
for (const q of queries) {
  const ids = new Set(q.target ? [q.target] : []);
  for (const run of Object.values(SYSTEMS)) for (const { i } of await run(q.query, depth)) ids.add(chunks[i].id);
  pool[q.id] = [...ids];
  const missing = pool[q.id].filter((id) => !qrels.get(q.id)?.has(id)).length;
  todo += missing;
  console.log(`${q.id.padEnd(24)} pool ${String(ids.size).padStart(3)}  unjudged ${missing}`);
}
mkdirSync("data", { recursive: true });
writeFileSync("data/pool.json", JSON.stringify(pool));
console.log(`\n${todo} passages need a judgment (depth ${depth}). Run \`npm run label\` to judge them.`);
