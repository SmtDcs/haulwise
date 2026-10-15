import { defineChain } from 'viem';
import { resolve } from 'node:path';
import type { Address } from './types.js';

export const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [process.env.ARC_RPC_URL ?? 'https://rpc.testnet.arc.io'] } },
  blockExplorers: { default: { name: 'Arcscan', url: 'https://explorer.testnet.arc.io' } },
  testnet: true,
});

export const cfg = {
  escrow: (process.env.HAULWISE_ESCROW ?? '') as Address,
  usdc: (process.env.USDC_ADDRESS ?? '0x3600000000000000000000000000000000000000') as Address,
  dataDir: resolve(process.env.AGENT_DATA_DIR ?? new URL('../data', import.meta.url).pathname),
  walletsFile: process.env.AGENT_WALLETS_FILE ?? '/workspace/.secrets/haulwise-agent-wallets.json',
  port: Number(process.env.PORT ?? 8787),
  /** Shipper accounts the agent settles for (comma-separated). Defaults to every wallet with role "shipper". */
  shippers: (process.env.AGENT_SHIPPERS ?? '').split(',').filter(Boolean) as Address[],
};
