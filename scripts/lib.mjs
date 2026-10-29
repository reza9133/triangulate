// Shared helpers for the deploy and end-to-end scripts. Targets GenLayer Studionet with
// genlayer-js 1.x. Studionet is gasless, so no fee parameters are needed.

import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { abi, createAccount, createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';

import { FAILED, describeUndecided, executionOf, isDecision, isTransientRpcError, phaseOf, settledAs, statusNameOf } from './receipt.mjs';

export { parseArgs } from './args.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const RPC_URL = (process.env.TRIANGULATE_RPC || 'https://studio.genlayer.com/api').trim();
export const CHAIN_ID = 61999;

const CURVE_ORDER = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function sha256Of(text) {
  return '0x' + createHash('sha256').update(text).digest('hex');
}

export function readText(relative) {
  return readFileSync(path.join(ROOT, relative), 'utf8');
}

function freshKey() {
  for (;;) {
    const hex = randomBytes(32).toString('hex');
    const value = BigInt('0x' + hex);
    if (value > 0n && value < CURVE_ORDER) return '0x' + hex;
  }
}

function checkedKey(text, name) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(text)) throw new Error(`${name} must be 0x followed by 64 hex characters.`);
  return text;
}

/** The key from TRIANGULATE_PRIVATE_KEY, or a fresh throwaway key. Studionet accounts need no funds. */
export function loadKey() {
  const supplied = (process.env.TRIANGULATE_PRIVATE_KEY || '').trim();
  if (supplied) return { key: checkedKey(supplied, 'TRIANGULATE_PRIVATE_KEY'), generated: false };
  return { key: freshKey(), generated: true };
}

/**
 * Several distinct signers for scenarios that need more than one account (source quotas are per
 * account). The first is TRIANGULATE_PRIVATE_KEY when set; the rest come from the comma-separated
 * TRIANGULATE_PRIVATE_KEYS or are generated. Studionet accounts need no funds.
 */
export function loadKeys(count) {
  const keys = [];
  const first = loadKey();
  keys.push(first.key);
  const extra = (process.env.TRIANGULATE_PRIVATE_KEYS || '').split(',').map((item) => item.trim()).filter((item) => item.length > 0);
  for (const item of extra) keys.push(checkedKey(item, 'TRIANGULATE_PRIVATE_KEYS'));
  while (keys.length < count) keys.push(freshKey());
  return keys.slice(0, count);
}

// Offline self-test hook. When TRIANGULATE_OFFLINE_CHAIN names a module, the scripts talk to that
// module instead of Studionet and the open internet. tests/node uses it to run the whole
// end-to-end flow against the real contract code executed by the Python simulator. Production
// runs never set it.
const offline = process.env.TRIANGULATE_OFFLINE_CHAIN ? await import(pathToFileURL(path.resolve(process.env.TRIANGULATE_OFFLINE_CHAIN)).href) : null;

function chainConfig() {
  return { ...studionet, rpcUrls: { ...(studionet.rpcUrls ?? {}), default: { http: [RPC_URL] } } };
}

export function makeClient(key) {
  if (offline) return offline.makeClient(key);
  const account = key ? createAccount(key) : undefined;
  return { client: createClient({ chain: chainConfig(), endpoint: RPC_URL, account }), account };
}

/**
 * Poll until the validators have decided the transaction (ACCEPTED, FINALIZED or a failure state).
 * Returns { transaction, statusName, execution, finality, failure }.
 *
 *   ok           = finality !== null && failure === null
 *   finality     = 'accepted' (can still be appealed) | 'finalized' (cannot change) | null
 *   execution    = 'success' | 'failed' | 'unknown', read from the transaction itself
 *
 * A decided transaction counts as completed only with an explicit successful execution result.
 * With waitForFinality the call keeps polling an ACCEPTED transaction until it is FINALIZED or
 * the finality timeout passes (the result then stays 'accepted').
 */
export async function waitForDecision(
  client,
  hash,
  { timeoutMs = 10 * 60 * 1000, intervalMs = 3000, onStatus, waitForFinality = false, finalityTimeoutMs = 45 * 60 * 1000, errorToleranceMs = 90_000 } = {},
) {
  const started = Date.now();
  let last = null;
  let lastStatus = 'PENDING';
  let reported = '';
  let rereads = 0;
  let failingSince = null;
  for (;;) {
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${hash}.`);
    try {
      last = await client.getTransaction({ hash });
      failingSince = null;
      lastStatus = statusNameOf(last);
      if (onStatus && lastStatus !== reported) {
        reported = lastStatus;
        onStatus(lastStatus);
      }
      const phase = phaseOf(lastStatus);
      if (isDecision(phase)) {
        // The status can move before the execution result is attached. Read again instead of guessing.
        if (phase !== 'failed' && executionOf(last).state === 'unknown' && rereads < 10) rereads += 1;
        else break;
      }
    } catch (error) {
      // One bad answer from the endpoint (an HTML error page, a dropped connection) must not end a wait
      // that has been going on for minutes. Give up only when polling keeps failing.
      if (failingSince === null) failingSince = Date.now();
      if (Date.now() - failingSince > errorToleranceMs) throw error;
    }
    await sleep(intervalMs);
  }

  const result = describeDecision(last, lastStatus);
  if (waitForFinality && result.finality === 'accepted') {
    const finalityStarted = Date.now();
    while (Date.now() - finalityStarted < finalityTimeoutMs) {
      await sleep(Math.max(intervalMs, 10_000));
      try {
        const again = await client.getTransaction({ hash });
        const status = statusNameOf(again);
        if (onStatus && status !== reported) {
          reported = status;
          onStatus(status);
        }
        if (phaseOf(status) === 'finalized' || phaseOf(status) === 'failed') return describeDecision(again, status);
      } catch {
        // a missed poll changes nothing
      }
    }
  }
  return result;
}

/** Pure: what a decided (or failed) transaction object means. Exported for tests. */
export function describeDecision(transaction, statusName) {
  const phase = phaseOf(statusName);
  if (phase === 'failed' || !isDecision(phase)) {
    return {
      transaction,
      statusName,
      execution: 'unknown',
      finality: null,
      failure: `The validators did not reach agreement (${statusName.toLowerCase().replace(/_/g, ' ')}). Nothing was written.`,
    };
  }
  const execution = executionOf(transaction);
  const finality = settledAs(statusName, execution);
  let failure = null;
  if (execution.state === 'failed') failure = execution.message;
  else if (execution.state === 'unknown') failure = 'The network decided this transaction, but its execution result could not be read, so it is not treated as completed.';
  return { transaction, statusName, execution: execution.state, finality, failure };
}

/** Read a view method that returns JSON text. Retries transient errors. */
export async function readJson(client, address, functionName, args = []) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const raw = await client.readContract({
        address,
        functionName,
        args: args.map((value) => (typeof value === 'number' ? BigInt(value) : value)),
      });
      return JSON.parse(String(raw));
    } catch (error) {
      lastError = error;
      await sleep(800 * attempt);
    }
  }
  throw new Error(`Could not read ${functionName}: ${lastError instanceof Error ? lastError.message : lastError}`);
}

/** Read a view method that returns plain text. Retries transient errors. */
export async function readRaw(client, address, functionName, args = []) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const raw = await client.readContract({
        address,
        functionName,
        args: args.map((value) => (typeof value === 'number' ? BigInt(value) : value)),
      });
      return String(raw);
    } catch (error) {
      lastError = error;
      await sleep(800 * attempt);
    }
  }
  throw new Error(`Could not read ${functionName}: ${lastError instanceof Error ? lastError.message : lastError}`);
}

/**
 * Submit a write. When the RPC endpoint answers with an error page or drops the request before the
 * transaction was sent, ask again a few times instead of failing the whole run on one bad answer.
 */
async function submit(client, address, functionName, args) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return String(
        await client.writeContract({
          address,
          functionName,
          args: args.map((value) => (typeof value === 'number' ? BigInt(value) : value)),
          value: 0n,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= 5 || !isTransientRpcError(message)) throw error;
      console.log(`     the RPC endpoint failed before the transaction was sent (${message.split('\n')[0].slice(0, 100)}); asking again (${attempt}/4)`);
      await sleep(3000 * attempt);
    }
  }
}

/**
 * Keep the raw transaction of a decision the validators could not reach (for example UNDETERMINED), so the
 * reason can be read afterwards. Returns the path relative to the project, or '' when it could not be written.
 */
/** Decode one stored output (base64 of GenLayer calldata) into a plain value; null when it is not that. */
export function decodeStoredOutput(raw) {
  if (typeof raw !== 'string' || raw === '') return null;
  return abi.calldata.decode(Buffer.from(raw, 'base64'));
}

export function saveTransactionDump(label, hash, statusName, transaction) {
  try {
    mkdirSync(path.join(ROOT, 'artifacts'), { recursive: true });
    const relative = `artifacts/undecided-${String(hash).slice(2, 10)}.json`;
    const text = JSON.stringify({ label, hash, statusName, transaction }, (_key, item) => (typeof item === 'bigint' ? item.toString() : item), 2);
    writeFileSync(path.join(ROOT, relative), text);
    return relative;
  } catch {
    return '';
  }
}

export async function send(client, address, functionName, args, label, options = {}) {
  console.log(`  -> ${label}`);
  const hash = await submit(client, address, functionName, args);
  console.log(`     submitted ${hash}`);
  const outcome = await waitForDecision(client, hash, { onStatus: (name) => console.log(`     status: ${name}`), ...options });
  if (outcome.failure) {
    const saved = FAILED.has(outcome.statusName) ? saveTransactionDump(label, hash, outcome.statusName, outcome.transaction) : '';
    if (saved) console.log(`     raw transaction saved to ${saved}`);
    if (FAILED.has(outcome.statusName)) {
      for (const line of describeUndecided(outcome.transaction, decodeStoredOutput)) console.log(`       ${line}`);
    }
    throw new Error(`${label} failed: ${outcome.failure}${saved ? ` (raw transaction: ${saved})` : ''}`);
  }
  console.log(`     decision ${outcome.statusName}, execution ${outcome.execution}, ${outcome.finality === 'finalized' ? 'FINALIZED' : 'accepted, not final yet'}`);
  return { hash, ...outcome };
}

/**
 * Submit a write and wait for the decision WITHOUT throwing when the contract refuses it. Used to prove
 * refusals: the result says what the network decided, and the caller then checks the state itself.
 * Returns { hash, submitError, ...decision }.
 */
export async function sendRaw(client, address, functionName, args, label, options = {}) {
  console.log(`  -> ${label}`);
  let hash;
  try {
    hash = await submit(client, address, functionName, args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`     rejected at submission: ${message.split('\n')[0].slice(0, 160)}`);
    return { hash: null, submitError: message, transaction: null, statusName: 'REJECTED', execution: 'failed', finality: null, failure: message };
  }
  console.log(`     submitted ${hash}`);
  try {
    const outcome = await waitForDecision(client, hash, { onStatus: (name) => console.log(`     status: ${name}`), ...options });
    console.log(`     decision ${outcome.statusName}, execution ${outcome.execution}${outcome.failure ? `, refused: ${outcome.failure.slice(0, 120)}` : ''}`);
    return { hash, submitError: null, ...outcome };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`     no decision: ${message}`);
    return { hash, submitError: null, transaction: null, statusName: 'UNKNOWN', execution: 'unknown', finality: null, failure: message };
  }
}

/** Contract address from --address, TRIANGULATE_ADDRESS or artifacts/deployment.json. */
export function resolveAddress(values) {
  const supplied = (values.address || process.env.TRIANGULATE_ADDRESS || '').trim();
  let address = supplied;
  if (!address) {
    try {
      address = JSON.parse(readText('artifacts/deployment.json')).address;
    } catch {
      address = '';
    }
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error('No contract address. Deploy first (bash run.sh deploy), or pass --address 0x... or set TRIANGULATE_ADDRESS.');
  }
  return address;
}

/**
 * Fetch a public page the way a reader would, for the client-side preflight and excerpt checks.
 * Never throws: returns { status, body, error }.
 */
export async function fetchPage(url, timeoutMs = 25_000) {
  if (offline) return offline.fetchPage(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; TriangulateE2E/1.0)', accept: 'text/html,text/plain;q=0.9,*/*;q=0.5' },
    });
    const body = (await response.text()).slice(0, 2_000_000);
    return { status: response.status, body, error: null };
  } catch (error) {
    return { status: 0, body: '', error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}
