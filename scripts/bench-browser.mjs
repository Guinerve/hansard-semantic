// Browser benchmark: serve the production build, drive it in real Chrome, and record load time, bytes transferred,
// per-query latency, memory, and whether the browser's rankings match the Node evaluation (and how good they are).
// Writes eval/browser-bench.json and eval/BROWSER.md.
//
//   npm run build && npm run bench [-- --throttle]      (CHROME_PATH=/path/to/chrome to override the browser)
//
// The preview server binds 0.0.0.0:5294 (labelling uses 5293, dev 5193) for the duration of the run.
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, platform, release, tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer, { PredefinedNetworkConditions } from "puppeteer-core";
import { DIM, SYSTEMS, chunks, embedQuery } from "./eval/systems.mjs";
import { cosineAt } from "../src/search.ts";
import { readQrels } from "./eval/qrels.mjs";

const PORT = 5294;
const URL = `http://127.0.0.1:${PORT}/`;
const THROTTLE = process.argv.includes("--throttle");
if (!existsSync("dist/index.html")) throw new Error("dist/ is missing: run `npm run build` first");

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (existsSync(mac)) return mac;
  for (const bin of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    try { return execFileSync("which", [bin], { encoding: "utf8" }).trim(); } catch { /* try the next one */ }
  }
  throw new Error("Chrome not found: set CHROME_PATH");
}

async function startPreview() {
  // Refuse to reuse whatever is already on the port: it could be a stale server with an old build.
  const busy = await fetch(URL).then(() => true, () => false);
  if (busy) throw new Error(`port ${PORT} is already in use; stop that server first`);
  // Run Vite's own entry point (not npx) so that killing this process stops the server.
  const proc = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--host", "0.0.0.0", "--port", String(PORT), "--strictPort"], { stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  proc.stdout.on("data", (d) => (log += d));
  proc.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(URL)).ok) return proc; } catch { /* not up yet */ }
    if (proc.exitCode !== null) throw new Error(`vite preview exited:\n${log}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  proc.kill();
  throw new Error(`vite preview did not start on port ${PORT}:\n${log}`);
}

/** Load the page in `browser` and wait for "passages ready"; returns timings (ms from navigation start) and bytes by origin. */
async function load(browser, { throttle = false } = {}) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  if (throttle) await page.emulateNetworkConditions(PredefinedNetworkConditions["Fast 4G"]);
  const cdp = await page.createCDPSession();
  await cdp.send("Network.enable");
  const bytes = {};
  const urls = new Map();
  cdp.on("Network.responseReceived", (e) => urls.set(e.requestId, new globalThis.URL(e.response.url).host));
  cdp.on("Network.loadingFinished", (e) => { const h = urls.get(e.requestId) ?? "?"; bytes[h] = (bytes[h] ?? 0) + e.encodedDataLength; });
  // The model is fetched inside the Web Worker, which has its own network domain.
  page.on("workercreated", async (w) => {
    try {
      const s = w.client;
      await s.send("Network.enable");
      s.on("Network.responseReceived", (e) => urls.set(e.requestId, new globalThis.URL(e.response.url).host));
      s.on("Network.loadingFinished", (e) => { const h = urls.get(e.requestId) ?? "?"; bytes[h] = (bytes[h] ?? 0) + e.encodedDataLength; });
    } catch { /* worker network accounting is best effort */ }
  });
  const t0 = Date.now();
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => /passages ready|Could not|crashed/.test(document.querySelector("#status")?.textContent ?? ""), { timeout: throttle ? 600_000 : 240_000 });
  const status = await page.$eval("#status", (e) => e.textContent);
  if (!/passages ready/.test(status)) throw new Error(`page failed to load: ${status}\n${errors.join("\n")}`);
  const marks = await page.evaluate(() => Object.fromEntries(performance.getEntriesByType("mark").map((m) => [m.name, m.startTime])));
  return { page, cdp, wallMs: Date.now() - t0, indexReadyMs: marks["index-ready"], modelReadyMs: marks["model-ready"], bytes, errors };
}

async function runQueries(page, queries) {
  const out = {};
  for (const q of queries) {
    await page.evaluate(() => performance.clearMeasures());
    await page.$eval("#q", (el, v) => { el.value = v; }, q.query);
    await page.$eval("#status", (el) => { el.textContent = ""; });
    await page.click("#form button");
    await page.waitForFunction(() => /results? in|failed/.test(document.querySelector("#status")?.textContent ?? ""));
    const r = await page.evaluate(() => ({
      embed: performance.getEntriesByName("embed").at(-1)?.duration,
      rank: performance.getEntriesByName("rank").at(-1)?.duration,
      ids: [...document.querySelectorAll("#results .result")].map((a) => a.dataset.id),
      cosines: [...document.querySelectorAll("#results .result .score")].map((e) => parseFloat(e.textContent)),
      weak: !!document.querySelector("#results .notice"),
    }));
    out[q.id] = r;
  }
  return out;
}

const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const mb = (b) => (b / 1e6).toFixed(1);

const queries = JSON.parse(readFileSync("eval/queries.json", "utf8"));
const qrels = readQrels();
const executablePath = chromePath();
const chromeVersion = execFileSync(executablePath, ["--version"], { encoding: "utf8" }).trim();
const server = await startPreview();
const profile = mkdtempSync(join(tmpdir(), "hansard-bench-"));
const result = { date: new Date().toISOString(), chrome: chromeVersion, os: `${platform()} ${release()}`, cpu: cpus()[0]?.model, cores: cpus().length, url: URL };
try {
  const browser = await puppeteer.launch({ executablePath, headless: true, userDataDir: profile, args: ["--no-first-run"] });
  // 1. Cold load: empty profile, so the model comes from the network.
  const cold = await load(browser);
  // 2. Queries: one warm-up, then every labelled query once, typed into the real search form.
  await runQueries(cold.page, [{ id: "warmup", query: "energy prices" }]);
  const browserRuns = await runQueries(cold.page, queries);
  const heap = await cold.cdp.send("Runtime.getHeapUsage");
  let workerHeap = null;
  try { workerHeap = await cold.page.workers()[0]?.client.send("Runtime.getHeapUsage"); } catch { /* not exposed */ }
  await cold.page.close();
  // 3. Warm load: same profile, so the model should come from the browser's Cache Storage.
  const warm = await load(browser);
  await warm.page.close();
  // 4. Optional throttled cold load (fresh profile, Chrome's "Fast 4G" preset).
  let throttled = null;
  if (THROTTLE) {
    const tProfile = mkdtempSync(join(tmpdir(), "hansard-bench-"));
    const b2 = await puppeteer.launch({ executablePath, headless: true, userDataDir: tProfile });
    const t = await load(b2, { throttle: true });
    throttled = { wallMs: t.wallMs, indexReadyMs: t.indexReadyMs, modelReadyMs: t.modelReadyMs };
    await b2.close();
    rmSync(tProfile, { recursive: true, force: true });
  }
  await browser.close();

  // Parity with Node and ranking quality as measured in the browser.
  const node = {};
  for (const q of queries) node[q.id] = (await SYSTEMS["hybrid-minilm"](q.query, 8)).map((h) => h.i);
  // Cosine drift: the similarity the page displays (2 decimals) vs Node's for the same query and passage.
  const vectors = new Int8Array(readFileSync("public/index/embeddings.i8").buffer.slice(0));
  const byId = new Map(chunks.map((c, i) => [c.id, i]));
  const drift = [];
  for (const q of queries) {
    const v = await embedQuery("minilm", q.query);
    browserRuns[q.id].ids.forEach((id, k) => drift.push(Math.abs(browserRuns[q.id].cosines[k] - cosineAt(v, vectors, DIM, byId.get(id)))));
  }
  let overlap = 0, identical = 0;
  for (const q of queries) {
    const b = browserRuns[q.id].ids, n = node[q.id].map((i) => chunks[i].id);
    overlap += b.filter((id) => n.includes(id)).length / Math.max(1, n.length);
    if (b.join() === n.join()) identical++;
  }
  const ndcg8 = (ids, qid) => {
    const j = qrels.get(qid) ?? new Map();
    const dcg = ids.slice(0, 8).reduce((s, id, r) => s + (2 ** (j.get(id)?.grade ?? 0) - 1) / Math.log2(r + 2), 0);
    const idcg = [...j.values()].map((x) => x.grade).sort((a, b) => b - a).slice(0, 8).reduce((s, g, r) => s + (2 ** g - 1) / Math.log2(r + 2), 0);
    return idcg ? dcg / idcg : NaN;
  };
  const browserNdcg = queries.map((q) => ndcg8(browserRuns[q.id].ids, q.id)).filter((x) => !Number.isNaN(x));
  const nodeNdcg = queries.map((q) => ndcg8(node[q.id].map((i) => chunks[i].id), q.id)).filter((x) => !Number.isNaN(x));
  const embed = Object.values(browserRuns).map((r) => r.embed), rank = Object.values(browserRuns).map((r) => r.rank);
  const total = Object.values(browserRuns).map((r) => r.embed + r.rank);
  Object.assign(result, {
    cold: { wallMs: cold.wallMs, indexReadyMs: cold.indexReadyMs, modelReadyMs: cold.modelReadyMs, bytes: cold.bytes, errors: cold.errors },
    warm: { wallMs: warm.wallMs, indexReadyMs: warm.indexReadyMs, modelReadyMs: warm.modelReadyMs, bytes: warm.bytes, errors: warm.errors },
    throttled,
    queries: { n: queries.length, embedMs: { p50: pct(embed, 50), p95: pct(embed, 95), max: Math.max(...embed) }, rankMs: { p50: pct(rank, 50), p95: pct(rank, 95), max: Math.max(...rank) }, totalMs: { p50: pct(total, 50), p95: pct(total, 95) } },
    memory: { mainHeapUsedMB: heap.usedSize / 1e6, workerHeapUsedMB: workerHeap ? workerHeap.usedSize / 1e6 : null },
    parity: { meanOverlapAt8: overlap / queries.length, identicalTop8: identical, n: queries.length, cosineDrift: { mean: drift.reduce((a, b) => a + b, 0) / drift.length, p95: pct(drift, 95), max: Math.max(...drift), n: drift.length } },
    quality: { browserNdcg8: browserNdcg.reduce((a, b) => a + b, 0) / browserNdcg.length, nodeNdcg8: nodeNdcg.reduce((a, b) => a + b, 0) / nodeNdcg.length, answerable: browserNdcg.length },
    perQuery: browserRuns,
  });
} finally {
  server.kill();
  rmSync(profile, { recursive: true, force: true });
}

writeFileSync("eval/browser-bench.json", JSON.stringify(result, null, 2) + "\n");
const r = result, s = (ms) => (ms / 1000).toFixed(1) + " s";
const host = (b) => Object.entries(b).filter(([h, n]) => h && n > 1000).map(([h, n]) => `${h} ${mb(n)} MB`).join(", ") || "≈0 (all cached)";
const md = [
  `# Browser benchmark`, ``,
  `Measured ${r.date.slice(0, 10)} by \`npm run bench\` on ${r.chrome} (headless), ${r.os}, ${r.cpu} (${r.cores} cores), serving the production build from \`vite preview\`. The model comes from Hugging Face over the real internet connection of this machine, so cold load times depend on that connection.`, ``,
  `| | Cold (empty cache) | Warm (reload, same profile) |`, `|---|---|---|`,
  `| Index ready (passages + vectors loaded, BM25 built) | ${s(r.cold.indexReadyMs)} | ${s(r.warm.indexReadyMs)} |`,
  `| Model ready (search usable) | ${s(r.cold.modelReadyMs)} | ${s(r.warm.modelReadyMs)} |`,
  `| Transferred | ${host(r.cold.bytes)} | ${host(r.warm.bytes)} |`,
  r.throttled ? `| Model ready on Chrome's "Fast 4G" preset (cold) | ${s(r.throttled.modelReadyMs)} | n/a |` : null,
  ``, `Per query, over all ${r.queries.n} labelled queries typed into the search box (after one query to warm up):`, ``,
  `| | p50 | p95 | max |`, `|---|---:|---:|---:|`,
  `| Embed query (Web Worker, q8 MiniLM) | ${r.queries.embedMs.p50.toFixed(1)} ms | ${r.queries.embedMs.p95.toFixed(1)} ms | ${r.queries.embedMs.max.toFixed(1)} ms |`,
  `| Rank (cosine over ${"3,430"} vectors + BM25 + fusion) | ${r.queries.rankMs.p50.toFixed(1)} ms | ${r.queries.rankMs.p95.toFixed(1)} ms | ${r.queries.rankMs.max.toFixed(1)} ms |`,
  `| Total | ${r.queries.totalMs.p50.toFixed(1)} ms | ${r.queries.totalMs.p95.toFixed(1)} ms | |`,
  ``, `Memory after the queries: main-thread JS heap ${r.memory.mainHeapUsedMB.toFixed(1)} MB${r.memory.workerHeapUsedMB !== null ? `, worker JS heap ${r.memory.workerHeapUsedMB.toFixed(1)} MB (the ONNX model weights live in WASM memory, which this does not count)` : ""}.`,
  ``, `**Browser compared with Node:** the top 8 in the browser overlaps the top 8 from the Node evaluation by ${(100 * r.parity.meanOverlapAt8).toFixed(1)}% on average; ${r.parity.identicalTop8} of ${r.parity.n} queries return the identical ordered list. nDCG@8 over the ${r.quality.answerable} answerable queries: ${r.quality.browserNdcg8.toFixed(3)} from the result lists of the browser, ${r.quality.nodeNdcg8.toFixed(3)} from Node. The order differs because the browser (onnxruntime-web WASM) and Node (onnxruntime-node) compute slightly different q8 query embeddings. Across ${r.parity.cosineDrift.n} displayed results the cosine differs from the Node value by ${r.parity.cosineDrift.mean.toFixed(4)} on average (p95 ${r.parity.cosineDrift.p95.toFixed(3)}, max ${r.parity.cosineDrift.max.toFixed(3)}, including ±0.005 display rounding), which reorders near-ties before the rank fusion.`,
  r.cold.errors.length || r.warm.errors.length ? `\nConsole errors: ${[...r.cold.errors, ...r.warm.errors].join("; ")}` : `\nNo console or page errors.`,
].filter((l) => l !== null).join("\n");
writeFileSync("eval/BROWSER.md", md + "\n");
console.log(md);
