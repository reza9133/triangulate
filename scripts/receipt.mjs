// Pure transaction-receipt helpers for the command-line scripts. Plain JavaScript, no
// dependencies, so the scripts run on Node 20 and the helpers can be unit-tested offline.

const STATUS_BY_CODE = {
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
export const DECIDED = new Set([ACCEPTED, FINALIZED]);
export const FAILED = new Set(['UNDETERMINED', 'CANCELED', 'LEADER_TIMEOUT', 'VALIDATORS_TIMEOUT']);

/**
 * Whether an error from the RPC endpoint is the kind that goes away by itself: a gateway answering with an
 * HTML error page instead of JSON, a 502/503/504, a dropped connection. Errors that name the call that
 * actually submits the transaction are never transient here: that call may have reached the network, and
 * sending it again could submit the same transaction twice.
 */
export function isTransientRpcError(message) {
  const text = String(message ?? '');
  if (/eth_sendRawTransaction|eth_sendTransaction/i.test(text)) return false;
  return /<!DOCTYPE|Unexpected token '<'|is not valid JSON|\b(?:502|503|504)\b|Bad Gateway|Service Unavailable|Gateway Time-?out|fetch failed|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|socket hang up|network error/i.test(text);
}

function tallyOf(names) {
  const counts = new Map();
  for (const name of names) counts.set(String(name), (counts.get(String(name)) ?? 0) + 1);
  return [...counts].map(([name, count]) => `${name} ${count}`).join(', ');
}

function plainValue(value) {
  if (value instanceof Map) return Object.fromEntries([...value].map(([key, item]) => [String(key), plainValue(item)]));
  if (Array.isArray(value)) return value.map(plainValue);
  if (typeof value === 'bigint') return value.toString();
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plainValue(item)]));
  return value;
}

function shorten(value, limit = 240) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

/**
 * Read an examination outcome out of a leader's output: the decoded value is either the outcome itself or
 * a JSON string holding it. Returns "VERDICT: S1 STANCE, S2 STANCE [flag]" or '' when nothing readable.
 */
function outcomeLine(decoded) {
  let value = plainValue(decoded);
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return '';
    }
  }
  if (!value || typeof value !== 'object' || !Array.isArray(value.findings)) return '';
  const stances = value.findings
    .map((finding) => `${finding?.source_id ?? '?'} ${finding?.stance ?? '?'}${finding?.flag ? ` [${finding.flag}]` : ''}`)
    .join(', ');
  return `${value.verdict ?? 'no verdict'}: ${stances}`;
}

/**
 * Plain-text lines that say why validators could not settle a transaction: how many rounds ran, how each
 * validator voted in the last one (an AGREE/DISAGREE/TIMEOUT split points at different causes), whether
 * any of them reported an error, and what the last leader proposed. Every field is optional because the
 * shape differs between endpoints; whatever is missing is simply left out.
 * `decode` turns one stored output into a value (or throws or returns null).
 */
export function describeUndecided(transaction, decode = () => null) {
  const lines = [];
  const tx = transaction && typeof transaction === 'object' ? transaction : {};
  const round = tx.lastRound && typeof tx.lastRound === 'object' ? tx.lastRound : null;
  if (tx.numOfRounds !== undefined && tx.numOfRounds !== null) lines.push(`rounds run: ${String(tx.numOfRounds)}`);
  if (round && Array.isArray(round.validatorVotesName) && round.validatorVotesName.length > 0) {
    lines.push(`votes in the last round: ${tallyOf(round.validatorVotesName)}`);
  }
  const data = tx.consensus_data && typeof tx.consensus_data === 'object' ? tx.consensus_data : {};
  if (data.votes && typeof data.votes === 'object' && Object.keys(data.votes).length > 0) {
    lines.push(`votes by validator: ${tallyOf(Object.values(data.votes))}`);
  }
  const leader = Array.isArray(data.leader_receipt) && data.leader_receipt.length > 0 ? data.leader_receipt[0] : null;
  if (leader && typeof leader === 'object') {
    lines.push(`leader: execution ${leader.execution_result ?? '?'}, vote ${leader.vote ?? '?'}${leader.error ? `, error: ${shorten(leader.error)}` : ''}`);
    const outputs = leader.eq_outputs && typeof leader.eq_outputs === 'object' ? Object.values(leader.eq_outputs) : [];
    for (const raw of outputs) {
      let line = '';
      try {
        line = outcomeLine(decode(raw));
      } catch {
        line = '';
      }
      if (line) {
        lines.push(`leader proposed ${line}`);
        break;
      }
    }
  }
  const validators = Array.isArray(data.validators) ? data.validators : [];
  validators.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return;
    const receipt = entry;
    const parts = [`vote ${receipt.vote ?? '?'}`, `execution ${receipt.execution_result ?? '?'}`];
    if (receipt.error) parts.push(`error: ${shorten(receipt.error)}`);
    const stderr = receipt.genvm_result && typeof receipt.genvm_result === 'object' ? receipt.genvm_result.stderr : null;
    if (stderr) parts.push(`stderr: ${shorten(stderr)}`);
    lines.push(`validator ${index + 1}: ${parts.join(', ')}`);
  });
  return lines;
}

export function jsonText(value) {
  try {
    return JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item)) ?? '';
  } catch {
    return '';
  }
}

export function statusNameOf(transaction) {
  const tx = transaction ?? null;
  if (!tx) return 'UNKNOWN';
  const named = tx.statusName ?? tx.status_name;
  if (typeof named === 'string' && named.length > 0) return named.toUpperCase().replace(/[\s-]+/g, '_');
  const raw = tx.status;
  if (typeof raw === 'string' && /^\d+$/.test(raw)) return STATUS_BY_CODE[Number(raw)] ?? `STATUS_${raw}`;
  if (typeof raw === 'string' && raw.length > 0) return raw.toUpperCase().replace(/[\s-]+/g, '_');
  if (typeof raw === 'number' || typeof raw === 'bigint') return STATUS_BY_CODE[Number(raw)] ?? `STATUS_${String(raw)}`;
  return 'UNKNOWN';
}

// ACCEPTED means the validators agreed but the result can still be appealed. FINALIZED means it
// cannot change. They are different phases, and neither says the contract call itself worked.
export function phaseOf(statusName) {
  if (statusName === FINALIZED) return 'finalized';
  if (statusName === ACCEPTED) return 'accepted';
  if (FAILED.has(statusName)) return 'failed';
  if (statusName === 'PENDING' || statusName === 'UNINITIALIZED' || statusName === 'UNKNOWN') return 'queued';
  return 'consensus';
}

export function isDecision(phase) {
  return phase === 'accepted' || phase === 'finalized' || phase === 'failed';
}

function leaderReceipts(transaction) {
  const consensus = transaction?.consensus_data ?? transaction?.consensusData;
  const receipts = consensus?.leader_receipt ?? consensus?.leaderReceipt;
  return Array.isArray(receipts) ? receipts.filter((entry) => entry && typeof entry === 'object') : [];
}

function cleanErrorText(text) {
  const user = text.match(/UserError[^\n:]*:\s*(.+)/);
  const lines = text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
  const picked = (user ? user[1] : lines[lines.length - 1] ?? text).trim().replace(/^['"]+|['"]+$/g, '');
  return picked.length > 300 ? `${picked.slice(0, 297)}...` : picked;
}

function failureText(leader) {
  const payload = leader?.result?.payload;
  const candidates = [leader?.genvm_result?.stderr, payload?.readable, typeof payload === 'string' ? payload : undefined];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) return cleanErrorText(candidate);
  }
  return 'The contract rejected this transaction. Open it in the explorer for the execution log.';
}

const EXECUTION_SUCCESS = new Set(['SUCCESS', 'FINISHED_WITH_RETURN']);
const CANCELLED_AFTER_QUORUM = /cancell?ed after quorum/i;

// Success needs an explicit successful execution result. A missing or unreadable one is
// 'unknown', never success: a transaction can be ACCEPTED while the contract call raised an error.
export function executionOf(transaction) {
  const receipts = leaderReceipts(transaction);
  const results = [];
  for (const receipt of receipts) {
    const result = String(receipt.execution_result ?? receipt.executionResult ?? '').toUpperCase();
    if (result !== '') results.push({ result, receipt });
  }
  const named = String(transaction?.txExecutionResultName ?? transaction?.tx_execution_result_name ?? '').toUpperCase();
  if (named !== '' && named !== 'NOT_VOTED') results.push({ result: named });

  // After quorum is reached the network cancels the validators that have not finished. Their
  // receipts say so, carry an error result, and say nothing about whether the contract call worked.
  const counted = results.filter((entry) => !(entry.receipt && CANCELLED_AFTER_QUORUM.test(jsonText(entry.receipt))));
  if (counted.length === 0) return { state: 'unknown' };
  const bad = counted.find((entry) => !EXECUTION_SUCCESS.has(entry.result));
  if (bad === undefined) return { state: 'success' };
  return { state: 'failed', message: failureText(bad.receipt ?? receipts[0]) };
}

/** Null unless the contract call itself failed. */
export function executionFailure(transaction) {
  const execution = executionOf(transaction);
  return execution.state === 'failed' ? execution.message : null;
}

export function settledAs(statusName, execution) {
  if (execution.state !== 'success') return null;
  if (statusName === FINALIZED) return 'finalized';
  if (statusName === ACCEPTED) return 'accepted';
  return null;
}

export function findIdInReceipt(receipt, prefix) {
  const match = jsonText(receipt).match(new RegExp(`${prefix}-\\d{4,}`));
  return match ? match[0] : null;
}
