/**
 * Creates the agent-managed wallets. With CIRCLE_API_KEY + CIRCLE_ENTITY_SECRET set, every wallet is a
 * Circle developer-controlled wallet on ARC-TESTNET (keys in Circle's MPC). Without them, local keys are
 * generated into a chmod-600 file as a fallback. Only addresses are printed.
 */
import { existsSync, writeFileSync, chmodSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { cfg } from '../src/config.js';
import { getCircleClient, readWalletsFile, type Role, type WalletsFile } from '../src/wallets.js';

const PLAN: { label: string; role: Role }[] = [
  { label: 'Treasury', role: 'treasury' },
  { label: 'Shipper A (textile exporter, Bursa)', role: 'shipper' },
  { label: 'Shipper B (electronics distributor, Istanbul)', role: 'shipper' },
  { label: 'Carrier 1', role: 'carrier' },
  { label: 'Carrier 2', role: 'carrier' },
  { label: 'Carrier 3', role: 'carrier' },
];

const existing = readWalletsFile();
const circle = await getCircleClient();
const out: WalletsFile = { ...existing, wallets: [...existing.wallets] };

if (circle) {
  if (!out.circleWalletSetId) {
    const ws = await circle.createWalletSet({ name: 'Haulwise Settlement Agent', idempotencyKey: randomUUID() });
    out.circleWalletSetId = ws.data.walletSet.id;
  }
  const missing = PLAN.filter(p => !out.wallets.some(w => w.label === p.label && w.circleWalletId));
  if (missing.length) {
    const res = await circle.createWallets({ walletSetId: out.circleWalletSetId, blockchains: ['ARC-TESTNET'], count: missing.length, accountType: 'EOA', idempotencyKey: randomUUID() });
    res.data.wallets.forEach((w: any, i: number) => {
      const p = missing[i];
      out.wallets = out.wallets.filter(x => x.label !== p.label);
      out.wallets.push({ label: p.label, role: p.role, address: w.address, circleWalletId: w.id });
    });
  }
} else {
  for (const p of PLAN) {
    if (out.wallets.some(w => w.label === p.label)) continue;
    const pk = generatePrivateKey();
    out.wallets.push({ label: p.label, role: p.role, address: privateKeyToAccount(pk).address, privateKey: pk });
  }
}

writeFileSync(cfg.walletsFile, JSON.stringify(out, null, 2), { mode: 0o600 });
if (existsSync(cfg.walletsFile)) chmodSync(cfg.walletsFile, 0o600);
console.log(`provider: ${circle ? 'circle (developer-controlled, ARC-TESTNET)' : 'local fallback'}`);
for (const w of out.wallets) console.log(`${w.role.padEnd(9)} ${w.address}  ${w.label}${w.circleWalletId ? ' [circle]' : ''}`);
