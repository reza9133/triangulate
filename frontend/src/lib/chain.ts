import { createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';

import { CHAIN_ID_HEX, CONTRACT_ADDRESS, RPC_URL } from './config';
import {
  describeDecision,
  isDecision,
  isTransientRpcError,
  phaseOf,
  statusNameOf,
  type Decision,
} from './receipt';
import type { EIP1193Provider } from '../wallet/eip6963';

const chain = { ...studionet, rpcUrls: { ...(studionet.rpcUrls ?? {}), default: { http: [RPC_URL] } } };

type ReadClient = ReturnType<typeof createClient>;

let readClient: ReadClient | null = null;

/** Read-only client. It never touches a wallet: views go straight to the Studionet RPC endpoint. */
export function getReadClient(): ReadClient {
  if (readClient === null) readClient = createClient({ chain, endpoint: RPC_URL });
  return readClient;
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type Arg = string | number | bigint | boolean;
const toArg = (value: Arg): string | bigint | boolean => (typeof value === 'number' ? BigInt(value) : value);

/** Read a view that returns text. Retries transient errors a few times. */
export async function readRaw(functionName: string, args: Arg[] = [], signal?: AbortSignal): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      const raw = await getReadClient().readContract({
        address: CONTRACT_ADDRESS,
        functionName,
        args: args.map(toArg),
      });
      return String(raw);
    } catch (error) {
      lastError = error;
      await sleep(600 * attempt);
    }
  }
  const raw = lastError instanceof Error ? lastError.message : String(lastError);
  const message = raw.split('Version:')[0]?.replace(/\s+/g, ' ').trim() || raw;
  throw new Error(`Could not read ${functionName}: ${message}`);
}

/** Read a view that returns JSON text and parse it. */
export async function readJson<T>(functionName: string, args: Arg[] = [], signal?: AbortSignal): Promise<T> {
  const text = await readRaw(functionName, args, signal);
  return JSON.parse(text) as T;
}

export type TxStatusHandler = (statusName: string) => void;

export interface TxResult extends Decision {
  hash: string;
  transaction: unknown;
}

export class TxError extends Error {
  hash: string | null;
  constructor(message: string, hash: string | null) {
    super(message);
    this.name = 'TxError';
    this.hash = hash;
  }
}

/** Plain-language text for a failure thrown by a wallet or the network. */
export function describeError(error: unknown): string {
  if (error && typeof error === 'object') {
    const record = error as { code?: unknown; message?: unknown; shortMessage?: unknown; cause?: unknown };
    if (record.code === 4001 || record.code === 'ACTION_REJECTED')
      return 'You rejected the request in your wallet.';
    if (record.code === -32002)
      return 'Your wallet already has a pending request. Open it and respond first.';
    if (record.code === 4902) return 'Your wallet does not know the GenLayer Studionet network yet.';
    const text =
      typeof record.shortMessage === 'string'
        ? record.shortMessage
        : typeof record.message === 'string'
          ? record.message
          : '';
    if (/user rejected|user denied|rejected the request/i.test(text))
      return 'You rejected the request in your wallet.';
    if (text) return text.split('\n')[0]?.slice(0, 300) ?? text;
    if (record.cause) return describeError(record.cause);
  }
  return typeof error === 'string' ? error : 'Something went wrong.';
}

/** Poll until the validators decided the transaction (ACCEPTED, FINALIZED or a failure state). */
export async function waitForDecision(
  hash: string,
  {
    timeoutMs = 20 * 60 * 1000,
    intervalMs = 3000,
    onStatus,
    signal,
  }: { timeoutMs?: number; intervalMs?: number; onStatus?: TxStatusHandler; signal?: AbortSignal } = {},
): Promise<TxResult> {
  const started = Date.now();
  let reported = '';
  let rereads = 0;
  let failingSince: number | null = null;
  for (;;) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (Date.now() - started > timeoutMs) {
      throw new TxError(
        'Timed out waiting for the validators. The transaction may still complete; check the explorer.',
        hash,
      );
    }
    try {
      const tx = await getReadClient().getTransaction({ hash: hash as never });
      failingSince = null;
      const status = statusNameOf(tx);
      if (status !== reported) {
        reported = status;
        onStatus?.(status);
      }
      const phase = phaseOf(status);
      if (isDecision(phase)) {
        // The status can move before the execution result is attached; read again a few times.
        if (phase !== 'failed' && describeDecision(tx, status).execution === 'unknown' && rereads < 10) {
          rereads += 1;
        } else {
          return { hash, transaction: tx, ...describeDecision(tx, status) };
        }
      }
    } catch (error) {
      if (error instanceof TxError) throw error;
      if (failingSince === null) failingSince = Date.now();
      if (Date.now() - failingSince > 90_000) throw error;
    }
    await sleep(intervalMs);
  }
}

/**
 * Send a write call through the connected wallet. The wallet signs and submits; the result is read back
 * from the network. Resolves only for a transaction that was decided AND executed successfully.
 */
export async function sendWrite(
  provider: EIP1193Provider,
  account: string,
  functionName: string,
  args: Arg[],
  {
    onSubmitted,
    onStatus,
    signal,
  }: { onSubmitted?: (hash: string) => void; onStatus?: TxStatusHandler; signal?: AbortSignal } = {},
): Promise<TxResult> {
  // Studionet transactions are signed by the wallet, so it must be on the Studionet chain id.
  const current = await provider.request({ method: 'eth_chainId' });
  if (typeof current === 'string' && current.toLowerCase() !== CHAIN_ID_HEX) {
    throw new TxError('Your wallet is not on GenLayer Studionet. Switch network and try again.', null);
  }

  const writer = createClient({ chain, endpoint: RPC_URL, account: account as `0x${string}`, provider });
  let hash: string | null = null;
  for (let attempt = 1; ; attempt += 1) {
    try {
      hash = String(
        await writer.writeContract({
          address: CONTRACT_ADDRESS,
          functionName,
          args: args.map(toArg),
          value: 0n,
        }),
      );
      break;
    } catch (error) {
      const message = describeError(error);
      // Never resubmit when the wallet call itself failed: it may have reached the network.
      if (attempt >= 3 || !isTransientRpcError(message)) throw new TxError(message, null);
      await sleep(2000 * attempt);
    }
  }
  onSubmitted?.(hash);
  const result = await waitForDecision(hash, { onStatus, signal });
  if (result.failure !== null) throw new TxError(result.failure, hash);
  return result;
}
