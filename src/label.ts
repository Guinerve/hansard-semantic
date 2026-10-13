// Relevance-labelling page (dev only, `npm run label`). Shows each query's pooled passages in id order and saves
// grades through the label server, which records them in eval/qrels.tsv as human judgments.
import type { Chunk } from "./search";
import { escapeHtml as esc } from "./text";

interface Query { id: string; category: string; query: string; need: string; target?: string }
interface Item { id: string; grade?: number; stance?: string; judge?: string }
interface Data { queries: Query[]; items: Record<string, Item[]>; passages: Record<string, Chunk>; pooled: boolean }

const $ = <T extends Element>(s: string) => document.querySelector<T>(s)!;
const GRADES = ["0 · not relevant", "1 · partly", "2 · answers it"];

let data: Data;
let current = "";
let focus = 0;

const isHuman = (it: Item) => it.judge === "human";
const visible = () => data.items[current]!.filter((it) => !$<HTMLInputElement>("#todo").checked || !isHuman(it));

function renderProgress(): void {
  const all = Object.values(data.items).flat();
  const done = all.filter(isHuman).length;
  $("#progress").textContent = `${done} of ${all.length} judgments reviewed by a human (${((100 * done) / Math.max(1, all.length)).toFixed(0)}%)${data.pooled ? "" : " · data/pool.json missing: run npm run pool to add newly retrieved passages"}`;
  $("#queries").innerHTML = data.queries.map((q) => {
    const its = data.items[q.id]!;
    const left = its.filter((it) => !isHuman(it)).length;
    return `<button type="button" data-q="${esc(q.id)}" class="${q.id === current ? "on" : ""}">${esc(q.id)}<small>${left ? `${left} to review` : "done"}</small></button>`;
  }).join("");
}

function renderPane(): void {
  const q = data.queries.find((x) => x.id === current)!;
  const its = visible();
  focus = Math.min(focus, Math.max(0, its.length - 1));
  $("#pane").innerHTML = `<section class="query"><div class="meta">${esc(q.category)}${q.target ? ` · known item ${esc(q.target)}` : ""}</div><h2>${esc(q.query)}</h2><p>${esc(q.need)}</p></section>` +
    (its.length ? its.map((it, n) => {
      const c = data.passages[it.id]!;
      const grade = it.grade ?? -1;
      return `<article class="result ${n === focus ? "focus" : ""}" data-n="${n}" data-id="${esc(it.id)}">
        <div class="judge">${GRADES.map((g, k) => `<button type="button" data-grade="${k}" class="${grade === k && !(k === 0 && it.stance === "opposite") ? "on" : ""}">${g}</button>`).join("")}
          ${q.category === "negation" ? `<button type="button" data-grade="opp" class="${it.stance === "opposite" ? "on" : ""}">0 · opposite side</button>` : ""}
          <span class="who ${isHuman(it) ? "human" : ""}">${it.judge ? (isHuman(it) ? "human" : `draft (${esc(it.judge)})`) : "unjudged"}</span></div>
        <h3>${esc(c.speaker)}</h3><div class="meta">${esc(c.party || "No party")} · ${esc(c.date)} · ${esc(c.heading)} · ${esc(c.id)}</div><p>${esc(c.text)}</p></article>`;
    }).join("") : `<p class="notice">Nothing left to review for this query.</p>`);
  $(".result.focus")?.scrollIntoView({ block: "nearest" });
}

async function judge(id: string, grade: number, stance: "" | "opposite"): Promise<void> {
  const queryId = current;
  try {
    const r = await fetch("/__label/judge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query_id: queryId, passage_id: id, grade, stance }) });
    if (!r.ok) {
      const reason = await r.json().then((b: { error?: string }) => b.error, () => undefined);
      throw new Error(reason ?? `HTTP ${r.status}`);
    }
  } catch (e) {
    alert(`Save failed, so this judgment was not recorded: ${(e as Error).message}`);
    return;
  }
  const it = data.items[queryId]!.find((x) => x.id === id)!;
  Object.assign(it, { grade, stance, judge: "human" });
  if (queryId === current && !$<HTMLInputElement>("#todo").checked) focus++;
  renderProgress(); renderPane();
}

function select(qid: string): void { current = qid; focus = 0; renderProgress(); renderPane(); }

$("#queries").addEventListener("click", (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>("[data-q]"); if (b) select(b.dataset.q!); });
$("#pane").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-grade]"); if (!b) return;
  const id = b.closest<HTMLElement>("[data-id]")!.dataset.id!;
  void (b.dataset.grade === "opp" ? judge(id, 0, "opposite") : judge(id, Number(b.dataset.grade), ""));
});
$("#todo").addEventListener("change", () => { focus = 0; renderPane(); });
document.addEventListener("keydown", (e) => {
  if (!data || e.target instanceof HTMLInputElement) return;
  const its = visible(); const it = its[focus];
  if (e.key === "j") { focus = Math.min(focus + 1, its.length - 1); renderPane(); }
  else if (e.key === "k") { focus = Math.max(focus - 1, 0); renderPane(); }
  else if (it && ["0", "1", "2"].includes(e.key)) void judge(it.id, Number(e.key), "");
  else if (it && e.key === "o" && data.queries.find((q) => q.id === current)?.category === "negation") void judge(it.id, 0, "opposite");
  else if (it && e.key === "Enter" && it.grade !== undefined) void judge(it.id, it.grade, (it.stance as "" | "opposite") ?? "");
});

fetch("/__label/data").then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }).then((d: Data) => { data = d; select(d.queries[0]!.id); })
  .catch((e) => { $("#progress").textContent = `Could not load labelling data: ${e}. Start it with npm run label.`; });
