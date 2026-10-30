import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../App';
import { ThemeProvider } from '../components/Theme';
import { TxProvider } from '../components/Tx';
import { parseAnnouncement, providerStore } from '../wallet/eip6963';
import { WalletProvider, parseChainId } from '../wallet/WalletContext';

const ACCOUNT = '0x40B1e9682689a4FE00EE793E494a40b6f43a3e60';
const ICON = 'data:image/svg+xml;base64,PHN2Zy8+';

interface MockOptions {
  chainId?: string;
  switchError?: { code: number; message: string };
}

function makeWallet(options: MockOptions = {}) {
  let chainId = options.chainId ?? '0xf22f';
  const listeners = new Map<string, Set<(...a: unknown[]) => void>>();
  const request = vi.fn(async ({ method, params }: { method: string; params?: unknown }) => {
    switch (method) {
      case 'eth_requestAccounts':
      case 'eth_accounts':
        return [ACCOUNT];
      case 'eth_chainId':
        return chainId;
      case 'wallet_switchEthereumChain':
        if (options.switchError) throw options.switchError;
        chainId = (params as { chainId: string }[])[0]!.chainId;
        return null;
      case 'wallet_addEthereumChain':
        chainId = (params as { chainId: string }[])[0]!.chainId;
        return null;
      case 'wallet_revokePermissions':
        return null;
      default:
        throw new Error(`unexpected ${method}`);
    }
  });
  const provider = {
    request,
    on: (event: string, handler: (...a: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    },
    removeListener: (event: string, handler: (...a: unknown[]) => void) =>
      listeners.get(event)?.delete(handler),
  };
  const emit = (event: string, ...args: unknown[]) => listeners.get(event)?.forEach((h) => h(...args));
  return { provider, request, emit };
}

function announce(wallet: ReturnType<typeof makeWallet>) {
  const handler = () => {
    window.dispatchEvent(
      new CustomEvent('eip6963:announceProvider', {
        detail: {
          info: { uuid: 'test-wallet', name: 'Test Wallet', icon: ICON, rdns: 'io.test.wallet' },
          provider: wallet.provider,
        },
      }),
    );
  };
  window.addEventListener('eip6963:requestProvider', handler);
  return () => window.removeEventListener('eip6963:requestProvider', handler);
}

function renderApp() {
  return render(
    <ThemeProvider>
      <WalletProvider>
        <TxProvider>
          <MemoryRouter initialEntries={['/docs']}>
            <App />
          </MemoryRouter>
        </TxProvider>
      </WalletProvider>
    </ThemeProvider>,
  );
}

let stop = () => {};
beforeEach(() => {
  window.localStorage.clear();
  providerStore.clear();
});
afterEach(() => stop());

describe('EIP-6963', () => {
  it('accepts a well-formed announcement and drops unsafe icons', () => {
    const w = makeWallet();
    const good = parseAnnouncement(
      new CustomEvent('x', {
        detail: { info: { uuid: 'u', name: 'W', icon: ICON, rdns: 'a.b' }, provider: w.provider },
      }),
    );
    expect(good?.info.name).toBe('W');
    const unsafe = parseAnnouncement(
      new CustomEvent('x', {
        detail: {
          info: { uuid: 'u', name: 'W', icon: 'https://evil.example/x.png', rdns: 'a.b' },
          provider: w.provider,
        },
      }),
    );
    expect(unsafe?.info.icon).toBe('');
  });
  it('rejects malformed announcements', () => {
    expect(parseAnnouncement(new CustomEvent('x', { detail: null }))).toBeNull();
    expect(
      parseAnnouncement(new CustomEvent('x', { detail: { info: { uuid: 1 }, provider: {} } })),
    ).toBeNull();
    expect(
      parseAnnouncement(
        new CustomEvent('x', {
          detail: { info: { uuid: 'u', name: 'n', icon: '', rdns: 'r' }, provider: {} },
        }),
      ),
    ).toBeNull();
  });
  it('parses chain ids', () => {
    expect(parseChainId('0xf22f')).toBe(61999);
    expect(parseChainId('61999')).toBe(61999);
    expect(parseChainId(1)).toBe(1);
    expect(parseChainId(undefined)).toBeNull();
  });
});

describe('wallet connection', () => {
  it('lists announced wallets, connects, and shows the account on the right network', async () => {
    const wallet = makeWallet();
    stop = announce(wallet);
    renderApp();
    fireEvent.click(screen.getAllByRole('button', { name: /connect wallet/i })[0]!);
    const item = await screen.findByRole('button', { name: /test wallet/i });
    await act(async () => fireEvent.click(item));
    await waitFor(() => expect(screen.getByText('0x40B1…3e60')).toBeInTheDocument());
    expect(screen.getByText('Studionet')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the switch-network message on the wrong chain and switches', async () => {
    const wallet = makeWallet({ chainId: '0x1' });
    stop = announce(wallet);
    renderApp();
    fireEvent.click(screen.getAllByRole('button', { name: /connect wallet/i })[0]!);
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: /test wallet/i })));
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(/wrong network/i);
    expect(banner).toHaveTextContent(/chain 1/);
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: /switch to genlayer studionet/i })),
    );
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(wallet.request).toHaveBeenCalledWith({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0xf22f' }],
    });
  });

  it('adds the network when the wallet does not know it', async () => {
    const wallet = makeWallet({
      chainId: '0x1',
      switchError: { code: 4902, message: 'Unrecognized chain ID' },
    });
    stop = announce(wallet);
    renderApp();
    fireEvent.click(screen.getAllByRole('button', { name: /connect wallet/i })[0]!);
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: /test wallet/i })));
    await act(async () =>
      fireEvent.click(await screen.findByRole('button', { name: /switch to genlayer studionet/i })),
    );
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    const add = wallet.request.mock.calls.find(([arg]) => arg.method === 'wallet_addEthereumChain');
    expect(add).toBeDefined();
    expect((add![0].params as { chainId: string; rpcUrls: string[] }[])[0]).toMatchObject({
      chainId: '0xf22f',
      rpcUrls: ['https://studio.genlayer.com/api'],
    });
  });

  it('really disconnects, revokes the permission, and does not reconnect on reload', async () => {
    const wallet = makeWallet();
    stop = announce(wallet);
    const first = renderApp();
    fireEvent.click(screen.getAllByRole('button', { name: /connect wallet/i })[0]!);
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: /test wallet/i })));
    await waitFor(() => expect(screen.getByText('0x40B1…3e60')).toBeInTheDocument());

    fireEvent.click(screen.getByText('0x40B1…3e60'));
    await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: /disconnect/i })));
    await waitFor(() => expect(screen.queryByText('0x40B1…3e60')).not.toBeInTheDocument());
    expect(screen.getAllByRole('button', { name: /connect wallet/i }).length).toBeGreaterThan(0);
    expect(wallet.request).toHaveBeenCalledWith({
      method: 'wallet_revokePermissions',
      params: [{ eth_accounts: {} }],
    });

    first.unmount();
    renderApp();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText('0x40B1…3e60')).not.toBeInTheDocument();
  });

  it('restores a connected wallet silently on reload', async () => {
    const wallet = makeWallet();
    stop = announce(wallet);
    const first = renderApp();
    fireEvent.click(screen.getAllByRole('button', { name: /connect wallet/i })[0]!);
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: /test wallet/i })));
    await waitFor(() => expect(screen.getByText('0x40B1…3e60')).toBeInTheDocument());
    first.unmount();
    renderApp();
    await waitFor(() => expect(screen.getByText('0x40B1…3e60')).toBeInTheDocument());
    // restoring must never open the account-request popup
    const popups = wallet.request.mock.calls.filter(([arg]) => arg.method === 'eth_requestAccounts');
    expect(popups).toHaveLength(1);
  });

  it('follows the wallet when the account is removed', async () => {
    const wallet = makeWallet();
    stop = announce(wallet);
    renderApp();
    fireEvent.click(screen.getAllByRole('button', { name: /connect wallet/i })[0]!);
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: /test wallet/i })));
    await waitFor(() => expect(screen.getByText('0x40B1…3e60')).toBeInTheDocument());
    act(() => wallet.emit('accountsChanged', []));
    await waitFor(() => expect(screen.queryByText('0x40B1…3e60')).not.toBeInTheDocument());
  });

  it('tells the visitor when no wallet is installed', async () => {
    stop = () => {};
    renderApp();
    fireEvent.click(screen.getAllByRole('button', { name: /connect wallet/i })[0]!);
    expect(await screen.findByText(/no wallet detected/i)).toBeInTheDocument();
  });
});
