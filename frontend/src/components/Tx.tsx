import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { sendWrite, describeError, type TxResult } from '../lib/chain';
import { explorerTx } from '../lib/config';
import { phaseOf } from '../lib/receipt';
import { useWallet } from '../wallet/WalletContext';
import { EchoSpinner } from './Spinners';

type Phase = 'wallet' | 'submitted' | 'consensus' | 'done' | 'failed';

interface Toast {
  id: number;
  label: string;
  phase: Phase;
  status: string;
  hash: string | null;
  error: string | null;
  finality: string | null;
}

interface TxApi {
  /** Send a contract write through the connected wallet. Resolves with the result, or null when it failed. */
  send: (label: string, functionName: string, args: (string | number)[]) => Promise<TxResult | null>;
  busy: boolean;
}

const TxContext = createContext<TxApi | null>(null);

let counter = 0;

export function TxProvider({ children }: { children: ReactNode }) {
  const wallet = useWallet();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [active, setActive] = useState(0);

  const patch = useCallback((id: number, change: Partial<Toast>) => {
    setToasts((list) => list.map((toast) => (toast.id === id ? { ...toast, ...change } : toast)));
  }, []);

  const dismiss = useCallback(
    (id: number) => setToasts((list) => list.filter((toast) => toast.id !== id)),
    [],
  );

  const send = useCallback<TxApi['send']>(
    async (label, functionName, args) => {
      if (wallet.status !== 'connected' || !wallet.account || !wallet.active) {
        wallet.openPicker();
        return null;
      }
      if (wallet.wrongNetwork) {
        const ok = await wallet.switchNetwork();
        if (!ok) return null;
      }
      counter += 1;
      const id = counter;
      setToasts((list) => [
        ...list,
        { id, label, phase: 'wallet', status: 'WAITING_FOR_WALLET', hash: null, error: null, finality: null },
      ]);
      setActive((n) => n + 1);
      try {
        const result = await sendWrite(wallet.active.provider, wallet.account, functionName, args, {
          onSubmitted: (hash) => patch(id, { phase: 'submitted', hash, status: 'PENDING' }),
          onStatus: (status) =>
            patch(id, { status, phase: phaseOf(status) === 'queued' ? 'submitted' : 'consensus' }),
        });
        patch(id, { phase: 'done', status: result.statusName, finality: result.finality, hash: result.hash });
        window.setTimeout(() => dismiss(id), 12000);
        return result;
      } catch (error) {
        const hash = (error as { hash?: string | null } | null)?.hash ?? null;
        patch(id, { phase: 'failed', error: describeError(error), hash });
        return null;
      } finally {
        setActive((n) => n - 1);
      }
    },
    [wallet, patch, dismiss],
  );

  const api = useMemo(() => ({ send, busy: active > 0 }), [send, active]);

  return (
    <TxContext.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((toast) => (
          <ToastView key={toast.id} toast={toast} onClose={() => dismiss(toast.id)} />
        ))}
      </div>
    </TxContext.Provider>
  );
}

const STEP_INDEX: Record<Phase, number> = { wallet: 0, submitted: 1, consensus: 2, done: 4, failed: -1 };

function ToastView({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const working = toast.phase === 'wallet' || toast.phase === 'submitted' || toast.phase === 'consensus';
  const tone =
    toast.phase === 'failed' ? 'var(--bad)' : toast.phase === 'done' ? 'var(--good)' : 'var(--accent)';
  const index = STEP_INDEX[toast.phase];
  const text =
    toast.phase === 'wallet'
      ? 'Confirm the transaction in your wallet.'
      : toast.phase === 'submitted'
        ? 'Submitted. Waiting for the network to pick it up.'
        : toast.phase === 'consensus'
          ? `Validators at work: ${toast.status.toLowerCase().replace(/_/g, ' ')}. Reading pages can take a few minutes.`
          : toast.phase === 'done'
            ? toast.finality === 'finalized'
              ? 'Finalized.'
              : 'Accepted by the validators (can still be appealed until finalized).'
            : (toast.error ?? 'Failed.');
  return (
    <div
      className="toast"
      style={{ ['--c' as string]: tone }}
      role={toast.phase === 'failed' ? 'alert' : 'status'}
    >
      <div className="row">
        {working ? (
          <EchoSpinner size={30} />
        ) : (
          <span aria-hidden="true" style={{ fontSize: 22, color: tone }}>
            {toast.phase === 'done' ? '✓' : '!'}
          </span>
        )}
        <div style={{ flex: 1 }}>
          <div className="toast-title">{toast.label}</div>
          <div className="muted">{text}</div>
          {toast.hash ? (
            <a
              href={explorerTx(toast.hash)}
              target="_blank"
              rel="noreferrer"
              className="mono"
              style={{ fontSize: '0.78rem' }}
            >
              {toast.hash.slice(0, 12)}… view in explorer ↗
            </a>
          ) : null}
        </div>
        {!working ? (
          <button className="btn small ghost icon" onClick={onClose} aria-label="Dismiss">
            ×
          </button>
        ) : null}
      </div>
      {toast.phase !== 'failed' ? (
        <div className="steps" aria-hidden="true">
          {[0, 1, 2, 3].map((step) => (
            <i key={step} className={index > step ? 'on' : index === step ? 'now' : ''} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function useTx(): TxApi {
  const value = useContext(TxContext);
  if (value === null) throw new Error('useTx must be used inside TxProvider');
  return value;
}
