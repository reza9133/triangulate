// Pure transaction-receipt helpers, ported from scripts/receipt.mjs so the app reads GenLayer
// transactions exactly the way the command-line end-to-end run does.

const STATUS_BY_CODE: Record<number, string> = {
  0: 'UNINITIALIZED',
  1: 'PENDING',
  2: 'PROPOSING',
  3: 'COMMITTING',
  4: 'REVEALING',
  5: 'ACCEPTED',
  6: 'UNDETERMINED',
  7: 'FINALIZED',
  8: 'CANCELED',
  9: 'APPEAL_REVEALING',
  10: 'APPEAL_COMMITTING',
};

export const ACCEPTED = 'ACCEPTED';
export const FINALIZED = 'FINALIZED';
export const FAILED = new Set(['UNDETERMINED', 'CANCELED', 'LEADER_TIMEOUT', 'VALIDATORS_TIMEOUT']);

export type Phase = 'queued' | 'consensus' | 'accepted' | 'finalized' | 'failed';
export type Finality = 'accepted' | 'finalized' | null;
export type ExecutionState = 'success' | 'failed' | 'unknown';

type Loose = Record<string, unknown>;

const asRecord = (value: unknown): Loose | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Loose) : null;

export function jsonText(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item)) ?? '';
  } catch {
    return '';
  }
}

export function statusNameOf(transaction: unknown): string {
  const tx = asRecord(transaction);
  if (!tx) return 'UNKNOWN';
  const named = tx.statusName ?? tx.status_name;
  if (typeof named === 'string' && named.length > 0) return named.toUpperCase().replace(/[\s-]+/g, '_');
  const raw = tx.status;
  if (typeof raw === 'string' && /^\d+$/.test(raw)) return STATUS_BY_CODE[Number(raw)] ?? `STATUS_${raw}`;
  if (typeof raw === 'string' && raw.length > 0) return raw.toUpperCase().replace(/[\s-]+/g, '_');
  if (typeof raw === 'number' || typeof raw === 'bigint')
    return STATUS_BY_CODE[Number(raw)] ?? `STATUS_${String(raw)}`;
  return 'UNKNOWN';
}

/** ACCEPTED can still be appealed, FINALIZED cannot change. Neither says the contract call worked. */
export function phaseOf(statusName: string): Phase {
  if (statusName === FINALIZED) return 'finalized';
  if (statusName === ACCEPTED) return 'accepted';
  if (FAILED.has(statusName)) return 'failed';
  if (statusName === 'PENDING' || statusName === 'UNINITIALIZED' || statusName === 'UNKNOWN') return 'queued';
  return 'consensus';
}

export const isDecision = (phase: Phase): boolean =>
  phase === 'accepted' || phase === 'finalized' || phase === 'failed';

function leaderReceipts(transaction: unknown): Loose[] {
  const tx = asRecord(transaction);
  const consensus = asRecord(tx?.consensus_data ?? tx?.consensusData);
  const receipts = consensus?.leader_receipt ?? consensus?.leaderReceipt;
  return Array.isArray(receipts)
    ? receipts.map(asRecord).filter((entry): entry is Loose => entry !== null)
    : [];
}

function cleanErrorText(text: string): string {
  const user = text.match(/UserError[^\n:]*:\s*(.+)/);
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const picked = (user?.[1] ?? lines[lines.length - 1] ?? text).trim().replace(/^['"]+|['"]+$/g, '');
  return picked.length > 300 ? `${picked.slice(0, 297)}...` : picked;
}

function failureText(leader: Loose | undefined): string {
  const result = asRecord(leader?.result);
  const payload = result?.payload;
  const genvm = asRecord(leader?.genvm_result);
  const payloadRecord = asRecord(payload);
  const candidates = [
    genvm?.stderr,
    payloadRecord?.readable,
    typeof payload === 'string' ? payload : undefined,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) return cleanErrorText(candidate);
  }
  return 'The contract rejected this transaction. Open it in the explorer for the execution log.';
}

const EXECUTION_SUCCESS = new Set(['SUCCESS', 'FINISHED_WITH_RETURN']);
const CANCELLED_AFTER_QUORUM = /cancell?ed after quorum/i;

export interface Execution {
  state: ExecutionState;
  message?: string;
}

/**
 * Success needs an explicit successful execution result. A missing or unreadable one is 'unknown',
 * never success: a transaction can be ACCEPTED while the contract call raised an error.
 */
export function executionOf(transaction: unknown): Execution {
  const receipts = leaderReceipts(transaction);
  const results: { result: string; receipt?: Loose }[] = [];
  for (const receipt of receipts) {
    const result = String(receipt.execution_result ?? receipt.executionResult ?? '').toUpperCase();
    if (result !== '') results.push({ result, receipt });
  }
  const tx = asRecord(transaction);
  const named = String(tx?.txExecutionResultName ?? tx?.tx_execution_result_name ?? '').toUpperCase();
  if (named !== '' && named !== 'NOT_VOTED') results.push({ result: named });

  const counted = results.filter(
    (entry) => !(entry.receipt && CANCELLED_AFTER_QUORUM.test(jsonText(entry.receipt))),
  );
  if (counted.length === 0) return { state: 'unknown' };
  const bad = counted.find((entry) => !EXECUTION_SUCCESS.has(entry.result));
  if (bad === undefined) return { state: 'success' };
  return { state: 'failed', message: failureText(bad.receipt ?? receipts[0]) };
}

export function settledAs(statusName: string, execution: Execution): Finality {
  if (execution.state !== 'success') return null;
  if (statusName === FINALIZED) return 'finalized';
  if (statusName === ACCEPTED) return 'accepted';
  return null;
}

export interface Decision {
  statusName: string;
  execution: ExecutionState;
  finality: Finality;
  failure: string | null;
}

/** Pure: what a decided (or failed) transaction means. */
export function describeDecision(transaction: unknown, statusName: string): Decision {
  const phase = phaseOf(statusName);
  if (phase === 'failed' || !isDecision(phase)) {
    return {
      statusName,
      execution: 'unknown',
      finality: null,
      failure: `The validators did not reach agreement (${statusName.toLowerCase().replace(/_/g, ' ')}). Nothing was written.`,
    };
  }
  const execution = executionOf(transaction);
  const finality = settledAs(statusName, execution);
  let failure: string | null = null;
  if (execution.state === 'failed') failure = execution.message ?? 'The contract rejected this transaction.';
  else if (execution.state === 'unknown') {
    failure =
      'The network decided this transaction, but its execution result could not be read, so it is not treated as completed.';
  }
  return { statusName, execution: execution.state, finality, failure };
}

/** First id with the given prefix (for example CLM-0004) found anywhere in a receipt. */
export function findIdInReceipt(receipt: unknown, prefix: string): string | null {
  const match = jsonText(receipt).match(new RegExp(`${prefix}-\\d{4,}`));
  return match ? match[0] : null;
}

/** Whether an RPC failure is the kind that goes away by itself (gateway page, dropped connection). */
export function isTransientRpcError(message: string): boolean {
  if (/eth_sendRawTransaction|eth_sendTransaction/i.test(message)) return false;
  return /<!DOCTYPE|Unexpected token '<'|is not valid JSON|\b(?:502|503|504)\b|Bad Gateway|Service Unavailable|Gateway Time-?out|Failed to fetch|NetworkError|network error/i.test(
    message,
  );
}
