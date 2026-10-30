import { describe, expect, it } from 'vitest';

import {
  describeDecision,
  executionOf,
  findIdInReceipt,
  isTransientRpcError,
  phaseOf,
  statusNameOf,
} from '../lib/receipt';

const ok = (extra: object = {}) => ({
  consensus_data: { leader_receipt: [{ execution_result: 'SUCCESS' }] },
  ...extra,
});

describe('statusNameOf', () => {
  it('reads names, numeric codes and odd spellings', () => {
    expect(statusNameOf({ statusName: 'accepted' })).toBe('ACCEPTED');
    expect(statusNameOf({ status: '7' })).toBe('FINALIZED');
    expect(statusNameOf({ status: 5 })).toBe('ACCEPTED');
    expect(statusNameOf({ status_name: 'leader timeout' })).toBe('LEADER_TIMEOUT');
    expect(statusNameOf(null)).toBe('UNKNOWN');
    expect(statusNameOf({})).toBe('UNKNOWN');
  });
});

describe('phaseOf', () => {
  it('separates accepted from finalized and failures', () => {
    expect(phaseOf('ACCEPTED')).toBe('accepted');
    expect(phaseOf('FINALIZED')).toBe('finalized');
    expect(phaseOf('UNDETERMINED')).toBe('failed');
    expect(phaseOf('PENDING')).toBe('queued');
    expect(phaseOf('COMMITTING')).toBe('consensus');
  });
});

describe('executionOf', () => {
  it('is success only with an explicit successful result', () => {
    expect(executionOf(ok()).state).toBe('success');
    expect(executionOf({}).state).toBe('unknown');
    expect(executionOf({ consensus_data: { leader_receipt: [] } }).state).toBe('unknown');
  });
  it('reads the contract error out of a failed receipt', () => {
    const tx = {
      consensus_data: {
        leader_receipt: [
          {
            execution_result: 'ERROR',
            genvm_result: { stderr: 'Traceback\nUserError: this claim is already tracked as CLM-0001' },
          },
        ],
      },
    };
    const result = executionOf(tx);
    expect(result.state).toBe('failed');
    expect(result.message).toBe('this claim is already tracked as CLM-0001');
  });
  it('ignores validators cancelled after quorum', () => {
    const tx = {
      consensus_data: {
        leader_receipt: [
          { execution_result: 'SUCCESS' },
          { execution_result: 'ERROR', note: 'cancelled after quorum' },
        ],
      },
    };
    expect(executionOf(tx).state).toBe('success');
  });
});

describe('describeDecision', () => {
  it('only reports finality for a successful execution', () => {
    expect(describeDecision(ok(), 'ACCEPTED')).toMatchObject({ finality: 'accepted', failure: null });
    expect(describeDecision(ok(), 'FINALIZED')).toMatchObject({ finality: 'finalized', failure: null });
  });
  it('treats an accepted but failed call as a failure', () => {
    const tx = {
      consensus_data: {
        leader_receipt: [
          { execution_result: 'ERROR', genvm_result: { stderr: 'UserError: claim is closed' } },
        ],
      },
    };
    const result = describeDecision(tx, 'ACCEPTED');
    expect(result.finality).toBeNull();
    expect(result.failure).toBe('claim is closed');
  });
  it('treats an undetermined transaction as nothing written', () => {
    const result = describeDecision({}, 'UNDETERMINED');
    expect(result.finality).toBeNull();
    expect(result.failure).toMatch(/did not reach agreement/);
  });
  it('does not count an unreadable result as completed', () => {
    expect(describeDecision({}, 'ACCEPTED').failure).toMatch(/could not be read/);
  });
});

describe('helpers', () => {
  it('finds ids in receipts, with bigint safety', () => {
    expect(findIdInReceipt({ a: 1n, out: 'created CLM-0042 ok' }, 'CLM')).toBe('CLM-0042');
    expect(findIdInReceipt({}, 'CLM')).toBeNull();
  });
  it('never treats a submit failure as transient', () => {
    expect(isTransientRpcError('502 Bad Gateway')).toBe(true);
    expect(isTransientRpcError('eth_sendTransaction failed: 502 Bad Gateway')).toBe(false);
    expect(isTransientRpcError('user rejected')).toBe(false);
  });
});
