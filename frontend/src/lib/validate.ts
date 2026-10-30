// Client-side mirror of the contract's input rules, so a visitor learns about a problem before
// signing anything. The contract stays the authority: it re-checks everything on chain.

import { DEFAULT_LIMITS, type ContractInfo } from './types';

type Limits = ContractInfo['limits'];

const PUNCT: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '‐': '-',
  '‑': '-',
  '–': '-',
  '—': '-',
  '−': '-',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
};

export const squash = (text: string): string => text.split(/\s+/).filter(Boolean).join(' ');

/** The contract's documented comparison normalisation. */
export const norm = (text: string): string =>
  squash([...text].map((char) => PUNCT[char] ?? char).join('')).toLowerCase();

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';
const isAlpha = (c: string | undefined): boolean => c !== undefined && c.toLowerCase() !== c.toUpperCase();

/** Whole-token search: "8,848.86" is not found in "18,848.86", but is found in "8,848.86m". */
export function hasTerm(haystack: string, term: string): boolean {
  if (term === '') return false;
  let start = 0;
  for (;;) {
    const index = haystack.indexOf(term, start);
    if (index === -1) return false;
    const before = index > 0 ? haystack[index - 1] : ' ';
    const after = index + term.length < haystack.length ? haystack[index + term.length] : ' ';
    const first = term[0];
    const last = term[term.length - 1];
    const leftClash = (isDigit(first) && isDigit(before)) || (isAlpha(first) && isAlpha(before));
    const rightClash = (isDigit(last) && isDigit(after)) || (isAlpha(last) && isAlpha(after));
    if (!leftClash && !rightClash) return true;
    start = index + 1;
  }
}

const ANCHOR_STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'of',
  'in',
  'on',
  'at',
  'to',
  'by',
  'as',
  'is',
  'it',
  'its',
  'be',
  'that',
  'with',
  'this',
  'from',
  'are',
  'was',
  'were',
  'has',
  'have',
  'for',
  'not',
]);
const STEM_STOPWORDS = new Set([
  'that',
  'with',
  'this',
  'from',
  'have',
  'were',
  'been',
  'they',
  'their',
  'there',
  'which',
  'would',
  'about',
  'into',
  'than',
  'then',
  'also',
  'more',
  'most',
  'some',
  'such',
  'only',
  'over',
  'when',
  'what',
  'will',
  'your',
  'each',
  'both',
  'these',
  'those',
  'other',
]);

const tooGeneric = (term: string): boolean =>
  ANCHOR_STOPWORDS.has(term) || (term.length < 2 && !/^\d+$/.test(term));

/** Distinct comparable content of a statement: numbers as written, other words cut to 5 letters. */
export function stems(text: string): Set<string> {
  const out = new Set<string>();
  for (const token of norm(text).split(' ')) {
    const word = token.replace(/^[.,;:!?()[\]{}"']+|[.,;:!?()[\]{}"']+$/g, '');
    if (/\d/.test(word)) out.add(word);
    else if (word.length >= 4 && !STEM_STOPWORDS.has(word)) out.add(word.slice(0, 5));
  }
  return out;
}

export interface AnchorDraft {
  id: string;
  spellings: string[];
}

export interface FieldErrors {
  title?: string;
  statement?: string;
  anchors?: string;
  topic?: string;
  anchorRows: Record<string, string>;
}

export interface ClaimDraft {
  title: string;
  statement: string;
  topic: string;
  anchors: AnchorDraft[];
}

export interface ClaimCheck {
  errors: FieldErrors;
  ok: boolean;
  anchorsJson: string;
  title: string;
  statement: string;
}

export function checkClaim(
  draft: ClaimDraft,
  topics: readonly string[],
  limits: Limits = DEFAULT_LIMITS,
): ClaimCheck {
  const errors: FieldErrors = { anchorRows: {} };
  const title = squash(draft.title);
  const statement = squash(draft.statement);

  if (title.length < 3) errors.title = 'The title needs at least 3 characters.';
  else if (title.length > limits.max_title_chars)
    errors.title = `The title is limited to ${limits.max_title_chars} characters.`;

  if (statement.length < limits.min_statement_chars)
    errors.statement = `The statement needs at least ${limits.min_statement_chars} characters.`;
  else if (statement.length > limits.max_statement_chars)
    errors.statement = `The statement is limited to ${limits.max_statement_chars} characters.`;
  else if (stems(statement).size < 3)
    errors.statement = 'The statement says too little: it needs at least three distinctive words or numbers.';

  if (!topics.includes(draft.topic)) errors.topic = 'Choose a topic.';

  const groups: string[][] = [];
  const firsts = new Set<string>();
  const statementNorm = norm(statement);
  if (draft.anchors.length < 1)
    errors.anchors = 'Add at least one anchor: a specific that a source must show.';
  else if (draft.anchors.length > limits.max_anchor_groups)
    errors.anchors = `At most ${limits.max_anchor_groups} anchors are allowed.`;

  for (const row of draft.anchors) {
    const spellings = row.spellings.map(squash).filter((s) => s !== '');
    if (spellings.length === 0) {
      errors.anchorRows[row.id] = 'Write at least one spelling.';
      continue;
    }
    if (spellings.length > limits.max_anchor_alternatives) {
      errors.anchorRows[row.id] = `At most ${limits.max_anchor_alternatives} alternative spellings.`;
      continue;
    }
    const seen = new Set<string>();
    let problem = '';
    for (const spelling of spellings) {
      const n = norm(spelling);
      if (spelling.length > limits.max_anchor_chars)
        problem = `"${spelling}" is longer than ${limits.max_anchor_chars} characters.`;
      else if (tooGeneric(n)) problem = `"${spelling}" is too generic to identify a claim.`;
      else if (seen.has(n)) problem = `Duplicate spelling "${spelling}".`;
      seen.add(n);
      if (problem) break;
    }
    if (!problem) {
      const first = norm(spellings[0] ?? '');
      if (!hasTerm(statementNorm, first))
        problem = `"${spellings[0]}" must occur in the statement exactly as written.`;
      else if (firsts.has(first)) problem = `Duplicate anchor "${spellings[0]}".`;
      firsts.add(first);
    }
    if (problem) errors.anchorRows[row.id] = problem;
    else groups.push(spellings);
  }

  const ok =
    !errors.title &&
    !errors.statement &&
    !errors.topic &&
    !errors.anchors &&
    Object.keys(errors.anchorRows).length === 0 &&
    groups.length === draft.anchors.length;
  const anchorsJson = JSON.stringify(groups.map((group) => (group.length === 1 ? group[0] : group)));
  return { errors, ok, anchorsJson, title, statement };
}

/** Quick shape check before asking the contract's inspect_url view for the authoritative answer. */
export function quickUrlProblem(url: string, limits: Limits = DEFAULT_LIMITS): string {
  if (url.length === 0) return 'Paste the address of a public page.';
  if (url.length > limits.max_url_chars)
    return `The address is limited to ${limits.max_url_chars} characters.`;
  if (!url.startsWith('https://')) return 'The address must start with https://';
  if ([...url].some((c) => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127))
    return 'The address must not contain spaces or control characters.';
  if (url.includes('#')) return 'Remove the #fragment from the address.';
  return '';
}
