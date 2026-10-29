import assert from 'node:assert/strict';
import test from 'node:test';

import { executionOf, isDecision, phaseOf, settledAs, statusNameOf } from '../../scripts/receipt.mjs';
import { describeDecision } from '../../scripts/lib.mjs';

const ok = { statusName: 'ACCEPTED', consensus_data: { leader_receipt: [{ execution_result: 'SUCCESS' }] } };
const refused = {
  statusName: 'ACCEPTED',
  consensus_data: { leader_receipt: [{ execution_result: 'ERROR', genvm_result: { stderr: 'Traceback...\nUserError: claim is closed' } }] },
};

test('status names are read from names, numeric codes and odd spellings', () => {
  assert.equal(statusNameOf({ statusName: 'finalized' }), 'FINALIZED');
  assert.equal(statusNameOf({ status: '5' }), 'ACCEPTED');
  assert.equal(statusNameOf({ status: 7 }), 'FINALIZED');
  assert.equal(statusNameOf({ status: 'appeal revealing' }), 'APPEAL_REVEALING');
  assert.equal(statusNameOf(null), 'UNKNOWN');
  assert.equal(statusNameOf({}), 'UNKNOWN');
});

test('phases', () => {
  assert.equal(phaseOf('FINALIZED'), 'finalized');
  assert.equal(phaseOf('ACCEPTED'), 'accepted');
  assert.equal(phaseOf('UNDETERMINED'), 'failed');
  assert.equal(phaseOf('PENDING'), 'queued');
  assert.equal(phaseOf('COMMITTING'), 'consensus');
  assert.equal(isDecision('accepted'), true);
  assert.equal(isDecision('consensus'), false);
});

test('an ACCEPTED transaction whose contract call raised is a failure, with the contract message', () => {
  const result = executionOf(refused);
  assert.equal(result.state, 'failed');
  assert.equal(result.message, 'claim is closed');
  const decided = describeDecision(refused, 'ACCEPTED');
  assert.equal(decided.execution, 'failed');
  assert.equal(decided.finality, null);
  assert.equal(decided.failure, 'claim is closed');
});

test('success needs an explicit successful execution result', () => {
  assert.equal(executionOf(ok).state, 'success');
  assert.equal(executionOf({ statusName: 'ACCEPTED' }).state, 'unknown');
  const decided = describeDecision({ statusName: 'ACCEPTED' }, 'ACCEPTED');
  assert.equal(decided.execution, 'unknown');
  assert.ok(decided.failure);
  assert.equal(settledAs('ACCEPTED', { state: 'unknown' }), null);
  assert.equal(settledAs('FINALIZED', { state: 'success' }), 'finalized');
  assert.equal(settledAs('ACCEPTED', { state: 'success' }), 'accepted');
});

test('a mixed set of leader results counts as failed', () => {
  const mixed = { statusName: 'ACCEPTED', consensus_data: { leader_receipt: [{ execution_result: 'SUCCESS' }, { execution_result: 'ERROR' }] } };
  assert.equal(executionOf(mixed).state, 'failed');
});

test('a transaction the validators could not settle is reported as not written', () => {
  const decided = describeDecision({}, 'UNDETERMINED');
  assert.equal(decided.execution, 'unknown');
  assert.match(decided.failure, /did not reach agreement/);
});

test('camelCase receipts are understood too', () => {
  const tx = { statusName: 'ACCEPTED', consensusData: { leaderReceipt: [{ executionResult: 'FINISHED_WITH_RETURN' }] } };
  assert.equal(executionOf(tx).state, 'success');
});

test('validators cancelled after quorum do not turn a successful call into a failure', () => {
  const tx = {
    statusName: 'ACCEPTED',
    consensus_data: {
      leader_receipt: [
        { execution_result: 'SUCCESS' },
        { execution_result: 'ERROR', genvm_result: { stderr: 'Validator execution cancelled after quorum' } },
        { execution_result: 'SUCCESS' },
      ],
    },
  };
  assert.equal(executionOf(tx).state, 'success');
  assert.equal(describeDecision(tx, 'ACCEPTED').execution, 'success');
});

test('a real contract error is still a failure even next to cancelled validators', () => {
  const tx = {
    statusName: 'ACCEPTED',
    consensus_data: {
      leader_receipt: [
        { execution_result: 'ERROR', genvm_result: { stderr: 'UserError: claim is closed' } },
        { execution_result: 'ERROR', genvm_result: { stderr: 'Validator execution cancelled after quorum' } },
      ],
    },
  };
  const result = executionOf(tx);
  assert.equal(result.state, 'failed');
  assert.equal(result.message, 'claim is closed');
});

test('receipts that are only cancellations say nothing', () => {
  const tx = { statusName: 'ACCEPTED', consensus_data: { leader_receipt: [{ execution_result: 'ERROR', genvm_result: { stderr: 'Validator execution cancelled after quorum' } }] } };
  assert.equal(executionOf(tx).state, 'unknown');
});
