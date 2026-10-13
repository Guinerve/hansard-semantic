// Relevance judgments live in eval/qrels.tsv, one per line:
//
//   query_id  passage_id  grade  stance  judge
//
// grade:  2 = answers the query, 1 = partly relevant / on topic but thin, 0 = not relevant
// stance: "opposite" when the passage is on topic but argues the opposite of what a negation query asks for (grade is then 0)
// judge:  who made the call. "human" for a person; "model-draft" for an unreviewed suggestion.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const QRELS = "eval/qrels.tsv";
const HEADER = "query_id\tpassage_id\tgrade\tstance\tjudge";

/** Map<queryId, Map<passageId, {grade, stance, judge}>> */
export function readQrels(path = QRELS) {
  const out = new Map();
  if (!existsSync(path)) return out;
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l && !l.startsWith("query_id"));
  for (const [n, line] of lines.entries()) {
    const [q, p, g, stance = "", judge = ""] = line.split("\t");
    const grade = Number(g);
    if (!q || !p || ![0, 1, 2].includes(grade)) throw new Error(`${path} line ${n + 2}: bad judgment "${line}"`);
    if (!out.has(q)) out.set(q, new Map());
    out.get(q).set(p, { grade, stance, judge });
  }
  return out;
}

export function writeQrels(qrels, path = QRELS) {
  const rows = [];
  for (const [q, m] of [...qrels].sort(([a], [b]) => a.localeCompare(b)))
    for (const [p, j] of [...m].sort(([a], [b]) => a.localeCompare(b))) rows.push([q, p, j.grade, j.stance ?? "", j.judge ?? ""].join("\t"));
  writeFileSync(path, `${HEADER}\n${rows.join("\n")}\n`);
}
