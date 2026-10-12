import { topK, type Chunk } from "./search";

interface Manifest { model: string; dtype: string; dim: number; count: number; from: string; to: string; house: string; source: string }

const $ = <T extends Element>(s: string) => document.querySelector<T>(s)!;
const base = import.meta.env.BASE_URL;

let manifest: Manifest;
let chunks: Chunk[] = [];
let index: Int8Array;
let modelReady = false;
let indexReady = false;
let failure: string | null = null; // once set, the message stays visible and search is disabled
const ready = () => modelReady && indexReady && !failure;
const fail = (msg: string) => { failure = msg; $("#status").textContent = msg; };
let nextId = 1;
const pending = new Map<number, { ok: (v: Float32Array) => void; err: (e: Error) => void }>();

const worker = new Worker(new URL("./embed-worker.ts", import.meta.url), { type: "module" });
worker.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.type === "progress") $("#status").textContent = `Downloading model… ${Math.round(m.progress)}%`;
  else if (m.type === "ready") { modelReady = true; announce(); }
  else if (m.type === "embedding") { pending.get(m.id)?.ok(m.vector); pending.delete(m.id); }
  else if (m.type === "error") {
    if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)!.err(new Error(m.message)); pending.delete(m.id); }
    if (m.fatal) fail(`Could not load the search model: ${m.message}`);
  }
};
worker.onerror = (e) => fail(`The search worker crashed: ${e.message || "unknown error"}`);
function announce(): void {
  if (ready()) $("#status").textContent = `${chunks.length.toLocaleString()} passages ready`;
}
const embed = (text: string) => new Promise<Float32Array>((ok, err) => { const id = nextId++; pending.set(id, { ok, err }); worker.postMessage({ type: "embed", id, text }); });

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return (await r.json()) as T;
}

async function init(): Promise<void> {
  manifest = await getJson<Manifest>(`${base}index/manifest.json`);
  worker.postMessage({ type: "load", model: manifest.model, dtype: manifest.dtype }); // model downloads while the index loads
  const [c, buf] = await Promise.all([
    getJson<Chunk[]>(`${base}index/chunks.json`),
    fetch(`${base}index/embeddings.i8`).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status} for embeddings`); return r.arrayBuffer(); }),
  ]);
  chunks = c; index = new Int8Array(buf);
  if (index.length !== chunks.length * manifest.dim) throw new Error("index and passages do not match (corrupt or mixed build)");
  indexReady = true;
  const parties = [...new Set(chunks.map((x) => x.party).filter(Boolean))].sort();
  const sel = $<HTMLSelectElement>("#party");
  parties.forEach((p) => sel.add(new Option(p, p)));
  $("#foot").textContent = `${manifest.house} Hansard, ${manifest.from} to ${manifest.to}, energy-related speeches only (${manifest.count.toLocaleString()} passages). Model: ${manifest.model} (${manifest.dtype}) running locally. Source: ${manifest.source}. Built ${(manifest as Manifest & { built?: string }).built ?? ""}.`;
  announce();
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

async function search(q: string): Promise<void> {
  if (!q.trim()) return;
  if (failure) { $("#status").textContent = failure; return; }
  if (!ready()) { $("#status").textContent = "Still loading the model and index…"; return; }
  const party = $<HTMLSelectElement>("#party").value;
  const t0 = performance.now();
  let qv: Float32Array;
  try { qv = await embed(q); } catch (e) { $("#status").textContent = `Search failed: ${(e as Error).message}`; return; }
  const hits = topK(qv, index, manifest.dim, 8, party ? (i) => chunks[i]!.party === party : undefined);
  $("#status").textContent = `${hits.length} results in ${(performance.now() - t0).toFixed(0)} ms`;
  $("#results").innerHTML = hits.map(({ i, score }) => {
    const c = chunks[i]!;
    return `<article class="result"><span class="score">${score.toFixed(2)}</span><h3>${esc(c.speaker)}</h3>
      <div class="meta">${esc(c.party || "—")}${c.division ? ` · ${esc(c.division)}` : ""} · ${c.date} · ${esc(c.heading)}</div>
      <p>${esc(c.text)}</p><a href="${c.url}" target="_blank" rel="noopener">Read in context ↗</a></article>`;
  }).join("");
}

const EXAMPLES = [
  "worry about the cost of new transmission lines",
  "why nuclear is not the answer",
  "cheaper power bills for families with solar panels",
  "keeping coal stations open for reliability",
];
$("#examples").innerHTML = EXAMPLES.map((e) => `<button type="button">${esc(e)}</button>`).join("");
$("#examples").addEventListener("click", (ev) => {
  const t = (ev.target as HTMLElement).closest("button"); if (!t) return;
  $<HTMLInputElement>("#q").value = t.textContent!; search(t.textContent!);
});
$("#form").addEventListener("submit", (e) => { e.preventDefault(); search($<HTMLInputElement>("#q").value); });
$("#party").addEventListener("change", () => search($<HTMLInputElement>("#q").value));
init().catch((e) => fail(`Could not load the search index: ${(e as Error).message}`));
