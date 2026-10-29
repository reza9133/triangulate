import assert from 'node:assert/strict';
import test from 'node:test';

import { checkStructure, excerptOnPage, hasAnyText, htmlToText, judgeVerdict, normText, renderReport } from '../../scripts/report-lib.mjs';

test('normText matches the contract normalisation', () => {
  assert.equal(normText('  It\u2019s  A \u201cTest\u201d \u2013 ok\u00a0now '), 'it\'s a "test" - ok now');
  assert.equal(normText('299\u202f792\u2009458'), '299 792 458');
  assert.equal(normText(null), '');
});

test('htmlToText drops hidden elements and keeps inline text together', () => {
  const html = '<style>.a{}</style><script>var x="secret";</script><p>Cut by <b>40</b>% &amp; more</p><!-- no --><p>Second&nbsp;line</p>';
  assert.equal(htmlToText(html), 'Cut by 40% & more Second line');
});

test('htmlToText survives hostile markup quickly', () => {
  const started = Date.now();
  for (const raw of ['<script>'.repeat(50000), '<a'.repeat(200000), '<!-- '.repeat(80000), '&amp;'.repeat(100000)]) htmlToText(raw);
  assert.ok(Date.now() - started < 5000);
});

test('page text checks', () => {
  const page = 'The speed of light is 299 792 458 m/s';
  assert.equal(hasAnyText(page, ['299,792,458', '299 792 458']), true);
  assert.equal(hasAnyText(page, ['300,000']), false);
  assert.equal(hasAnyText(page, []), null);
  assert.equal(excerptOnPage('SPEED of light is 299 792 458', page), true);
  assert.equal(excerptOnPage('something else', page), false);
  assert.equal(excerptOnPage('', page), false);
  assert.equal(excerptOnPage('speed of light is 299,792,458 m/s', 'The speed of light is 299 792 458 m s-1, | exactly'), true);
  assert.equal(excerptOnPage('light is exactly 299 792 458', 'The speed of light is 299 792 458 m s-1'), false);
  assert.equal(excerptOnPage('SPEED of light is [1] 299 792 458', 'The speed of light is 299 792 458 m/s'), true);
  assert.equal(excerptOnPage('peed of light is 299 792 458', page), false);
});

test('structure and verdict judgement', () => {
  assert.deepEqual(checkStructure({ origins: 1, echoes: 1 }, { origins: 1, echoes: 1 }), []);
  assert.equal(checkStructure({ origins: 1, echoes: 1 }, { origins: 2, echoes: 0 }).length, 2);
  assert.deepEqual(checkStructure(undefined, {}), []);
  const scenario = { expect_any: ['ECHO_ONLY'], expect_not: ['TRIANGULATED'] };
  assert.deepEqual(judgeVerdict(scenario, 'ECHO_ONLY'), { forbidden: false, hoped: true });
  assert.deepEqual(judgeVerdict(scenario, 'THIN'), { forbidden: false, hoped: false });
  assert.deepEqual(judgeVerdict(scenario, 'TRIANGULATED'), { forbidden: true, hoped: false });
  assert.deepEqual(judgeVerdict({}, 'X'), { forbidden: false, hoped: null });
});

test('the report renders every section and escapes table cells', () => {
  const run = {
    startedAt: 't', durationMs: 5000, chainId: 61999, rpc: 'r', address: '0xabc', info: { name: 'Triangulate', version: '1', runner: 'x' },
    sourceSha256: '0x1', signers: ['0xs'], waitedForFinality: false, passed: false,
    summary: [{ name: 'a|b', result: 'PASS' }], hardFailures: ['boom'], warnings: ['careful'],
    negatives: [{ label: 'l', execution: 'failed', stateUnchanged: true, message: 'm|n', pass: true }],
    scenarios: [{
      id: 's', title: 'T', statement: 'S', why: 'W', claimId: 'CLM-1', examId: 'EXM-1', verdict: 'ECHO_ONLY', hopedSet: ['ECHO_ONLY'], hoped: true, forbidden: false,
      tallies: { origins: 1 }, structureFailures: [], attestation: '0xa', attestationMatches: true,
      origins: [{ origin_id: 'O1', sources: ['S1', 'S2'], stance: 'SUPPORTS' }], edges: [{ a: 'S1', b: 'S2', kind: 'SAME_ORIGIN' }],
      findings: [{ source_id: 'S1', stance: 'SUPPORTS', excerpt: 'x y z' }],
      sources: [{ sourceId: 'S1', origin: 'o', url: 'https://u', preflight: 'ok', stance: 'SUPPORTS', flag: '', excerptCheck: 'yes' }],
    }],
    transactions: [{ label: 'l', hash: '0x' + 'a'.repeat(64), statusName: 'ACCEPTED', execution: 'success', finality: 'accepted', seconds: 3 }],
    statsBefore: { claims: 0 }, statsAfter: { claims: 1 },
  };
  const text = renderReport(run);
  for (const needle of ['## Result: FAILED', 'Hard failures', 'Warnings', 'Refusal checks', 'Scenario: T', 'Echo edges', 'Excerpts recorded on chain', '## Transactions', 'a\\|b', 'm\\|n']) {
    assert.ok(text.includes(needle), needle);
  }
});
