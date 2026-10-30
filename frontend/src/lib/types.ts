// Shapes returned by the Triangulate contract views. They mirror contracts/triangulate.py.

export const TOPICS = [
  'science',
  'health',
  'economy',
  'technology',
  'history',
  'environment',
  'society',
  'other',
] as const;
export type Topic = (typeof TOPICS)[number];

export const VERDICTS = [
  'TRIANGULATED',
  'CORROBORATED',
  'ECHO_ONLY',
  'UNCONFIRMED',
  'QUALIFIED',
  'DOUBTED',
  'CONTESTED',
  'REFUTED',
  'INCONCLUSIVE',
] as const;
export type Verdict = (typeof VERDICTS)[number];

export type Stance = 'SUPPORTS' | 'CONTRADICTS' | 'QUALIFIES' | 'SILENT' | 'UNVERIFIED' | 'UNREADABLE';
export type OriginStance = 'SUPPORTS' | 'CONTRADICTS' | 'QUALIFIES' | 'SILENT' | 'CONFLICTED' | 'UNRESOLVED';
export type EdgeKind = 'SAME_ORIGIN' | 'CITES' | 'NEAR_COPY' | 'SHARED_PASSAGE';
export type ClaimStatus = 'OPEN' | 'CLOSED';
export type Standing = Verdict | 'UNEXAMINED';

export interface ClaimSummary {
  claim_id: string;
  title: string;
  topic: string;
  owner: string;
  status: ClaimStatus;
  standing: Standing;
  sources: number;
  examinations: number;
  flips: number;
  created_at: number;
  last_exam_id: string;
}

export interface ClaimList {
  total: number;
  offset: number;
  items: ClaimSummary[];
}

export interface SourceRecord {
  source_id: string;
  url: string;
  source_key: string;
  origin_key: string;
  added_by: string;
  added_at: number;
}

export interface DroppedEntry {
  source_id: string;
  url: string;
  added_by: string;
  dropped_at: number;
  last_stance: string;
}

export interface VerdictHistoryEntry {
  exam_id: string;
  verdict: Verdict;
  at: number;
}

export interface DriftEntry {
  exam_id: string;
  source_id: string;
  was: string;
  now: string;
}

export interface ClaimRecord {
  claim_id: string;
  title: string;
  statement: string;
  topic: string;
  anchors: string[][];
  commitment: string;
  owner: string;
  status: ClaimStatus;
  created_at: number;
  closed_at: number;
  sources: SourceRecord[];
  next_source: number;
  dropped: DroppedEntry[];
  exam_ids: string[];
  last_exam_id: string;
  standing: Standing;
  last_conclusive_at: number;
  dirty: boolean;
  flips: number;
  verdict_history: VerdictHistoryEntry[];
  last_stance: Record<string, string>;
  drift: DriftEntry[];
}

export interface Tallies {
  sources: number;
  origins: number;
  echoes: number;
  readable_origins: number;
  support_origins: number;
  contradict_origins: number;
  qualify_origins: number;
  silent_origins: number;
  conflicted_origins: number;
  unresolved_origins: number;
  support_sources: number;
}

export interface ExamSummary {
  exam_id: string;
  claim_id: string;
  verdict: Verdict;
  conclusive: boolean;
  tallies: Tallies;
  examined_at: number;
  requested_by: string;
}

export interface ClaimBundle {
  claim: ClaimRecord;
  examinations: ExamSummary[];
}

export interface Finding {
  source_id: string;
  url: string;
  origin_key: string;
  stance: Stance;
  excerpt: string;
  reason: string;
  flag: string;
  claimed: string;
  seen: string;
}

export interface OriginGroup {
  origin_id: string;
  sources: string[];
  stance: OriginStance;
}

export interface EchoEdge {
  a: string;
  b: string;
  kind: EdgeKind;
}

export interface ExamSource {
  source_id: string;
  url: string;
  source_key: string;
  origin_key: string;
}

export interface ExamRecord {
  exam_id: string;
  claim_id: string;
  requested_by: string;
  examined_at: number;
  verdict: Verdict;
  conclusive: boolean;
  tallies: Tallies;
  origins: OriginGroup[];
  edges: EchoEdge[];
  findings: Finding[];
  sources: ExamSource[];
  attestation: string;
}

export interface ExamBundle {
  examination: ExamRecord;
  claim: ClaimRecord;
}

export interface ContractStats {
  claims: number;
  examinations: number;
  sources_added: number;
  conclusive: number;
  verdict_flips: number;
  stance_drifts: number;
  verdicts: Record<string, number>;
}

export interface ContractInfo {
  name: string;
  version: string;
  runner: string;
  topics: string[];
  verdicts: string[];
  stances: string[];
  edge_kinds: string[];
  limits: {
    max_sources: number;
    min_sources_to_examine: number;
    max_sources_per_adder: number;
    max_sources_per_origin: number;
    min_statement_chars: number;
    max_statement_chars: number;
    max_title_chars: number;
    max_anchor_groups: number;
    max_anchor_alternatives: number;
    max_anchor_chars: number;
    max_url_chars: number;
    max_examinations_per_claim: number;
    reexamine_cooldown_seconds: number;
    window_chars: number;
  };
  echo_rules: Record<string, number>;
  publishers: {
    path_tenant_hosts: Record<string, [string, number]>;
    tenant_suffixes: string[];
    refused_hosts: string[];
  };
}

export interface UrlInspection {
  ok: boolean;
  url: string;
  origin_key: string;
  source_key: string;
  reason: string;
}

/** Limits used before contract_info has loaded. They are the contract's own constants. */
export const DEFAULT_LIMITS: ContractInfo['limits'] = {
  max_sources: 6,
  min_sources_to_examine: 2,
  max_sources_per_adder: 3,
  max_sources_per_origin: 2,
  min_statement_chars: 20,
  max_statement_chars: 400,
  max_title_chars: 120,
  max_anchor_groups: 4,
  max_anchor_alternatives: 4,
  max_anchor_chars: 60,
  max_url_chars: 500,
  max_examinations_per_claim: 30,
  reexamine_cooldown_seconds: 3600,
  window_chars: 2800,
};
