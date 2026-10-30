import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { ADD_CHAIN_PARAMS, CHAIN_ID, CHAIN_ID_HEX } from '../lib/config';
import { describeError } from '../lib/chain';
import { providerStore, type EIP1193Provider, type EIP6963ProviderDetail } from './eip6963';

export type WalletStatus = 'disconnected' | 'connecting' | 'connected';

interface WalletState {
  status: WalletStatus;
  account: string | null;
  chainId: number | null;
  active: EIP6963ProviderDetail | null;
  error: string | null;
}

export interface WalletApi extends WalletState {
  providers: EIP6963ProviderDetail[];
  wrongNetwork: boolean;
  switching: boolean;
  pickerOpen: boolean;
  openPicker: () => void;
  closePicker: () => void;
  connect: (detail: EIP6963ProviderDetail) => Promise<void>;
  disconnect: () => Promise<void>;
  switchNetwork: () => Promise<boolean>;
  rescan: () => void;
}

const STORAGE_KEY = 'triangulate.wallet';

interface Remembered {
  rdns: string;
  connected: boolean;
}

function readRemembered(): Remembered | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<Remembered>;
    if (typeof value.rdns === 'string' && typeof value.connected === 'boolean')
      return { rdns: value.rdns, connected: value.connected };
  } catch {
    /* storage can be unavailable */
  }
  return null;
}

function remember(value: Remembered | null): void {
  try {
    if (value === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* storage can be unavailable */
  }
}

export const parseChainId = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const parsed =
    value.startsWith('0x') || value.startsWith('0X')
      ? Number.parseInt(value, 16)
      : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const firstAccount = (value: unknown): string | null => {
  if (!Array.isArray(value) || value.length === 0) return null;
  const head: unknown = value[0];
  return typeof head === 'string' && /^0x[0-9a-fA-F]{40}$/.test(head) ? head : null;
};

const IDLE: WalletState = { status: 'disconnected', account: null, chainId: null, active: null, error: null };

const WalletContext = createContext<WalletApi | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const providers = useSyncExternalStore(providerStore.subscribe, providerStore.getSnapshot, () => []);
  const [state, setState] = useState<WalletState>(IDLE);
  const [switching, setSwitching] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const detachRef = useRef<(() => void) | null>(null);
  const restoredRef = useRef(false);

  useEffect(() => {
    providerStore.start();
    return () => providerStore.stop();
  }, []);

  const detach = useCallback(() => {
    detachRef.current?.();
    detachRef.current = null;
  }, []);

  const attach = useCallback(
    (detail: EIP6963ProviderDetail) => {
      detach();
      const { provider } = detail;
      const onAccounts = (accounts: unknown) => {
        const account = firstAccount(accounts);
        if (account === null) {
          remember({ rdns: detail.info.rdns, connected: false });
          setState({ ...IDLE });
          detachRef.current?.();
          detachRef.current = null;
        } else {
          setState((previous) => ({ ...previous, account }));
        }
      };
      const onChain = (chainId: unknown) =>
        setState((previous) => ({ ...previous, chainId: parseChainId(chainId) }));
      const onDisconnect = () => {
        setState((previous) => ({ ...previous, chainId: null }));
      };
      provider.on?.('accountsChanged', onAccounts);
      provider.on?.('chainChanged', onChain);
      provider.on?.('disconnect', onDisconnect);
      detachRef.current = () => {
        provider.removeListener?.('accountsChanged', onAccounts);
        provider.removeListener?.('chainChanged', onChain);
        provider.removeListener?.('disconnect', onDisconnect);
      };
    },
    [detach],
  );

  const connect = useCallback(
    async (detail: EIP6963ProviderDetail) => {
      setState({ ...IDLE, status: 'connecting', active: detail });
      try {
        const accounts = await detail.provider.request({ method: 'eth_requestAccounts' });
        const account = firstAccount(accounts);
        if (account === null) throw new Error('The wallet did not share an account.');
        const chainId = parseChainId(await detail.provider.request({ method: 'eth_chainId' }));
        attach(detail);
        remember({ rdns: detail.info.rdns, connected: true });
        setState({ status: 'connected', account, chainId, active: detail, error: null });
        setPickerOpen(false);
      } catch (error) {
        setState({ ...IDLE, error: describeError(error) });
      }
    },
    [attach],
  );

  const disconnect = useCallback(async () => {
    const provider: EIP1193Provider | undefined = state.active?.provider;
    const rdns = state.active?.info.rdns;
    detach();
    // The connection is a permission the site holds, so it is revoked where the wallet supports it.
    // Wallets that do not implement wallet_revokePermissions simply keep their permission; the app
    // still forgets the account and will not reconnect on its own.
    if (provider) {
      try {
        await provider.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] });
      } catch {
        /* not supported by every wallet */
      }
    }
    if (rdns) remember({ rdns, connected: false });
    setState({ ...IDLE });
  }, [detach, state.active]);

  const switchNetwork = useCallback(async (): Promise<boolean> => {
    const provider = state.active?.provider;
    if (!provider) return false;
    setSwitching(true);
    try {
      try {
        await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_ID_HEX }] });
      } catch (error) {
        const code = (error as { code?: unknown } | null)?.code;
        const message = String((error as { message?: unknown } | null)?.message ?? '');
        // 4902: unknown chain. Some wallets wrap it, so the message is checked too.
        if (
          code === 4902 ||
          /unrecognized chain|unknown chain|not been added|try adding the chain/i.test(message)
        ) {
          await provider.request({ method: 'wallet_addEthereumChain', params: [{ ...ADD_CHAIN_PARAMS }] });
        } else {
          throw error;
        }
      }
      const chainId = parseChainId(await provider.request({ method: 'eth_chainId' }));
      setState((previous) => ({ ...previous, chainId, error: null }));
      return chainId === CHAIN_ID;
    } catch (error) {
      setState((previous) => ({ ...previous, error: describeError(error) }));
      return false;
    } finally {
      setSwitching(false);
    }
  }, [state.active]);

  // Silent restore: a wallet the visitor connected earlier is picked up again without a popup,
  // but only if they did not disconnect, and only if the wallet still shares the account.
  useEffect(() => {
    if (restoredRef.current || state.status !== 'disconnected') return;
    const remembered = readRemembered();
    if (remembered === null || !remembered.connected) {
      if (providers.length > 0) restoredRef.current = true;
      return;
    }
    const detail = providers.find((entry) => entry.info.rdns === remembered.rdns);
    if (!detail) return;
    restoredRef.current = true;
    void (async () => {
      try {
        const account = firstAccount(await detail.provider.request({ method: 'eth_accounts' }));
        if (account === null) {
          remember({ rdns: remembered.rdns, connected: false });
          return;
        }
        const chainId = parseChainId(await detail.provider.request({ method: 'eth_chainId' }));
        attach(detail);
        setState({ status: 'connected', account, chainId, active: detail, error: null });
      } catch {
        /* stay disconnected */
      }
    })();
  }, [providers, state.status, attach]);

  useEffect(() => () => detach(), [detach]);

  const api = useMemo<WalletApi>(
    () => ({
      ...state,
      providers,
      wrongNetwork: state.status === 'connected' && state.chainId !== CHAIN_ID,
      switching,
      pickerOpen,
      openPicker: () => {
        providerStore.request();
        setPickerOpen(true);
      },
      closePicker: () => setPickerOpen(false),
      connect,
      disconnect,
      switchNetwork,
      rescan: providerStore.request,
    }),
    [state, providers, switching, pickerOpen, connect, disconnect, switchNetwork],
  );

  return <WalletContext.Provider value={api}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletApi {
  const value = useContext(WalletContext);
  if (value === null) throw new Error('useWallet must be used inside WalletProvider');
  return value;
}
