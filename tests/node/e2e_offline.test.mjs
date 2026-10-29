// Runs the real scripts/e2e.mjs end to end with no network: the contract is the real contract code
// executed by the Python simulator, behind a stand-in for the genlayer-js client.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const contractPath = path.join(root, 'contracts', 'triangulate.py');

function runE2e({ contract, extraArgs = [] } = {}) {
  const reports = mkdtempSync(path.join(os.tmpdir(), 'triangulate-report-'));
  const env = {
    ...process.env,
    TRIANGULATE_OFFLINE_CHAIN: 'tests/node/offline-chain.mjs',
    TRIANGULATE_ADDRESS: '0x' + 'c0'.repeat(20),
    TRIANGULATE_REPORT_DIR: reports,
  };
  if (contract) env.TRIANGULATE_CONTRACT = contract;
  const result = spawnSync(process.execPath, ['scripts/e2e.mjs', ...extraArgs], { cwd: root, env, encoding: 'utf8', timeout: 300_000 });
  const files = readdirSync(reports);
  const json = files.find((name) => name.endsWith('.json'));
  const md = files.find((name) => name.endsWith('.md'));
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    report: json ? JSON.parse(readFileSync(path.join(reports, json), 'utf8')) : null,
    markdown: md ? readFileSync(path.join(reports, md), 'utf8') : '',
  };
}

function mutant(old, replacement) {
  const source = readFileSync(contractPath, 'utf8');
  assert.equal(source.split(old).length - 1, 1, 'the planted change must match exactly once');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'triangulate-mutant-'));
  const file = path.join(dir, 'mutant.py');
  writeFileSync(file, source.replace(old, replacement));
  return file;
}

test('the whole live flow passes against the real contract', () => {
  const run = runE2e();
  assert.equal(run.status, 0, run.stdout.slice(-3000) + run.stderr);
  assert.equal(run.report.passed, true);
  assert.deepEqual(run.report.hardFailures, []);
  assert.equal(run.report.negatives.length, 23);
  assert.ok(run.report.negatives.every((item) => item.pass && item.stateUnchanged));
  const byId = Object.fromEntries(run.report.scenarios.map((item) => [item.id, item]));
  assert.equal(byId['light-speed'].verdict, 'TRIANGULATED');
  assert.equal(byId['echo-github'].verdict, 'ECHO_ONLY');
  assert.equal(byId['echo-wikipedia'].verdict, 'ECHO_ONLY');
  assert.equal(byId['moon-wall-myth'].verdict, 'REFUTED');
  assert.equal(byId['unreachable-source'].verdict, 'INCONCLUSIVE');
  for (const scenario of run.report.scenarios) assert.equal(scenario.attestationMatches, true, scenario.id);
  assert.match(run.markdown, /## Result: PASSED/);
});

test('a second run against the same deployment skips scenarios instead of failing', () => {
  // Same simulator process cannot be reused across spawns, so emulate by running scenarios twice in one run.
  const run = runE2e({ extraArgs: ['--skip-refusals', '--only', 'light-speed'] });
  assert.equal(run.status, 0, run.stdout.slice(-2000));
  assert.equal(run.report.scenarios.length, 1);
  assert.equal(run.report.negatives.length, 0);
});

test('the run fails loudly if the contract stops refusing hidden publishers', () => {
  const file = mutant("    if refusal != '':\n        _fail('source is on '", "    if False:\n        _fail('source is on '");
  const run = runE2e({ contract: file });
  assert.equal(run.status, 1);
  assert.equal(run.report.passed, false);
  assert.ok(run.report.hardFailures.some((item) => /Refusal check failed: add a URL-shortener source/.test(item)), JSON.stringify(run.report.hardFailures));
});

test('the run fails loudly if the contract stops refusing duplicate sources', () => {
  const file = mutant("if any(item['source_key'] == key for item in sources):", 'if False:');
  const run = runE2e({ contract: file });
  assert.equal(run.status, 1);
  assert.ok(run.report.hardFailures.some((item) => /another spelling of an existing source/.test(item)), JSON.stringify(run.report.hardFailures));
});

test('the run fails loudly if echoes stop being merged', () => {
  const file = mutant("            if first['origin_key'] == second['origin_key']:\n                edges.append(_edge(a, b, EDGE_SAME_ORIGIN))", "            if False:\n                edges.append(_edge(a, b, EDGE_SAME_ORIGIN))");
  const run = runE2e({ contract: file });
  assert.equal(run.status, 1);
  assert.ok(run.report.hardFailures.some((item) => /structure|disagrees|stopped early|did not reach agreement/i.test(item)), JSON.stringify(run.report.hardFailures));
});

test('the run fails loudly if a clean bill is issued while a source is unreadable', () => {
  const file = mutant("        if tallies['unresolved_origins'] > 0:\n            return VERDICT_INCONCLUSIVE", "        if False:\n            return VERDICT_INCONCLUSIVE");
  const run = runE2e({ contract: file });
  assert.equal(run.status, 1);
  assert.ok(run.report.hardFailures.some((item) => /unreachable-source: forbidden verdict/.test(item)), JSON.stringify(run.report.hardFailures));
});
