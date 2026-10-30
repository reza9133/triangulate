import type { Stance, Verdict, OriginStance, EdgeKind } from './types';

export const shortAddress = (address: string, head = 6, tail = 4): string =>
  address.length <= head + tail + 2 ? address : `${address.slice(0, head)}…${address.slice(-tail)}`;

export const sameAddress = (a: string | null | undefined, b: string | null | undefined): boolean =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** Unix seconds to a readable UTC date and time. 0 means "never". */
export function formatTime(seconds: number): string {
  if (!seconds) return '—';
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

export function formatDuration(seconds: number): string {
  if (seconds % 3600 === 0 && seconds >= 3600) return `${seconds / 3600} hour${seconds === 3600 ? '' : 's'}`;
  if (seconds % 60 === 0 && seconds >= 60) return `${seconds / 60} minutes`;
  return `${seconds} seconds`;
}

export function relativeTime(seconds: number, now = Date.now()): string {
  if (!seconds) return 'never';
  const delta = Math.max(0, Math.round(now / 1000 - seconds));
  if (delta < 60) return 'just now';
  if (delta < 3600) return `${Math.floor(delta / 60)} min ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)} h ago`;
  return `${Math.floor(delta / 86400)} d ago`;
}

export type Tone = 'good' | 'warn' | 'bad' | 'mixed' | 'muted' | 'info';

export interface VerdictMeta {
  tone: Tone;
  label: string;
  short: string;
  meaning: string;
}

export const VERDICT_META: Record<Verdict | 'UNEXAMINED', VerdictMeta> = {
  TRIANGULATED: {
    tone: 'good',
    label: 'Triangulated',
    short: '3+ independent',
    meaning:
      'Three or more independent origins support the claim, none contradicts it, and nothing is unresolved.',
  },
  CORROBORATED: {
    tone: 'good',
    label: 'Corroborated',
    short: '2 independent',
    meaning: 'Two independent origins support the claim, none contradicts it, and nothing is unresolved.',
  },
  ECHO_ONLY: {
    tone: 'warn',
    label: 'Echo only',
    short: 'one voice',
    meaning: 'Several sources agree, but they collapse into one origin: the same voice repeated.',
  },
  UNCONFIRMED: {
    tone: 'warn',
    label: 'Unconfirmed',
    short: '≤ 1 voice',
    meaning: 'At most one independent voice supports the claim.',
  },
  QUALIFIED: {
    tone: 'info',
    label: 'Qualified',
    short: 'partial',
    meaning: 'The sources address the claim only partly, or with caveats.',
  },
  DOUBTED: {
    tone: 'bad',
    label: 'Doubted',
    short: '1 against',
    meaning: 'One independent origin contradicts the claim and none supports it.',
  },
  CONTESTED: {
    tone: 'mixed',
    label: 'Contested',
    short: 'split',
    meaning: 'Independent origins support the claim and independent origins contradict it.',
  },
  REFUTED: {
    tone: 'bad',
    label: 'Refuted',
    short: '2+ against',
    meaning: 'Two or more independent origins contradict the claim and none supports it.',
  },
  INCONCLUSIVE: {
    tone: 'muted',
    label: 'Inconclusive',
    short: 'unread',
    meaning: 'Nothing verifiable was read, or a clean bill was blocked by an unresolved source.',
  },
  UNEXAMINED: {
    tone: 'muted',
    label: 'Unexamined',
    short: 'not read yet',
    meaning: 'The validators have not examined this claim yet.',
  },
};

export const verdictMeta = (verdict: string): VerdictMeta =>
  (VERDICT_META as Record<string, VerdictMeta>)[verdict] ?? {
    tone: 'muted',
    label: verdict,
    short: '',
    meaning: '',
  };

export const STANCE_TONE: Record<Stance | OriginStance, Tone> = {
  SUPPORTS: 'good',
  CONTRADICTS: 'bad',
  QUALIFIES: 'info',
  SILENT: 'muted',
  UNVERIFIED: 'warn',
  UNREADABLE: 'muted',
  CONFLICTED: 'mixed',
  UNRESOLVED: 'warn',
};

export const EDGE_LABEL: Record<EdgeKind, string> = {
  SAME_ORIGIN: 'same publisher',
  CITES: 'links to',
  NEAR_COPY: 'near copy',
  SHARED_PASSAGE: 'shared passage',
};

export const EDGE_EXPLAIN: Record<EdgeKind, string> = {
  SAME_ORIGIN: 'Both pages come from one publisher (registrable domain, or the tenant of a shared host).',
  CITES: 'One page links to the exact address of the other, so it relays it.',
  NEAR_COPY: 'Most of the smaller page’s text appears in the larger one: syndication or a mirror.',
  SHARED_PASSAGE: 'Both pages carry the same claim-relevant sentence, word for word.',
};

export const FLAG_EXPLAIN: Record<string, string> = {
  unusable_stance: 'The model answered with something outside the fixed stance vocabulary.',
  excerpt_not_in_source: 'The quoted excerpt was not found on the page, so the answer was voided.',
  excerpt_unrelated_to_claim: 'The excerpt shares nothing with the claim.',
  anchors_missing_from_support: 'Support was downgraded: the excerpt does not show every anchor.',
  excerpt_too_loosely_related: 'A contradiction needs an excerpt that is really about the claim.',
  contradiction_without_signal: 'A contradiction needs a missing anchor or an explicit negation.',
  model_unavailable: 'The language model could not be reached during this examination.',
  UNREACHABLE: 'The page could not be fetched.',
  HTTP_4XX: 'The page answered with a client error (4xx).',
  HTTP_5XX: 'The page answered with a server error (5xx).',
  EMPTY: 'The page had no readable text.',
};

export const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};
