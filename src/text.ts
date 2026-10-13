/** OpenAustralia XML includes both decimal and hexadecimal Unicode entities. */
export function decodeNumericEntities(text: string): string {
  return text.replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (entity, digits: string) => {
    const hex = digits[0]!.toLowerCase() === "x";
    const code = Number.parseInt(hex ? digits.slice(1) : digits, hex ? 16 : 10);
    if (code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return entity;
    return String.fromCodePoint(code);
  });
}

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** Decode XML's five named entities and numeric entities in one pass, so "&amp;lt;" becomes the text "&lt;", not "<". */
export function decodeXmlEntities(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos|#x[0-9a-f]+|#[0-9]+);/gi, (entity, name: string) =>
    name[0] === "#" ? decodeNumericEntities(entity) : NAMED[name] ?? entity);
}

/** Decode Hansard's numeric entities, then escape the result so it can go into HTML as text or a quoted attribute. */
export const escapeHtml = (s: string) =>
  decodeNumericEntities(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
