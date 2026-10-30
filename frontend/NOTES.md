# Frontend notes: what is verified and what is not

## Verified here

- `npm run check`: typecheck (strict), ESLint, Prettier, 49 Vitest tests, production build. All pass.
- A real Chromium run of the built site with a scripted EIP-6963 wallet: the wallet is listed, connects, a wallet on the wrong chain gets the "Wrong network" banner, "Switch" calls `wallet_switchEthereumChain` and falls back to `wallet_addEthereumChain`, and "Disconnect" calls `wallet_revokePermissions` and returns to "Connect wallet".
- Reading: the pages were rendered against canned JSON-RPC answers encoded in GenLayer calldata, so the `genlayer-js` decoding path and every data page were exercised.
- Three themes (light, dim, dark), mobile layout, 3D hero (WebGL, with a text fallback).

## Not verified (the build environment has no access to Studionet)

- **Signing real transactions.** `open_claim`, `add_source`, `examine`, `drop_source` and `close_claim` go through `genlayer-js` `writeContract` with the wallet as `provider`. The transaction-following code is a port of `scripts/receipt.mjs`, which the live run already used, but the browser-wallet path itself has not been run against Studionet. Try `New claim` first.
- **Live reads from the deployed contract.** The shapes in `src/lib/types.ts` come from the contract source and the committed e2e report.
- Which wallets implement `wallet_revokePermissions`. Those that do not keep their site permission; the app still forgets the account and never reconnects by itself.

## Choices

- Wallet discovery is EIP-6963 only; `window.ethereum` is never read, so a wallet that does not announce itself is not listed.
- No fake data: empty and failing states are shown as such.
- English only. Fonts come from Google Fonts with system fallbacks.
- The official GenLayer mark in `public/brand/genlayer-logo.svg` was traced from the image supplied with the request. Replace it with the official SVG file if you have one.
