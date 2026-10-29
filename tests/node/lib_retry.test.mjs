import assert from 'node:assert/strict';
import test from 'node:test';

import { waitForDecision } from '../../scripts/lib.mjs';
import { isTransientRpcError } from '../../scripts/receipt.mjs';

const accepted = { statusName: 'ACCEPTED', consensus_data: { leader_receipt: [{ execution_result: 'SUCCESS' }] } };
const pending = { statusName: 'PENDING' };

test('an HTML error page or a dropped connection is transient, a submission error is not', () => {
  assert.equal(isTransientRpcError('GenLayer RPC error (eth_gasPrice): Unexpected token \'<\', "<!DOCTYPE "... is not valid JSON'), true);
  assert.equal(isTransientRpcError('HTTP request failed. Status: 502 Bad Gateway'), true);
  assert.equal(isTransientRpcError('fetch failed'), true);
  assert.equal(isTransientRpcError('read ECONNRESET'), true);
  // The call that submits the transaction may have reached the network: never send it twice.
  assert.equal(isTransientRpcError('GenLayer RPC error (eth_sendRawTransaction): Unexpected token \'<\', "<!DOCTYPE "...'), false);
  assert.equal(isTransientRpcError('execution reverted: refused: unknown claim'), false);
  assert.equal(isTransientRpcError(''), false);
  assert.equal(isTransientRpcError(undefined), false);
});

function clientThatAnswers(answers) {
  let index = 0;
  return {
    async getTransaction() {
      const answer = answers[Math.min(index, answers.length - 1)];
      index += 1;
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}

test('one bad poll after a long wait does not end the wait', async () => {
  const client = clientThatAnswers([pending, pending, pending, pending, new Error('Unexpected token \'<\', "<!DOCTYPE "'), accepted]);
  const result = await waitForDecision(client, '0xabc', { intervalMs: 20, errorToleranceMs: 50 });
  assert.equal(result.failure, null);
  assert.equal(result.statusName, 'ACCEPTED');
});

test('polling that keeps failing is reported, not waited out', async () => {
  const client = clientThatAnswers([pending, new Error('fetch failed')]);
  await assert.rejects(waitForDecision(client, '0xabc', { intervalMs: 20, errorToleranceMs: 60 }), /fetch failed/);
});

test('an UNDETERMINED transaction is a failure that says nothing was written', async () => {
  const client = clientThatAnswers([{ statusName: 'UNDETERMINED' }]);
  const result = await waitForDecision(client, '0xabc', { intervalMs: 5 });
  assert.equal(result.statusName, 'UNDETERMINED');
  assert.match(result.failure, /did not reach agreement/);
});

import { abi } from 'genlayer-js';

import { describeUndecided } from '../../scripts/receipt.mjs';
import { decodeStoredOutput } from '../../scripts/lib.mjs';

function stored(value) {
  return Buffer.from(abi.calldata.encode(value)).toString('base64');
}

test('an undecided transaction is explained: rounds, vote split, leader proposal, validator errors', () => {
  const outcome = {
    ok: true,
    verdict: 'TRIANGULATED',
    findings: [
      { source_id: 'S1', stance: 'SUPPORTS' },
      { source_id: 'S2', stance: 'SUPPORTS' },
      { source_id: 'S3', stance: 'UNVERIFIED', flag: 'excerpt_not_in_source' },
    ],
  };
  const transaction = {
    statusName: 'UNDETERMINED',
    numOfRounds: '5',
    lastRound: { validatorVotesName: ['AGREE', 'DISAGREE', 'TIMEOUT', 'DISAGREE', 'AGREE'] },
    consensus_data: {
      leader_receipt: [{ execution_result: 'SUCCESS', vote: 'AGREE', eq_outputs: { 0: stored(JSON.stringify(outcome)) } }],
      validators: [
        { vote: 'AGREE', execution_result: 'SUCCESS' },
        { vote: 'TIMEOUT', execution_result: 'ERROR', genvm_result: { stderr: 'VM exceeded the time limit' } },
      ],
    },
  };
  const text = describeUndecided(transaction, decodeStoredOutput).join('\n');
  assert.match(text, /rounds run: 5/);
  assert.match(text, /votes in the last round: AGREE 2, DISAGREE 2, TIMEOUT 1/);
  assert.match(text, /leader proposed TRIANGULATED: S1 SUPPORTS, S2 SUPPORTS, S3 UNVERIFIED \[excerpt_not_in_source\]/);
  assert.match(text, /validator 2: vote TIMEOUT, execution ERROR, stderr: VM exceeded the time limit/);
});

test('an outcome stored as a calldata map is read too, and unreadable shapes are skipped without failing', () => {
  const asMap = { ok: true, verdict: 'INCONCLUSIVE', findings: [{ source_id: 'S1', stance: 'SILENT' }] };
  const lines = describeUndecided({ consensus_data: { leader_receipt: [{ eq_outputs: { 0: stored(asMap) } }] } }, decodeStoredOutput);
  assert.ok(lines.some((line) => line === 'leader proposed INCONCLUSIVE: S1 SILENT'));
  assert.deepEqual(describeUndecided(undefined), []);
  assert.deepEqual(describeUndecided({ consensus_data: { leader_receipt: [{ eq_outputs: { 0: 'not base64 calldata!!' } }] } }, decodeStoredOutput), [
    'leader: execution ?, vote ?',
  ]);
});
