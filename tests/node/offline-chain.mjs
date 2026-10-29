// An offline stand-in for the genlayer-js client, used only by the self-test. Writes are executed
// by the real contract code on the Python simulator (tests/bridge.py) and are reported back in the
// same receipt shape the scripts parse from Studionet.

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const testsDir = path.resolve(here, '..');

let child = null;
let buffer = '';
let nextId = 1;
const waiting = new Map();

function ensure() {
  if (child) return;
  child = spawn(process.env.PYTHON || 'python3', ['bridge.py'], { cwd: testsDir, stdio: ['pipe', 'pipe', 'inherit'], env: process.env });
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (!line.trim()) continue;
      const reply = JSON.parse(line);
      const resolve = waiting.get(reply.id);
      waiting.delete(reply.id);
      if (resolve) resolve(reply);
    }
  });
  child.on('exit', () => {
    for (const resolve of waiting.values()) resolve({ ok: false, kind: 'crash', message: 'bridge exited' });
    waiting.clear();
  });
  process.on('exit', () => child && child.kill());
}

function call(message) {
  ensure();
  return new Promise((resolve) => {
    const id = nextId++;
    waiting.set(id, resolve);
    child.stdin.write(JSON.stringify({ id, ...message }) + '\n');
  });
}

const plain = (value) => (typeof value === 'bigint' ? Number(value) : value);

function receipt(reply) {
  if (reply.ok) {
    return { statusName: 'FINALIZED', consensus_data: { leader_receipt: [{ execution_result: 'SUCCESS' }] }, data: {} };
  }
  if (reply.kind === 'user') {
    return {
      statusName: 'ACCEPTED',
      consensus_data: { leader_receipt: [{ execution_result: 'ERROR', genvm_result: { stderr: `UserError: ${reply.message}` } }] },
    };
  }
  if (reply.kind === 'noconsensus') return { statusName: 'UNDETERMINED', consensus_data: {} };
  throw new Error(`contract crashed in the simulator: ${reply.message}`);
}

export function makeClient(key) {
  const address = '0x' + createHash('sha256').update(key).digest('hex').slice(0, 40);
  const transactions = new Map();
  const client = {
    async deployContract() {
      const hash = '0x' + randomBytes(32).toString('hex');
      transactions.set(hash, { statusName: 'FINALIZED', consensus_data: { leader_receipt: [{ execution_result: 'SUCCESS' }] }, data: { contract_address: '0x' + 'c0'.repeat(20) } });
      return hash;
    },
    async writeContract({ functionName, args }) {
      const reply = await call({ op: 'write', method: functionName, args: args.map(plain), sender: address });
      const hash = '0x' + randomBytes(32).toString('hex');
      transactions.set(hash, receipt(reply));
      return hash;
    },
    async getTransaction({ hash }) {
      return transactions.get(hash);
    },
    async readContract({ functionName, args }) {
      const reply = await call({ op: 'read', method: functionName, args: (args ?? []).map(plain) });
      if (!reply.ok) throw new Error(reply.message);
      return reply.result;
    },
  };
  return { client, account: { address } };
}

export async function fetchPage(url) {
  const reply = await call({ op: 'page', url });
  return { status: reply.result.status, body: reply.result.body, error: null };
}
