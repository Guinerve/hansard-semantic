import { describe, expect, it } from "vitest";
import { renderResults } from "./render";
import type { Chunk } from "./search";

const chunk = (over: Partial<Chunk> = {}): Chunk => ({
  id: "2025-07-22.17.3", date: "2025-07-22", speaker: "A Member", party: "Independent", division: "Somewhere",
  heading: "ENERGY", text: "Power prices&#x2014;again.", url: "https://www.openaustralia.org.au/debates/?id=2025-07-22.17.3", ...over,
});
const hit = { i: 0, cosine: 0.5, denseRank: 1, keywordRank: 2 };

/** Parse the HTML the way the page does and report anything that could run script. */
function scriptable(html: string): string[] {
  const found: string[] = [];
  for (const m of html.matchAll(/<([a-z0-9]+)\b([^>]*)>/gi)) {
    const [, tag, attrs] = m;
    if (!["article", "span", "h3", "div", "p", "a"].includes(tag!.toLowerCase())) found.push(`tag ${tag}`);
    for (const a of attrs!.matchAll(/\s([^\s=]+)\s*=\s*"([^"]*)"/g)) {
      if (/^on/i.test(a[1]!)) found.push(`attribute ${a[1]}`);
      if (a[1] === "href" && !/^https?:\/\//.test(a[2]!)) found.push(`href ${a[2]}`);
    }
  }
  return found;
}

describe("result rendering", () => {
  it("escapes passage text, including markup hidden in numeric entities", () => {
    const html = renderResults([hit], [chunk({ text: "&#x3c;img src=x onerror=alert(1)&#62; <script>alert(2)</script>", speaker: '<b onclick="x">' })], 0.5);
    expect(scriptable(html)).toEqual([]);
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("escapes every field that is placed in the page, including the date", () => {
    const html = renderResults([hit], [chunk({ date: '<img src=x onerror="alert(1)">', heading: "<i>", division: "<u>", party: "<s>" })], 0.5);
    expect(scriptable(html)).toEqual([]);
  });

  it("only links to http(s) sources and cannot break out of the href attribute", () => {
    for (const url of ["javascript:alert(1)", 'https://example.org/" onmouseover="alert(1)', " JavaScript:alert(1)", "data:text/html,<script>"]) {
      const html = renderResults([hit], [chunk({ url })], 0.5);
      expect(scriptable(html), url).toEqual([]);
    }
    expect(renderResults([hit], [chunk()], 0.5)).toContain('href="https://www.openaustralia.org.au/debates/?id=2025-07-22.17.3"');
  });

  it("decodes Hansard entities for display", () => {
    expect(renderResults([hit], [chunk()], 0.5)).toContain("Power prices—again.");
  });

  it("shows the weak-match notice only for weak results", () => {
    expect(renderResults([hit], [chunk()], 0.2)).toContain("Weak matches only (best similarity 0.20)");
    expect(renderResults([hit], [chunk()], 0.5)).not.toContain("Weak matches only");
  });

  it("renders nothing, not a stray 0, when there are no hits", () => {
    expect(renderResults([], [], 0)).toBe("");
  });
});
