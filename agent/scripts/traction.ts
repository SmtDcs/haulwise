/**
 * Runs real freight-settlement flows on Arc testnet between the agent-managed wallets:
 * treasury funds shippers -> shipper escrows USDC -> carrier picks up and delivers on-chain ->
 * carrier files an invoice + POD -> the settlement agent reconciles and acts.
 *
 * Usage: HAULWISE_ESCROW=0x... tsx scripts/traction.ts --count 20 [--no-agent]
 * Scenario mix is deliberate: most loads are clean, some carry the errors AP teams actually see.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseUnits } from 'viem';
import { erc20Abi, escrowAbi } from '../src/abi.js';
import { chainNow, publicClient, readShipment } from '../src/chain.js';
import { cfg } from '../src/config.js';
import { encodeTerms } from '../src/invoice.js';
import { DEFAULT_POLICY } from '../src/types.js';
import { loadWallets, type AgentWallet } from '../src/wallets.js';
import { SettlementAgent } from '../src/agent.js';

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const COUNT = Number(arg('count', '12'));
const SCALE = Number(arg('scale', '1')); // shrink clean-load amounts when faucet funds are tight
const RUN_AGENT = !process.argv.includes('--no-agent');
if (!cfg.escrow) throw new Error('HAULWISE_ESCROW not set');

const LANES = [
  ['Bursa, TR', 'Hamburg, DE', '18 pallets cotton fabric'], ['Istanbul, TR', 'Ankara, TR', '22t consumer electronics'],
  ['Izmir, TR', 'Mersin, TR', '40ft container dried fruit'], ['Gebze, TR', 'Bucharest, RO', '12 pallets auto parts'],
  ['Istanbul, TR', 'Sofia, BG', '8 pallets textiles'], ['Kayseri, TR', 'Istanbul, TR', '16t furniture'],
  ['Manisa, TR', 'Thessaloniki, GR', '20 pallets white goods'], ['Konya, TR', 'Izmir, TR', '24t flour'],
];
type Scenario = 'clean' | 'overbilled' | 'wrong_payee' | 'duplicate' | 'no_pod' | 'large' | 'wrong_lane';
const MIX: Scenario[] = ['clean', 'clean', 'clean', 'overbilled', 'clean', 'large', 'clean', 'wrong_payee', 'clean', 'duplicate', 'clean', 'no_pod', 'clean', 'wrong_lane'];

function amountFor(i: number) {
  if (MIX[i % MIX.length] === 'large') return 4.5; // above the auto-confirm limit on purpose
  return Number(((0.4 + ((i * 37) % 21) / 10) * SCALE).toFixed(2)); // 0.40 – 2.40 USDC at scale 1
}

const wallets = await loadWallets();
const treasury = wallets.find(w => w.role === 'treasury')!;
const shippers = wallets.filter(w => w.role === 'shipper');
const carriers = wallets.filter(w => w.role === 'carrier');
const bal = (a: string) => publicClient.readContract({ address: cfg.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [a as any] });
const fmt = (v: bigint) => (Number(v) / 1e6).toFixed(2);
let txs = 0;
const call = async (w: AgentWallet, to: any, abi: any, fn: string, args: readonly unknown[]) => { const h = await w.call(to, abi, fn, args); txs++; return h; };

// Testnet faucet amounts are small, so policy limits are scaled down for the run (same logic, smaller numbers).
const stateFile = join(cfg.dataDir, 'state.json');
mkdirSync(cfg.dataDir, { recursive: true });
if (!existsSync(stateFile))
  writeFileSync(stateFile, JSON.stringify({ policy: { ...DEFAULT_POLICY, autoConfirmMaxUSDC: 3, dailyAutoConfirmCapUSDC: 60, newCarrierMinCompleted: 1, newCarrierMaxUSDC: 3 }, seenInvoices: {}, approvals: [], reconciled: {}, handled: {} }, null, 2));

console.log(`treasury ${treasury.address} holds ${fmt(await bal(treasury.address))} USDC`);
// 1. Treasury tops up shippers (escrow float) and carriers (gas, paid in USDC on Arc).
// Each shipper gets exactly the escrow float its loads in this run need, plus a little for gas.
const need = shippers.map(() => 0.3);
for (let i = 0; i < COUNT; i++) need[i % shippers.length] += amountFor(i);
for (const [k, s] of shippers.entries()) { const want = parseUnits(need[k].toFixed(6), 6); const have = await bal(s.address); if (have < want) await call(treasury, cfg.usdc, erc20Abi, 'transfer', [s.address, want - have]); }
for (const c of carriers) { const have = await bal(c.address); if (have < parseUnits('0.5', 6)) await call(treasury, cfg.usdc, erc20Abi, 'transfer', [c.address, parseUnits('0.5', 6)]); }
for (const s of shippers) await call(s, cfg.usdc, erc20Abi, 'approve', [cfg.escrow, parseUnits('1000000', 6)]);

const lastInvoice: Record<string, string> = {};
const docsDir = (id: number) => join(cfg.dataDir, 'docs', String(id));
const isoDay = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

for (let i = 0; i < COUNT; i++) {
  const scenario = MIX[i % MIX.length];
  const shipper = shippers[i % shippers.length];
  const carrier = carriers[(i * 7 + 1) % carriers.length];
  const [origin, destination, cargo] = LANES[i % LANES.length];
  const amount = amountFor(i);
  const po = `PO-${(24100 + i * 13 + Math.floor(Date.now() / 1e6) % 1000)}`;
  const now = await chainNow();
  const hash = await call(shipper, cfg.escrow, escrowAbi, 'createShipment', [carrier.address, parseUnits(String(amount), 6), BigInt(now + 3600), BigInt(now + 6 * 3600), encodeTerms({ poRef: po, origin, destination, cargo })]);
  const rc = await publicClient.waitForTransactionReceipt({ hash });
  const id = Number(BigInt(rc.logs.find(l => l.address.toLowerCase() === cfg.escrow.toLowerCase())!.topics[1]!));
  await call(carrier, cfg.escrow, escrowAbi, 'markPickedUp', [BigInt(id)]);
  await call(carrier, cfg.escrow, escrowAbi, 'markDelivered', [BigInt(id)]);
  const s = await readShipment(id);

  const invNo = scenario === 'duplicate' && lastInvoice[carrier.address] ? lastInvoice[carrier.address] : `INV-${2026}${String(1000 + id).padStart(5, '0')}`;
  lastInvoice[carrier.address] = invNo;
  const billed = scenario === 'overbilled' ? (amount * 1.18).toFixed(2) : amount.toFixed(2);
  const payee = scenario === 'wrong_payee' ? '0x9b1f6C4e3A2d5E7f8B0a1C2D3e4F5a6B7c8D9e0F' : carrier.address;
  const lane = scenario === 'wrong_lane' ? ['Istanbul, TR', 'Tbilisi, GE'] : [origin, destination];
  mkdirSync(docsDir(id), { recursive: true });
  writeFileSync(join(docsDir(id), 'invoice.txt'), [
    `${carrier.label} — FREIGHT INVOICE`, `Invoice No: ${invNo}`, `Invoice Date: ${isoDay(s.deliveredAt)}`, `Bill To: ${shipper.label}`,
    `PO: ${scenario === 'duplicate' ? po : po}`, `Origin: ${lane[0]}`, `Destination: ${lane[1]}`, `Cargo: ${cargo}`,
    `Line haul .................. ${(Number(billed) * 0.92).toFixed(2)}`, `Fuel surcharge ............. ${(Number(billed) * 0.08).toFixed(2)}`,
    `Total Due: USDC ${billed}`, `Pay To Wallet: ${payee}`, `Terms: on delivery via Haulwise escrow (Arc)`,
  ].join('\n'));
  if (scenario !== 'no_pod')
    writeFileSync(join(docsDir(id), 'pod.txt'), [`PROOF OF DELIVERY / CMR`, `Shipment ref: ${po}`, `Delivery Date: ${isoDay(s.deliveredAt)}`, `Received by: Warehouse lead, ${destination.split(',')[0]} DC`, `Condition: no visible damage`, `Packages: as per CMR`].join('\n'));
  console.log(`#${id} ${scenario.padEnd(11)} ${amount.toFixed(2)} USDC  ${origin} → ${destination}`);
}

console.log(`flows done: ${txs} transactions`);
if (RUN_AGENT) {
  const agent = new SettlementAgent(wallets);
  console.log('agent tick:', await agent.tick());
  for (const d of agent.ledger.all().slice(-COUNT)) console.log(`  #${d.shipmentId} ${d.action.padEnd(16)} ${d.txHash ?? ''} ${d.rationale.slice(0, 110)}`);
}
