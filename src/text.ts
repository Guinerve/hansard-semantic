/** OpenAustralia XML includes both decimal and hexadecimal Unicode entities. */
export function decodeNumericEntities(text: string): string {
  return text.replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (entity, digits: string) => {
    const hex = digits[0]!.toLowerCase() === "x";
    const code = Number.parseInt(hex ? digits.slice(1) : digits, hex ? 16 : 10);
    if (code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return entity;
    return String.fromCodePoint(code);
  });
}
