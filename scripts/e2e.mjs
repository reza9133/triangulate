#!/usr/bin/env node
// Live end-to-end run against a deployed Triangulate contract on GenLayer Studionet.
//
//   node scripts/e2e.mjs                       uses artifacts/deployment.json
//   node scripts/e2e.mjs --address 0x...       a specific deployment
//   node scripts/e2e.mjs --only light-speed    run only some scenarios (comma separated ids)
//   node scripts/e2e.mjs --skip-refusals       skip the refusal proofs
//   node scripts/e2e.mjs --finality            wait for FINALIZED instead of ACCEPTED
//   node scripts/e2e.mjs --no-preflight        do not fetch the scenario pages from this machine
//
// It writes reports/studionet-e2e-<UTC time>.md and .json. The exit code is 1 when a hard check
// fails: a refusal that was not refused, an unchanged-state proof that broke, a structure fact that
// did not hold, a forbidden verdict, a transaction that failed, or an attestation that does not
// recompute. Verdicts a scenario merely hopes for are reported and never enforced.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  CHAIN_ID,
  ROOT,
  RPC_URL,
  fetchPage,
  loadKeys,
  makeClient,
  parseArgs,
  readJson,
  readRaw,
  readText,
  resolveAddress,
  send,
  sendRaw,
  sha256Of,
  sleep,
} from './lib.mjs';
import { checkStructure, excerptOnPage, hasAnyText, htmlToText, judgeVerdict, renderReport } from './report-lib.mjs';

const { flags, values } = parseArgs(process.argv.slice(2));
const startedAtMs = Date.now();
const waitForFinality = flags.has('finality');
const options = waitForFinality ? { waitForFinality: true } : {};
const examineOptions = { ...options, timeoutMs: 30 * 60 * 1000 };
const only = values.only ? new Set(values.only.split(',').map((item) => item.trim())) : null;
const offlineMode = Boolean(process.env.TRIANGULATE_OFFLINE_CHAIN);
const settle = (ms) => sleep(offlineMode ? 1 : ms);
const reportDir = process.env.TRIANGULATE_REPORT_DIR ? path.resolve(process.env.TRIANGULATE_REPORT_DIR) : path.join(ROOT, 'reports');
const retries = Number.isFinite(Number(values.retries)) ? Number(values.retries) : 2;

const run = {
  startedAt: new Date().toISOString(),
  durationMs: 0,
  chainId: CHAIN_ID,
  rpc: RPC_URL,
  address: '',
  info: { name: '', version: '', runner: '' },
  sourceSha256: sha256Of(readText('contracts/triangulate.py')),
  signers: [],
  waitedForFinality: waitForFinality,
  passed: false,
  summary: [],
  hardFailures: [],
  warnings: [],
  negatives: [],
  scenarios: [],
  transactions: [],
  statsBefore: null,
  statsAfter: null,
};

const fail = (message) => {
  run.hardFailures.push(message);
  console.log(`  !! ${message}`);
};
const warn = (message) => {
  run.warnings.push(message);
  console.log(`  ~~ ${message}`);
};
const summarize = (name, result, ok) => {
  run.summary.push({ name, result });
  if (!ok) run.passed = false;
};

let address = '';
let signers = [];

function logTransaction(label, outcome, startedAt) {
  run.transactions.push({
    label,
    hash: outcome.hash ?? null,
    statusName: outcome.statusName ?? '-',
    execution: outcome.execution ?? '-',
    finality: outcome.finality ?? null,
    seconds: Math.round((Date.now() - startedAt) / 1000),
  });
}

/** A write that must succeed. Throws on failure after logging it. */
async function write(signer, functionName, args, label, extra = {}) {
  const started = Date.now();
  try {
    const outcome = await send(signers[signer].client, address, functionName, args, label, { ...options, ...extra });
    logTransaction(label, outcome, started);
    return outcome;
  } catch (error) {
    run.transactions.push({ label, hash: null, statusName: 'FAILED', execution: 'failed', finality: null, seconds: Math.round((Date.now() - started) / 1000) });
    throw error;
  }
}

const read = (functionName, args = []) => readJson(signers[0].client, address, functionName, args);

async function readUntil(functionName, args, predicate, tries = 12) {
  let value = null;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    value = await read(functionName, args);
    if (predicate(value)) return value;
    await settle(3000);
  }
  return value;
}

async function claimIdFor(statement) {
  const first = await read('list_claims', [0, 50]);
  let offset = 0;
  let page = first;
  for (;;) {
    for (const item of page.items) {
      const bundle = await read('get_claim_bundle', [item.claim_id]);
      if (bundle && bundle.claim.statement === statement) return item.claim_id;
    }
    offset += page.items.length;
    if (page.items.length === 0 || offset >= page.total) return null;
    page = await read('list_claims', [offset, 50]);
  }
}

// ----------------------------------------------------------------------------------- refusals

async function snapshot(claimId) {
  const stats = await read('stats');
  const claim = claimId ? await read('get_claim_bundle', [claimId]) : null;
  return JSON.stringify({ stats, claim });
}

function cleanMessage(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

/** A write the contract must refuse. Passes only if the network did not report success AND the state is unchanged. */
async function expectRefused({ label, signer, functionName, args, claimId = null, fragment = '' }) {
  const before = await snapshot(claimId);
  const started = Date.now();
  const outcome = await sendRaw(signers[signer].client, address, functionName, args, label, examineOptions);
  logTransaction(label, outcome, started);
  await settle(2500);
  const after = await snapshot(claimId);
  const stateUnchanged = before === after;
  const reportedSuccess = outcome.execution === 'success' && !outcome.failure;
  const message = cleanMessage(outcome.failure);
  const reasonKnown = message !== '' && !message.startsWith('The contract rejected this transaction') && outcome.execution === 'failed' && !outcome.submitError;
  const wrongReason = reasonKnown && fragment !== '' && !message.toLowerCase().includes(fragment.toLowerCase());
  const pass = stateUnchanged && !reportedSuccess && !wrongReason;
  if (!stateUnchanged || reportedSuccess) fail(`Refusal check failed: ${label} (network: ${outcome.execution}, state unchanged: ${stateUnchanged})`);
  else if (wrongReason) fail(`Refusal check failed: ${label} was refused for the wrong reason. Expected a message containing "${fragment}", got: ${message}`);
  else if (outcome.execution === 'unknown' || !reasonKnown) warn(`${label}: the receipt did not give a readable reason; the refusal is proven by the unchanged state only`);
  run.negatives.push({ label, execution: outcome.execution, stateUnchanged, message, pass });
  return pass;
}

async function refusalSuite() {
  console.log('\n== Refusal proofs');
  const nonce = Math.random().toString(36).slice(2, 8);
  const statement = `Workbench ${nonce}: the Meridian Bridge spans 1,280 metres between its two main towers.`;
  const anchors = JSON.stringify(['Meridian Bridge', ['1,280 metres', '1,280 m']]);

  await write(0, 'open_claim', ['Workbench claim', statement, 'society', anchors], 'workbench: open claim');
  const claimId = await claimIdFor(statement);
  if (!claimId) throw new Error('The workbench claim was not found after opening it.');
  console.log(`     workbench claim ${claimId}`);

  const adds = [
    [0, 'https://example.org/', 'workbench: add example.org (signer 0)'],
    [1, 'https://news.example.org/a', 'workbench: add news.example.org (signer 1)'],
    [0, 'https://www.iana.org/domains/reserved', 'workbench: add iana.org (signer 0)'],
    [0, 'https://www.w3.org/', 'workbench: add w3.org (signer 0)'],
  ];
  for (const [signer, url, label] of adds) await write(signer, 'add_source', [claimId, url], label);
  const bundle = await readUntil('get_claim_bundle', [claimId], (value) => value && value.claim.sources.length === 4);
  const origins = bundle.claim.sources.map((item) => item.origin_key);
  const originsOk = JSON.stringify(origins) === JSON.stringify(['example.org', 'example.org', 'iana.org', 'w3.org']);
  if (!originsOk) fail(`Publisher resolution on chain was ${JSON.stringify(origins)}, expected example.org, example.org, iana.org, w3.org`);
  summarize('Publisher of each workbench source recorded on chain', originsOk ? 'PASS' : 'FAIL', originsOk);

  const cases = [
    { label: 'open a claim with a statement that is already tracked', signer: 1, functionName: 'open_claim', args: ['Copy', statement, 'society', anchors], fragment: 'already tracked' },
    { label: 'open a claim whose anchor is not in its statement', signer: 1, functionName: 'open_claim', args: ['Bad anchor', `Workbench ${nonce}b: the Harbour Tunnel is 4,200 metres long and carries two railway tracks.`, 'society', JSON.stringify(['Eiffel Tower'])], fragment: 'does not occur' },
    { label: 'open a claim with no anchors', signer: 1, functionName: 'open_claim', args: ['No anchors', `Workbench ${nonce}c: the Harbour Tunnel is 4,200 metres long and carries two railway tracks.`, 'society', '[]'], fragment: 'non-empty' },
    { label: 'open a claim with an unsupported topic', signer: 1, functionName: 'open_claim', args: ['Odd topic', `Workbench ${nonce}d: the Harbour Tunnel is 4,200 metres long and carries two railway tracks.`, 'gossip', JSON.stringify(['Harbour Tunnel'])], fragment: 'topic' },
    { label: 'open a claim with a statement that is too short', signer: 1, functionName: 'open_claim', args: ['Too short', 'Too short to check.', 'science', JSON.stringify(['short'])], fragment: 'too short' },
    { label: 'add a URL-shortener source', signer: 1, functionName: 'add_source', args: [claimId, 'https://bit.ly/3abcdef'], claimId, fragment: 'source is on' },
    { label: 'add a web-archive source', signer: 1, functionName: 'add_source', args: [claimId, 'https://web.archive.org/web/2024/https://example.org/'], claimId, fragment: 'source is on' },
    { label: 'add a plain-http source', signer: 1, functionName: 'add_source', args: [claimId, 'http://example.net/'], claimId, fragment: 'https' },
    { label: 'add a localhost source', signer: 1, functionName: 'add_source', args: [claimId, 'https://localhost/admin'], claimId, fragment: 'public DNS' },
    { label: 'add an IP-literal source', signer: 1, functionName: 'add_source', args: [claimId, 'https://127.0.0.1/admin'], claimId, fragment: 'public DNS' },
    { label: 'add a source with embedded credentials', signer: 1, functionName: 'add_source', args: [claimId, 'https://user:secret@example.net/'], claimId, fragment: 'credentials' },
    { label: 'add a source with a fragment', signer: 1, functionName: 'add_source', args: [claimId, 'https://example.net/page#top'], claimId, fragment: 'fragment' },
    { label: 'add another spelling of an existing source', signer: 1, functionName: 'add_source', args: [claimId, 'https://iana.org/domains/reserved/?utm_source=mail'], claimId, fragment: 'already a source' },
    { label: 'add a third source from one publisher', signer: 2, functionName: 'add_source', args: [claimId, 'https://blog.example.org/b'], claimId, fragment: 'maximum number of sources from' },
    { label: 'add a fourth source from one signer', signer: 0, functionName: 'add_source', args: [claimId, 'https://www.rfc-editor.org/'], claimId, fragment: 'you have already added' },
    { label: 'drop a source as a stranger', signer: 1, functionName: 'drop_source', args: [claimId, 'S1'], claimId, fragment: 'only the owner' },
    { label: 'close a claim as a stranger', signer: 1, functionName: 'close_claim', args: [claimId], claimId, fragment: 'only the owner' },
    { label: 'examine a claim that does not exist', signer: 1, functionName: 'examine', args: ['CLM-9999'], fragment: 'unknown claim' },
  ];
  for (const item of cases) await expectRefused(item);

  // A claim with no sources cannot be examined; once closed it can no longer change.
  const second = `Workbench ${nonce}e: the Harbour Tunnel is 4,200 metres long and carries two railway tracks.`;
  await write(0, 'open_claim', ['Empty workbench', second, 'society', JSON.stringify(['Harbour Tunnel', '4,200 metres'])], 'workbench: open second claim');
  const secondId = await claimIdFor(second);
  if (!secondId) throw new Error('The second workbench claim was not found.');
  await expectRefused({ label: 'examine a claim with no sources', signer: 1, functionName: 'examine', args: [secondId], claimId: secondId, fragment: 'at least 2 sources' });
  await write(0, 'close_claim', [secondId], 'workbench: close second claim');
  const closedState = await read('get_claim_bundle', [secondId]);
  if (closedState.claim.status !== 'CLOSED') fail('The second workbench claim did not close.');
  await expectRefused({ label: 'add a source to a closed claim', signer: 0, functionName: 'add_source', args: [secondId, 'https://www.iana.org/'], claimId: secondId, fragment: 'closed' });
  await expectRefused({ label: 'examine a closed claim', signer: 0, functionName: 'examine', args: [secondId], claimId: secondId, fragment: 'closed' });
  await expectRefused({ label: 'close a claim twice', signer: 0, functionName: 'close_claim', args: [secondId], claimId: secondId, fragment: 'closed' });

  const passed = run.negatives.filter((item) => item.pass).length;
  summarize(`Refusal proofs (${run.negatives.length})`, `${passed}/${run.negatives.length} refused with state unchanged`, passed === run.negatives.length);
}

// ------------------------------------------------------------------------------ view checks

async function viewChecks() {
  console.log('\n== Publisher resolution by the contract (views, no transactions)');
  const table = [
    ['https://www.github.com/Alice/notes', 'github:alice'],
    ['https://raw.githubusercontent.com/alice/notes/main/a.md', 'github:alice'],
    ['https://alice.github.io/post', 'github:alice'],
    ['https://news.bbc.co.uk/story', 'bbc.co.uk'],
    ['https://www.ons.gov.uk/x', 'ons.gov.uk'],
    ['https://en.wikipedia.org/wiki/A', 'wikipedia.org'],
    ['https://simple.wikipedia.org/wiki/A', 'wikipedia.org'],
    ['https://spanfan.blogspot.com/post', 'spanfan.blogspot.com'],
    ['https://requests.readthedocs.io/en/latest/', 'requests.readthedocs.io'],
    ['https://medium.com/@writer/post', 'medium:@writer'],
  ];
  const refused = ['https://bit.ly/abc', 'https://archive.ph/abc', 'https://pastebin.com/raw/abc', 'http://example.org/'];
  let good = 0;
  for (const [url, expected] of table) {
    const result = await read('inspect_url', [url]);
    const ok = result.ok === true && result.origin_key === expected;
    if (ok) good += 1;
    else fail(`inspect_url(${url}) gave ${JSON.stringify(result)}, expected origin ${expected}`);
  }
  for (const url of refused) {
    const result = await read('inspect_url', [url]);
    if (result.ok === false) good += 1;
    else fail(`inspect_url(${url}) should have been refused`);
  }
  const total = table.length + refused.length;
  summarize(`Publisher resolution views (${total})`, `${good}/${total} as expected`, good === total);
}

// ------------------------------------------------------------------------------- scenarios

function pageText(fetched) {
  return fetched && fetched.status >= 200 && fetched.status < 300 ? htmlToText(fetched.body) : '';
}

async function runScenario(scenario) {
  console.log(`\n== Scenario ${scenario.id}: ${scenario.title}`);
  const record = {
    id: scenario.id,
    title: scenario.title,
    statement: scenario.statement,
    why: scenario.why,
    claimId: null,
    examId: null,
    verdict: null,
    hopedSet: scenario.expect_any ?? (scenario.expect ? [scenario.expect] : []),
    hoped: null,
    forbidden: false,
    tallies: null,
    origins: null,
    edges: null,
    findings: null,
    attestation: null,
    attestationMatches: null,
    structureFailures: [],
    sources: scenario.sources.map((item) => ({ url: item.url, sourceId: null, origin: null, preflight: 'skipped', stance: null, flag: '', excerptCheck: 'not checked' })),
  };
  run.scenarios.push(record);

  // Preflight: what does each page look like from this machine?
  const pages = [];
  for (let index = 0; index < scenario.sources.length; index += 1) {
    const entry = scenario.sources[index];
    if (flags.has('no-preflight')) {
      pages.push('');
      continue;
    }
    const fetched = await fetchPage(entry.url);
    const text = pageText(fetched);
    pages.push(text);
    const expected = hasAnyText(text, entry.expect_text);
    if (fetched.status === 0) record.sources[index].preflight = `unreachable (${cleanMessage(fetched.error)})`;
    else if (fetched.status >= 400) record.sources[index].preflight = `HTTP ${fetched.status}`;
    else if (expected === null) record.sources[index].preflight = `HTTP ${fetched.status}`;
    else record.sources[index].preflight = expected ? `HTTP ${fetched.status}, expected text present` : `HTTP ${fetched.status}, expected text NOT found`;
    if (expected === false) warn(`${scenario.id}: ${entry.url} does not show the expected text from this machine; the verdict may differ from what is hoped`);
    if (entry.expect_text && entry.expect_text.length > 0 && fetched.status !== 0 && fetched.status >= 400) warn(`${scenario.id}: ${entry.url} answered HTTP ${fetched.status} from this machine`);
  }

  const existing = await claimIdFor(scenario.statement);
  if (existing) {
    warn(`${scenario.id}: this statement is already tracked as ${existing} on this deployment, so the scenario was skipped. Deploy a fresh contract (bash run.sh deploy) for a clean run.`);
    record.claimId = existing;
    record.skipped = true;
    summarize(`Scenario ${scenario.id}`, `skipped (already tracked as ${existing})`, true);
    return;
  }

  try {
    await write(0, 'open_claim', [scenario.title, scenario.statement, scenario.topic, JSON.stringify(scenario.anchors)], `${scenario.id}: open claim`);
    const claimId = await claimIdFor(scenario.statement);
    if (!claimId) throw new Error('claim not found after opening it');
    record.claimId = claimId;
    for (let index = 0; index < scenario.sources.length; index += 1) {
      const entry = scenario.sources[index];
      await write(entry.signer ?? 0, 'add_source', [claimId, entry.url], `${scenario.id}: add source ${index + 1}`);
    }
    const bundle = await readUntil('get_claim_bundle', [claimId], (value) => value && value.claim.sources.length === scenario.sources.length);
    bundle.claim.sources.forEach((source, index) => {
      record.sources[index].sourceId = source.source_id;
      record.sources[index].origin = source.origin_key;
    });

    let outcome = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        outcome = await write(0, 'examine', [claimId], `${scenario.id}: examine${attempt > 0 ? ` (retry ${attempt})` : ''}`, examineOptions);
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // The chain is the source of truth. If the examination was recorded, a receipt that looked
        // like a failure was misread; carry on and say so.
        const check = await read('get_claim_bundle', [claimId]);
        if (check && check.claim.exam_ids.length > 0) {
          warn(`${scenario.id}: the receipt looked like a failure (${cleanMessage(message)}) but the examination is recorded on chain, so the run continues`);
          outcome = { recovered: true };
          break;
        }
        if (attempt < retries && /did not reach agreement|undetermined|timeout/i.test(message)) {
          warn(`${scenario.id}: the validators did not agree on attempt ${attempt + 1}; retrying`);
          await settle(15000);
          continue;
        }
        throw error;
      }
    }
    if (!outcome) throw new Error('no examination outcome');

    const after = await readUntil('get_claim_bundle', [claimId], (value) => value && value.claim.exam_ids.length >= 1);
    const examId = after.claim.last_exam_id;
    record.examId = examId;
    const exam = (await read('get_examination_bundle', [examId])).examination;
    record.verdict = exam.verdict;
    record.tallies = exam.tallies;
    record.origins = exam.origins;
    record.edges = exam.edges;
    record.findings = exam.findings;
    record.attestation = exam.attestation;

    record.attestationMatches = (await readRaw(signers[0].client, address, 'recompute_attestation', [examId])) === exam.attestation;
    if (!record.attestationMatches) fail(`${scenario.id}: the attestation does not recompute from stored state`);

    exam.findings.forEach((finding, index) => {
      const slot = record.sources[index];
      slot.stance = finding.stance;
      slot.flag = finding.flag;
      if (finding.excerpt) {
        if (!pages[index]) slot.excerptCheck = 'no client copy';
        else if (excerptOnPage(finding.excerpt, pages[index])) slot.excerptCheck = 'yes';
        else {
          slot.excerptCheck = 'NOT FOUND';
          warn(`${scenario.id}: the excerpt for ${finding.source_id} was not found in the copy fetched from this machine`);
        }
      } else slot.excerptCheck = '-';
    });

    record.structureFailures = checkStructure(scenario.structure, exam.tallies);
    for (const failure of record.structureFailures) fail(`${scenario.id}: structure fact broken - ${failure}`);
    const judged = judgeVerdict(scenario, exam.verdict);
    record.hoped = judged.hoped;
    record.forbidden = judged.forbidden;
    if (judged.forbidden) fail(`${scenario.id}: forbidden verdict ${exam.verdict}`);
    if (judged.hoped === false) warn(`${scenario.id}: verdict ${exam.verdict} differs from the hoped ${JSON.stringify(record.hopedSet)} (reported, not enforced)`);

    const okay = record.structureFailures.length === 0 && !judged.forbidden && record.attestationMatches;
    summarize(`Scenario ${scenario.id}`, `${exam.verdict}${judged.hoped === false ? ' (differs from hoped)' : ''}`, okay);
    console.log(`     verdict ${exam.verdict}; origins ${exam.tallies.origins}, echoes ${exam.tallies.echoes}, unresolved ${exam.tallies.unresolved_origins}`);
    exam.findings.forEach((finding) => {
      const detail = finding.flag ? ` [${finding.flag}]` : '';
      const quote = finding.excerpt ? ` "${finding.excerpt.slice(0, 90)}"` : '';
      console.log(`       ${finding.source_id} ${finding.stance}${detail} (${finding.origin_key})${quote}`);
      if (finding.claimed) console.log(`           model quoted : "${finding.claimed}"`);
      if (finding.seen) console.log(`           validator saw: "${finding.seen}"`);
    });
    record.conclusive = exam.conclusive;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`${scenario.id}: ${message}`);
    summarize(`Scenario ${scenario.id}`, `FAILED - ${cleanMessage(message)}`, false);
  }
}

async function cooldownCheck() {
  const done = run.scenarios.find((item) => item.claimId && item.examId && item.conclusive && !item.skipped);
  if (!done) {
    warn('No scenario reached a conclusive verdict, so the re-examination cooldown could not be checked.');
    return;
  }
  console.log('\n== Re-examination cooldown');
  const ok = await expectRefused({ label: `examine ${done.claimId} again straight away`, signer: 0, functionName: 'examine', args: [done.claimId], claimId: done.claimId, fragment: 'examined recently' });
  summarize('Re-examination cooldown refuses an immediate repeat', ok ? 'PASS' : 'FAIL', ok);
}

// ------------------------------------------------------------------------------------ main

async function main() {
  run.passed = true;
  address = resolveAddress(values);
  const keys = loadKeys(3);
  signers = keys.map((key) => makeClient(key));
  run.address = address;
  run.signers = signers.map((item) => item.account.address);

  console.log('Triangulate live end-to-end run');
  console.log(`  network   Studionet (chain ${CHAIN_ID})`);
  console.log(`  rpc       ${RPC_URL}`);
  console.log(`  contract  ${address}`);
  signers.forEach((item, index) => console.log(`  signer ${index}  ${item.account.address}`));

  run.info = await read('contract_info');
  if (run.info.name !== 'Triangulate') throw new Error(`The contract at ${address} is "${run.info.name}", not Triangulate.`);
  run.statsBefore = await read('stats');
  summarize('Contract reachable and identified', `${run.info.name} ${run.info.version}`, true);
  console.log(`  version   ${run.info.version}, runner ${run.info.runner}`);

  await viewChecks();
  if (!flags.has('skip-refusals')) await refusalSuite();

  const scenarios = JSON.parse(readFileSync(path.join(ROOT, 'scenarios', 'scenarios.json'), 'utf8')).scenarios;
  for (const scenario of scenarios) {
    if (only && !only.has(scenario.id)) continue;
    await runScenario(scenario);
  }
  if (!flags.has('skip-refusals')) await cooldownCheck();

  run.statsAfter = await read('stats');
}

async function finish() {
  run.durationMs = Date.now() - startedAtMs;
  if (run.hardFailures.length > 0) run.passed = false;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z';
  mkdirSync(reportDir, { recursive: true });
  const base = path.join(reportDir, `studionet-e2e-${stamp}`);
  writeFileSync(`${base}.json`, JSON.stringify(run, null, 2) + '\n');
  writeFileSync(`${base}.md`, renderReport(run));
  console.log(`\n${run.passed ? 'PASSED' : 'FAILED'}  (${run.hardFailures.length} hard failures, ${run.warnings.length} warnings)`);
  console.log(`Report: ${path.relative(ROOT, base)}.md`);
  process.exit(run.passed ? 0 : 1);
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    run.hardFailures.push(`The run stopped early: ${message}`);
    run.passed = false;
    console.error(`\n${message}`);
    if (!run.info.name) run.info = { name: 'unknown', version: '-', runner: '-' };
  })
  .finally(finish);
