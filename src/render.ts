import type { Chunk, HybridHit } from "./search";
import { WEAK_MATCH } from "./search";
import { escapeHtml as esc } from "./text";

/** Source links come from the index. Only http(s) URLs become links, so a bad index cannot add a javascript: link. */
export function safeUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

const SOURCE: Record<string, string> = {
  both: "Both the meaning and the keyword ranking found it",
  meaning: "Only the meaning (embedding) ranking found it",
  keywords: "Only the keyword (BM25) ranking found it",
};

export function renderResults(hits: HybridHit[], chunks: Chunk[], bestCosine: number): string {
  const weak = hits.length && bestCosine < WEAK_MATCH
    ? `<p class="notice" role="note">Weak matches only (best similarity ${bestCosine.toFixed(2)}). This collection holds energy debates from the House of Representatives, so your topic may not be in it.</p>`
    : "";
  return weak + hits.map(({ i, cosine, denseRank, keywordRank }) => {
    const c = chunks[i]!;
    const href = safeUrl(c.url);
    const source = denseRank && keywordRank ? "both" : denseRank ? "meaning" : "keywords";
    return `<article class="result" data-id="${esc(c.id)}"><span class="score" title="Similarity of your query to this passage (embedding cosine). ${SOURCE[source]}.">${cosine.toFixed(2)} · ${source}</span><h3>${esc(c.speaker)}</h3>
      <div class="meta">${esc(c.party || "No party")}${c.division ? ` · ${esc(c.division)}` : ""} · ${esc(c.date)} · ${esc(c.heading)}</div>
      <p>${esc(c.text)}</p>${href ? `<a href="${esc(href)}" target="_blank" rel="noopener">Read in context ↗</a>` : ""}</article>`;
  }).join("");
}
