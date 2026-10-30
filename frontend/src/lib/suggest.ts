import { squash } from './validate';

/** Candidate anchors found in a statement: numbers and capitalised names, in order of appearance. */
export function suggestAnchors(statement: string, limit = 6): string[] {
  const text = squash(statement);
  const found: { index: number; value: string }[] = [];
  for (const match of text.matchAll(/\d(?:[\d,. ]*\d)?%?/g)) {
    const value = match[0].replace(/[ .,]+$/, '');
    if (value.length >= 1) found.push({ index: match.index ?? 0, value });
  }
  for (const match of text.matchAll(/\b[A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+)*/g)) {
    const index = match.index ?? 0;
    // A capitalised first word of the sentence is not a name.
    if (index === 0 && !match[0].includes(' ')) continue;
    found.push({ index, value: match[0] });
  }
  found.sort((a, b) => a.index - b.index);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of found) {
    const key = item.value.toLowerCase();
    if (seen.has(key) || item.value.length > 60) continue;
    seen.add(key);
    out.push(item.value);
    if (out.length >= limit) break;
  }
  return out;
}
