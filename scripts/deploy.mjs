#!/usr/bin/env node
// Deploy contracts/triangulate.py to GenLayer Studionet and verify it.
//
//   node scripts/deploy.mjs
//
// Optional environment:
//   TRIANGULATE_PRIVATE_KEY   0x... key to deploy from (default: a throwaway key; Studionet needs no funds)
//   TRIANGULATE_RPC           RPC endpoint (default: https://studio.genlayer.com/api)

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { CHAIN_ID, ROOT, RPC_URL, loadKey, makeClient, readJson, readText, sha256Of, waitForDecision } from './lib.mjs';

function addressFromReceipt(transaction) {
  const candidates = [
    transaction?.data?.contract_address,
    transaction?.data?.contractAddress,
    transaction?.txDataDecoded?.contractAddress,
    transaction?.txDataDecoded?.contract_address,
    transaction?.recipient,
    transaction?.to_address,
  ];
  return candidates.find((value) => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value) && !/^0x0{40}$/.test(value)) ?? null;
}

async function main() {
  const source = readText('contracts/triangulate.py');
  const header = source.split('\n', 1)[0];
  if (!header.startsWith('# { "Depends": "py-genlayer:')) throw new Error('The contract must start with its runner pin comment.');

  const { key, generated } = loadKey();
  const { client, account } = makeClient(key);

  console.log('Triangulate deployment');
  console.log(`  network   Studionet (chain ${CHAIN_ID})`);
  console.log(`  rpc       ${RPC_URL}`);
  console.log(`  deployer  ${account.address}${generated ? '  (throwaway key)' : ''}`);
  console.log(`  runner    ${header.match(/py-genlayer:[a-z0-9]+/)?.[0]}`);
  console.log(`  source    ${sha256Of(source)}`);
  console.log('');

  console.log('Deploying');
  const hash = String(await client.deployContract({ code: source, args: [] }));
  console.log(`  submitted ${hash}`);
  const outcome = await waitForDecision(client, hash, { onStatus: (name) => console.log(`  status: ${name}`) });
  if (outcome.failure) throw new Error(`Deployment failed: ${outcome.failure}`);

  const address = addressFromReceipt(outcome.transaction);
  if (!address) {
    throw new Error(
      `The deployment was accepted but the contract address was not in the receipt. Open ${hash} in the Studionet explorer, copy the contract address, and pass it to the e2e script with --address.`,
    );
  }
  console.log(`  contract  ${address}`);

  console.log('\nVerifying the deployed contract');
  const info = await readJson(client, address, 'contract_info');
  const stats = await readJson(client, address, 'stats');
  if (info.name !== 'Triangulate') throw new Error(`Unexpected contract name: ${info.name}`);
  if (stats.claims !== 0) throw new Error('A freshly deployed contract should hold no claims.');
  console.log(`  name ${info.name}, version ${info.version}, claims ${stats.claims}`);

  const record = {
    network: 'studionet',
    chainId: CHAIN_ID,
    rpc: RPC_URL,
    address,
    deployTransaction: hash,
    deployer: account.address,
    sourceSha256: sha256Of(source),
    runner: info.runner,
    version: info.version,
    deployedAt: new Date().toISOString(),
  };
  mkdirSync(path.join(ROOT, 'artifacts'), { recursive: true });
  writeFileSync(path.join(ROOT, 'artifacts', 'deployment.json'), JSON.stringify(record, null, 2) + '\n');
  console.log('\nWrote artifacts/deployment.json');
  console.log('\nNext');
  console.log('  bash run.sh e2e        run the live end-to-end suite against this deployment and write a report');
}

main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
