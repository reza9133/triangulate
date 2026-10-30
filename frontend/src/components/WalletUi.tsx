import { useEffect, useRef, useState } from 'react';

import { CHAIN_NAME } from '../lib/config';
import { shortAddress } from '../lib/format';
import { useWallet } from '../wallet/WalletContext';
import { TriSpinner } from './Spinners';

const INSTALL = [
  { name: 'MetaMask', url: 'https://metamask.io/download/' },
  { name: 'Rabby', url: 'https://rabby.io/' },
  { name: 'Coinbase Wallet', url: 'https://www.coinbase.com/wallet/downloads' },
];

export function WalletModal() {
  const wallet = useWallet();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!wallet.pickerOpen) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') wallet.closePicker();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [wallet.pickerOpen, wallet]);

  if (!wallet.pickerOpen) return null;
  const connecting = wallet.status === 'connecting';
  return (
    <div
      className="overlay"
      onMouseDown={(event) => event.target === event.currentTarget && wallet.closePicker()}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="wallet-title">
        <div className="row spread">
          <h3 id="wallet-title" style={{ margin: 0 }}>
            Connect a wallet
          </h3>
          <button
            ref={closeRef}
            className="btn small ghost icon"
            onClick={wallet.closePicker}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          Wallets installed in this browser announce themselves (EIP-6963). Pick one. You will be asked to use{' '}
          {CHAIN_NAME}.
        </p>
        {connecting ? (
          <div className="loading-block">
            <TriSpinner size={48} label="Waiting for the wallet" />
            <div>Approve the connection in {wallet.active?.info.name ?? 'your wallet'}…</div>
          </div>
        ) : wallet.providers.length > 0 ? (
          <div>
            {wallet.providers.map((detail) => (
              <button
                key={detail.info.uuid}
                className="wallet-item"
                onClick={() => void wallet.connect(detail)}
              >
                {detail.info.icon ? (
                  <img src={detail.info.icon} alt="" />
                ) : (
                  <span className="wallet-icon">◆</span>
                )}
                <span>{detail.info.name}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="notice tone-warn" style={{ marginTop: 14 }}>
            <strong>No wallet detected.</strong> Install a browser wallet that supports EIP-6963, then press
            “Scan again”.
            <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              {INSTALL.map((item) => (
                <li key={item.name}>
                  <a href={item.url} target="_blank" rel="noreferrer">
                    {item.name} ↗
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        {wallet.error ? (
          <p className="error-text" role="alert" style={{ marginTop: 12 }}>
            {wallet.error}
          </p>
        ) : null}
        <div className="row spread" style={{ marginTop: 16 }}>
          <button className="btn small ghost" onClick={wallet.rescan}>
            Scan again
          </button>
          <span className="hint">Reading the app never needs a wallet.</span>
        </div>
      </div>
    </div>
  );
}

export function WalletButton() {
  const wallet = useWallet();
  const [open, setOpen] = useState(false);
  const holder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (holder.current && !holder.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (wallet.status !== 'connected' || !wallet.account) {
    return (
      <button className="btn primary" onClick={wallet.openPicker} disabled={wallet.status === 'connecting'}>
        {wallet.status === 'connecting' ? 'Connecting…' : 'Connect wallet'}
      </button>
    );
  }

  return (
    <div ref={holder} style={{ position: 'relative' }}>
      <button
        className="btn"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {wallet.active?.info.icon ? (
          <img src={wallet.active.info.icon} alt="" width={20} height={20} style={{ borderRadius: 6 }} />
        ) : null}
        <span className="mono">{shortAddress(wallet.account)}</span>
        <span
          className={`chip nodot tone-${wallet.wrongNetwork ? 'bad' : 'good'}`}
          style={{ padding: '1px 8px' }}
        >
          {wallet.wrongNetwork ? 'wrong network' : 'Studionet'}
        </span>
      </button>
      {open ? (
        <div
          className="card"
          role="menu"
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 8px)',
            width: 290,
            padding: 16,
            zIndex: 60,
          }}
        >
          <div className="hint">Connected with {wallet.active?.info.name}</div>
          <div className="mono" style={{ wordBreak: 'break-all', fontSize: '0.85rem', margin: '6px 0 12px' }}>
            {wallet.account}
          </div>
          <div className="row" style={{ marginBottom: 12 }}>
            <button
              className="btn small"
              onClick={() => void navigator.clipboard?.writeText(wallet.account ?? '')}
              role="menuitem"
            >
              Copy address
            </button>
            {wallet.wrongNetwork ? (
              <button
                className="btn small primary"
                onClick={() => void wallet.switchNetwork()}
                disabled={wallet.switching}
                role="menuitem"
              >
                Switch network
              </button>
            ) : null}
          </div>
          <button
            className="btn danger"
            style={{ width: '100%' }}
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void wallet.disconnect();
            }}
          >
            Disconnect
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Shown under the header whenever a wallet is connected to the wrong chain. */
export function NetworkBanner() {
  const wallet = useWallet();
  if (!wallet.wrongNetwork) return null;
  return (
    <div className="banner bad" role="alert">
      <strong>Wrong network.</strong>
      <span>
        Your wallet is on chain {wallet.chainId ?? 'unknown'}. Triangulate lives on {CHAIN_NAME}.
      </span>
      <button
        className="btn small primary"
        onClick={() => void wallet.switchNetwork()}
        disabled={wallet.switching}
      >
        {wallet.switching ? 'Waiting for wallet…' : `Switch to ${CHAIN_NAME}`}
      </button>
      {wallet.error ? <span className="error-text">{wallet.error}</span> : null}
    </div>
  );
}
