// Build the search index: fetch House of Representatives Hansard (OpenAustralia scraped XML),
// keep energy-related speeches, chunk them, embed with the SAME model the browser uses, and
// write a compact index to public/index/.
//
//   node scripts/build-index.mjs [--from 2025-07-01] [--to 2026-09-17]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { pipeline } from "@huggingface/transformers";

export const MODEL = "Xenova/all-MiniLM-L6-v2";
const BASE = "https://data.openaustralia.org.au";
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); if (i < 0) return d; const v = process.argv[i + 1]; if (!v || v.startsWith("--")) throw new Error(`--${n} needs a value`); return v; };
const FROM = arg("from", "2025-07-01");
const TO = arg("to", "2026-09-17");
const ENERGY = /\b(energy|electricity|renewables?|solar|wind farms?|coal|gas|nuclear|emissions|net zero|decarbon\w*|grid|transmission|batter(?:y|ies)|hydrogen|power stations?|climate|AEMO|fossil|carbon|rooftop|offshore wind|pumped hydro|capacity investment scheme|energy prices?)\b/gi;
const MIN_WORDS = 35;
const CHUNK_WORDS = 170;

const decode = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const stripTags = (s) => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

async function cached(path, url) {
  if (existsSync(path)) return readFile(path, "utf8");
  const r = await fetch(url);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const t = await r.text();
  await writeFile(path, t);
  return t;
}

async function members() {
  const xml = await cached("data/representatives.xml", `${BASE}/members/representatives.xml`);
  const map = new Map();
  for (const m of xml.matchAll(/<member ([^>]*)\/>/g)) {
    const a = Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map((x) => [x[1], decode(x[2])]));
    map.set(a.id, { party: a.party, division: a.division });
  }
  return map;
}

async function listDates() {
  const res = await fetch(`${BASE}/scrapedxml/representatives_debates/`);
  if (!res.ok) throw new Error(`could not list Hansard days: HTTP ${res.status}`);
  const html = await res.text();
  return [...html.matchAll(/href="(\d{4}-\d{2}-\d{2})\.xml"/g)].map((m) => m[1]).filter((d) => d >= FROM && d <= TO);
}

const countHits = (t) => (t.match(ENERGY) ?? []).length;

function chunkWords(text) {
  const words = text.split(" ");
  if (words.length <= CHUNK_WORDS * 1.3) return [text];
  const out = [];
  for (let i = 0; i < words.length; i += CHUNK_WORDS) out.push(words.slice(i, i + CHUNK_WORDS).join(" "));
  if (out.length > 1 && out.at(-1).split(" ").length < 40) out.splice(-2, 2, out.at(-2) + " " + out.at(-1));
  return out;
}

function parseDay(xml, date, people) {
  const out = [];
  let major = "", minor = "";
  const re = /<(major-heading|minor-heading|speech)\b([^>]*)>([\s\S]*?)<\/\1>/g;
  for (const m of xml.matchAll(re)) {
    const [, tag, attrs, body] = m;
    if (tag === "major-heading") { major = stripTags(body); continue; }
    if (tag === "minor-heading") { minor = stripTags(body); continue; }
    const get = (k) => new RegExp(`${k}="([^"]*)"`).exec(attrs)?.[1] ?? "";
    const id = get("id").split("/").pop();
    const sid = get("speakerid");
    if (!sid || sid === "unknown") continue;
    const text = stripTags(body);
    if (text.split(" ").length < MIN_WORDS) continue;
    const heading = [major, minor].filter(Boolean).join(" · ");
    const headingEnergy = countHits(heading) > 0;
    if (countHits(text) < 3 && !headingEnergy) continue;
    const who = people.get(sid);
    chunkWords(text).forEach((chunk, n) => countHits(chunk) >= (headingEnergy ? 1 : 3) && out.push({
      id: `${id}${n ? `#${n}` : ""}`, date, speaker: decode(get("speakername")), party: who?.party ?? "", division: who?.division ?? "",
      heading, text: chunk, url: `https://www.openaustralia.org.au/debates/?id=${id}`,
    }));
  }
  return out;
}

async function main() {
  await mkdir("data/raw", { recursive: true });
  await mkdir("public/index", { recursive: true });
  const people = await members();
  const dates = await listDates();
  if (dates.length === 0) throw new Error(`no sitting days found between ${FROM} and ${TO} (bad --from/--to, or the listing format changed)`);
  console.log(`${dates.length} sitting days between ${FROM} and ${TO}`);
  const chunks = [];
  for (let i = 0; i < dates.length; i += 6) {
    const batch = dates.slice(i, i + 6);
    const xmls = await Promise.all(batch.map((d) => cached(`data/raw/${d}.xml`, `${BASE}/scrapedxml/representatives_debates/${d}.xml`)));
    xmls.forEach((x, k) => { if (!x) throw new Error(`${batch[k]}: listed but not downloadable`); chunks.push(...parseDay(x, batch[k], people)); });
  }
  if (chunks.length < 100) throw new Error(`only ${chunks.length} passages extracted; refusing to overwrite the index (XML format change?)`);
  console.log(`${chunks.length} chunks to embed`);

  const extractor = await pipeline("feature-extraction", MODEL, { dtype: "q8" });
  const dim = 384;
  const q = new Int8Array(chunks.length * dim);
  const B = 32;
  for (let i = 0; i < chunks.length; i += B) {
    const batch = chunks.slice(i, i + B);
    const out = await extractor(batch.map((c) => c.text), { pooling: "mean", normalize: true });
    const data = out.data;
    for (let j = 0; j < batch.length; j++) for (let d = 0; d < dim; d++) q[(i + j) * dim + d] = Math.round(data[j * dim + d] * 127);
    if ((i / B) % 10 === 0) console.log(`  embedded ${Math.min(i + B, chunks.length)}/${chunks.length}`);
  }
  await writeFile("public/index/embeddings.i8", Buffer.from(q.buffer));
  await writeFile("public/index/chunks.json", JSON.stringify(chunks));
  await writeFile("public/index/manifest.json", JSON.stringify({
    model: MODEL, dtype: "q8", dim, count: chunks.length, from: FROM, to: TO, house: "House of Representatives",
    source: "OpenAustralia scraped Hansard XML (data.openaustralia.org.au)", built: new Date().toISOString().slice(0, 10),
  }, null, 2));
  console.log("done");
}

main().catch((e) => { console.error(e); process.exit(1); });
