export function normalizeText(input: string): string {
  if (!input) return '';
  // Normalize newlines and whitespace; collapse more than 2 newlines into 2
  let t = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  t = t.replace(/[\t\x0B\f\u00A0]+/g, ' ');
  // Trim lines and collapse excessive blank lines
  t = t
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n');
  t = t.replace(/\n{3,}/g, '\n\n');
  return t.trim();
}
