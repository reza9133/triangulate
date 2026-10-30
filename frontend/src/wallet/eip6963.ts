// EIP-6963 multi-injected-provider discovery, written by hand. No wallet kit is involved.
// https://eips.ethereum.org/EIPS/eip-6963

export interface EIP1193Provider {
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

export interface EIP6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

export interface EIP6963ProviderDetail {
  info: EIP6963ProviderInfo;
  provider: EIP1193Provider;
}

interface AnnounceEvent extends Event {
  detail: EIP6963ProviderDetail;
}

const isInfo = (value: unknown): value is EIP6963ProviderInfo => {
  if (value === null || typeof value !== 'object') return false;
  const info = value as Record<string, unknown>;
  return (
    typeof info.uuid === 'string' &&
    typeof info.name === 'string' &&
    typeof info.rdns === 'string' &&
    typeof info.icon === 'string'
  );
};

/** Icons come from wallet extensions as data: URIs. Anything else is dropped. */
export const safeIcon = (icon: string): string =>
  /^data:image\/(png|svg\+xml|webp|jpeg|gif);/i.test(icon) ? icon : '';

export function parseAnnouncement(event: Event): EIP6963ProviderDetail | null {
  const detail = (event as AnnounceEvent).detail as unknown;
  if (detail === null || typeof detail !== 'object') return null;
  const record = detail as { info?: unknown; provider?: unknown };
  if (!isInfo(record.info)) return null;
  const provider = record.provider as EIP1193Provider | undefined;
  if (!provider || typeof provider.request !== 'function') return null;
  return { info: { ...record.info, icon: safeIcon(record.info.icon) }, provider };
}

type Listener = () => void;

/** A tiny external store of announced wallets, for useSyncExternalStore. */
export class ProviderStore {
  private details = new Map<string, EIP6963ProviderDetail>();
  private listeners = new Set<Listener>();
  private snapshot: EIP6963ProviderDetail[] = [];
  private started = false;

  private handler = (event: Event): void => {
    const detail = parseAnnouncement(event);
    if (detail === null) return;
    this.details.set(detail.info.uuid, detail);
    this.snapshot = [...this.details.values()].sort((a, b) => a.info.name.localeCompare(b.info.name));
    this.listeners.forEach((listener) => listener());
  };

  start = (): void => {
    if (this.started || typeof window === 'undefined') return;
    this.started = true;
    window.addEventListener('eip6963:announceProvider', this.handler);
    this.request();
  };

  /** Ask every wallet to announce itself again. */
  request = (): void => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new Event('eip6963:requestProvider'));
  };

  stop = (): void => {
    if (!this.started || typeof window === 'undefined') return;
    window.removeEventListener('eip6963:announceProvider', this.handler);
    this.started = false;
  };

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): EIP6963ProviderDetail[] => this.snapshot;

  /** Forget every announced wallet (used by tests). */
  clear = (): void => {
    this.details.clear();
    this.snapshot = [];
    this.listeners.forEach((listener) => listener());
  };
}

export const providerStore = new ProviderStore();
