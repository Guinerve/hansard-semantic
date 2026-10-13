// Vite dev-server plugin behind `npm run label`: serves the labelling data and saves judgments to eval/qrels.tsv.
// Every judgment saved through the page is recorded with judge "human".
import { existsSync, readFileSync } from "node:fs";
import { readQrels, writeQrels } from "./qrels.mjs";

const json = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
};

function readBody(req) {
  return new Promise((ok, err) => {
    let s = "";
    req.on("data", (d) => (s += d));
    req.on("end", () => { try { ok(JSON.parse(s)); } catch (e) { err(e); } });
    req.on("error", err);
  });
}

export function labelServer() {
  return {
    name: "hansard-label-server",
    apply: "serve",
    configureServer(server) {
      const queryIds = new Set(JSON.parse(readFileSync("eval/queries.json", "utf8")).map((q) => q.id));
      const passageIds = new Set(JSON.parse(readFileSync("public/index/chunks.json", "utf8")).map((c) => c.id));
      server.middlewares.use("/__label/data", (req, res) => {
        const queries = JSON.parse(readFileSync("eval/queries.json", "utf8"));
        const pool = existsSync("data/pool.json") ? JSON.parse(readFileSync("data/pool.json", "utf8")) : {};
        const qrels = readQrels();
        const byId = new Map(JSON.parse(readFileSync("public/index/chunks.json", "utf8")).map((c) => [c.id, c]));
        const items = {};
        const passages = {};
        for (const q of queries) {
          // Pool ∪ already-judged, sorted by id so the page never reveals which system retrieved what.
          const ids = [...new Set([...(pool[q.id] ?? []), ...(qrels.get(q.id)?.keys() ?? [])])].filter((id) => byId.has(id)).sort();
          items[q.id] = ids.map((id) => ({ id, ...(qrels.get(q.id)?.get(id) ?? {}) }));
          for (const id of ids) passages[id] ??= byId.get(id);
        }
        json(res, 200, { queries, items, passages, pooled: existsSync("data/pool.json") });
      });
      server.middlewares.use("/__label/judge", async (req, res) => {
        if (req.method !== "POST") return json(res, 405, { error: "POST only" });
        // The server is reachable on the tailnet. Do not accept writes from another website.
        const expectedOrigin = `http://${req.headers.host}`;
        if (req.headers.origin !== expectedOrigin || req.headers["content-type"] !== "application/json") {
          return json(res, 403, { error: "same-origin JSON requests only" });
        }
        try {
          const { query_id, passage_id, grade, stance } = await readBody(req);
          if (!queryIds.has(query_id) || !passageIds.has(passage_id)) return json(res, 400, { error: "unknown query or passage" });
          if (![0, 1, 2].includes(grade) || !["", "opposite"].includes(stance ?? "")) return json(res, 400, { error: "bad grade or stance" });
          const qrels = readQrels();
          if (!qrels.has(query_id)) qrels.set(query_id, new Map());
          qrels.get(query_id).set(passage_id, { grade, stance: grade === 0 ? stance ?? "" : "", judge: "human" });
          writeQrels(qrels);
          json(res, 200, { ok: true });
        } catch (e) {
          json(res, 500, { error: String(e) });
        }
      });
    },
  };
}
