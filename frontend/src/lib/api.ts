import { readJson, readRaw } from './chain';
import type { ClaimBundle, ClaimList, ContractInfo, ContractStats, ExamBundle, UrlInspection } from './types';

export const fetchStats = (signal?: AbortSignal) => readJson<ContractStats>('stats', [], signal);
export const fetchInfo = (signal?: AbortSignal) => readJson<ContractInfo>('contract_info', [], signal);
export const fetchClaims = (offset: number, limit: number, signal?: AbortSignal) =>
  readJson<ClaimList>('list_claims', [offset, limit], signal);
export const fetchClaim = (claimId: string, signal?: AbortSignal) =>
  readJson<ClaimBundle | null>('get_claim_bundle', [claimId], signal);
export const fetchExam = (examId: string, signal?: AbortSignal) =>
  readJson<ExamBundle | null>('get_examination_bundle', [examId], signal);
export const inspectUrl = (url: string, signal?: AbortSignal) =>
  readJson<UrlInspection>('inspect_url', [url], signal);
export const recomputeAttestation = (examId: string, signal?: AbortSignal) =>
  readRaw('recompute_attestation', [examId], signal);

export const CLAIM_ID_RE = /^CLM-\d{4,}$/;
export const EXAM_ID_RE = /^EXM-\d{4,}$/;

/** Every claim, newest first, fetched page by page (the contract caps a page at 50). */
export async function fetchAllClaims(signal?: AbortSignal, max = 500): Promise<ClaimList> {
  const first = await fetchClaims(0, 50, signal);
  const items = [...first.items];
  while (items.length < first.total && items.length < max) {
    const page = await fetchClaims(items.length, 50, signal);
    if (page.items.length === 0) break;
    items.push(...page.items);
  }
  return { total: first.total, offset: 0, items };
}
