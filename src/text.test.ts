import { describe, expect, it } from "vitest";
import { decodeNumericEntities, decodeXmlEntities, escapeHtml } from "./text";

describe("Hansard text", () => {
  it("decodes hexadecimal and decimal Unicode entities for display", () => {
    expect(decodeNumericEntities("power&#x2014;not gas &#8217; &#X1F525;")).toBe("power—not gas ’ 🔥");
  });

  it("leaves invalid code points and ordinary text unchanged", () => {
    const text = "solar & wind &#x110000; &#55296; &#0; &#xyz;";
    expect(decodeNumericEntities(text)).toBe(text);
  });

  it("decodes markup as text so callers can escape it, not execute it", () => {
    expect(decodeNumericEntities("&#x3c;script&#62;")).toBe("<script>");
  });

  it("decodes XML entities exactly once", () => {
    expect(decodeXmlEntities("Tom &amp; Jerry &lt;b&gt; &quot;x&quot; it&apos;s &#x2014;")).toBe(`Tom & Jerry <b> "x" it's —`);
    expect(decodeXmlEntities("&amp;lt;script&amp;gt; &amp;amp; &amp;#60;")).toBe("&lt;script&gt; &amp; &#60;");
  });

  it("escapes text for HTML after decoding numeric entities", () => {
    expect(escapeHtml(`&#x3c;a href="x" title='y'&#62; & more`)).toBe("&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt; &amp; more");
  });
});
