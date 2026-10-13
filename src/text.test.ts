import { describe, expect, it } from "vitest";
import { decodeNumericEntities } from "./text";

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
});
