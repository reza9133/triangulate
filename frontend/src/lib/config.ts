// Network and deployment constants. Everything the app needs to know about where Triangulate lives.

const FALLBACK_ADDRESS = '0xE6b7836F8b8F15C4c2a369bF986845Ccb9917EC5';

function pickAddress(value: string | undefined): string {
  const candidate = (value ?? '').trim();
  return /^0x[0-9a-fA-F]{40}$/.test(candidate) ? candidate : FALLBACK_ADDRESS;
}

export const CONTRACT_ADDRESS = pickAddress(import.meta.env.VITE_TRIANGULATE_ADDRESS) as `0x${string}`;
export const RPC_URL = (import.meta.env.VITE_GENLAYER_RPC ?? '').trim() || 'https://studio.genlayer.com/api';

export const CHAIN_ID = 61999;
export const CHAIN_ID_HEX = '0x' + CHAIN_ID.toString(16);
export const CHAIN_NAME = 'GenLayer Studionet';
export const NATIVE_CURRENCY = { name: 'GEN Token', symbol: 'GEN', decimals: 18 } as const;

export const EXPLORER_URL = 'https://explorer-studio.genlayer.com';
export const GITHUB_URL = 'https://github.com/reza9133/triangulate';
export const X_URL = 'https://x.com/amirhp771';
export const X_HANDLE = '@amirhp771';
export const GENLAYER_URL = 'https://www.genlayer.com';
export const GENLAYER_DOCS_URL = 'https://docs.genlayer.com';

export const explorerAddress = (address: string): string => `${EXPLORER_URL}/address/${address}`;
export const explorerTx = (hash: string): string => `${EXPLORER_URL}/tx/${hash}`;

/** Wallet parameter object for wallet_addEthereumChain. */
export const ADD_CHAIN_PARAMS = {
  chainId: CHAIN_ID_HEX,
  chainName: CHAIN_NAME,
  nativeCurrency: NATIVE_CURRENCY,
  rpcUrls: [RPC_URL],
  blockExplorerUrls: [EXPLORER_URL],
} as const;
