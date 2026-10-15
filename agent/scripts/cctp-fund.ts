/**
 * Cross-chain treasury funding with CCTP V2: burn USDC on a source testnet, wait for Circle's
 * attestation (Iris), mint natively on Arc testnet into the agent treasury. No wrapped asset.
 *
 * Usage: tsx scripts/cctp-fund.ts --amount 5 [--from base-sepolia|eth-sepolia|arb-sepolia]
 * The treasury wallet signs on both chains, so it needs source-chain USDC + gas.
 */
import { createPublicClient, createWalletClient, http, pad, parseAbi, parseUnits, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrumSepolia, baseSepolia, sepolia } from 'viem/chains';
import { arcTestnet } from '../src/config.js';
import { readWalletsFile } from '../src/wallets.js';

const SOURCES = {
  'base-sepolia': { chain: baseSepolia, domain: 6, usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' },
  'eth-sepolia': { chain: sepolia, domain: 0, usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' },
  'arb-sepolia': { chain: arbitrumSepolia, domain: 3, usdc: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d' },
} as const;
const ARC_DOMAIN = 26;
const TOKEN_MESSENGER_V2 = '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA';
const MESSAGE_TRANSMITTER_V2 = '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275';
const IRIS = 'https://iris-api-sandbox.circle.com';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const src = SOURCES[arg('from', 'base-sepolia') as keyof typeof SOURCES];
const amount = parseUnits(arg('amount', '5'), 6);

const treasury = readWalletsFile().wallets.find(w => w.role === 'treasury');
if (!treasury?.privateKey) throw new Error('CCTP script needs the local treasury key (Circle wallets: use the Circle CLI `circle bridge` or App Kit Bridge instead)');
const account = privateKeyToAccount(treasury.privateKey);
const srcPub = createPublicClient({ chain: src.chain, transport: http() });
const srcWallet = createWalletClient({ account, chain: src.chain, transport: http() });
const arcPub = createPublicClient({ chain: arcTestnet, transport: http() });
const arcWallet = createWalletClient({ account, chain: arcTestnet, transport: http() });

const erc20 = parseAbi(['function approve(address,uint256) returns (bool)']);
const messenger = parseAbi(['function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)']);
const transmitter = parseAbi(['function receiveMessage(bytes message, bytes attestation) returns (bool)']);

console.log(`Burning ${arg('amount', '5')} USDC on ${src.chain.name} -> Arc testnet treasury ${account.address}`);
await srcPub.waitForTransactionReceipt({ hash: await srcWallet.writeContract({ address: src.usdc, abi: erc20, functionName: 'approve', args: [TOKEN_MESSENGER_V2, amount] }) });
const burn = await srcWallet.writeContract({
  address: TOKEN_MESSENGER_V2, abi: messenger, functionName: 'depositForBurn',
  // maxFee covers the Fast Transfer fee; minFinalityThreshold 1000 = fast, 2000 = standard
  args: [amount, ARC_DOMAIN, pad(account.address), src.usdc, pad('0x0'), amount / 100n, 1000],
});
await srcPub.waitForTransactionReceipt({ hash: burn });
console.log('burn tx', burn);

let message: Hex | undefined, attestation: Hex | undefined;
for (let i = 0; i < 180 && !attestation; i++) {
  await new Promise(r => setTimeout(r, 5000));
  const r = await fetch(`${IRIS}/v2/messages/${src.domain}?transactionHash=${burn}`);
  if (!r.ok) continue;
  const m = (await r.json()).messages?.[0];
  if (m?.status === 'complete') { message = m.message; attestation = m.attestation; }
}
if (!attestation || !message) throw new Error('attestation not ready after 15 min');
const mint = await arcWallet.writeContract({ address: MESSAGE_TRANSMITTER_V2, abi: transmitter, functionName: 'receiveMessage', args: [message, attestation] });
await arcPub.waitForTransactionReceipt({ hash: mint });
console.log('mint tx on Arc', mint);
