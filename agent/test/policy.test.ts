import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluate, isAutoReleaseDue } from '../src/policy.js';
import { clampBytes, disputeReason, invoiceFingerprint, reconcile } from '../src/matcher.js';
import { encodeTerms, extractFields, parseTerms } from '../src/invoice.js';
import { Ledger } from '../src/ledger.js';
import { DEFAULT_POLICY, Status, type Finding, type Shipment } from '../src/types.js';

const CARRIER = '0xA250cc0B4a165B00A3cD525eeb9f6e8dF1704D07';
const T0 = Date.UTC(2026, 9, 14, 8) / 1000;
const terms = { poRef: 'PO-24139', origin: 'Bursa, TR', destination: 'Hamburg, DE', cargo: '18 pallets' };
const ship = (o: Partial<Shipment> = {}): Shipment => ({
  id: 7, shipper: '0xED07e1d7b0e86Ca179e591B5713c1FA983b8dAaD', carrier: CARRIER, amount: 120_000000n,
  pickupDeadline: T0 + 3600, deliveryDeadline: T0 + 86400, metadataURI: encodeTerms(terms), status: Status.Delivered,
  pickedUpAt: T0 + 600, deliveredAt: T0 + 80000, disputeReason: '', disputedAt: 0, ...o,
});
const invoice = (o: Record<string, string> = {}) => [
  'Carrier 1 — FREIGHT INVOICE', `Invoice No: ${o.no ?? 'INV-2026001'}`, 'Invoice Date: 2026-10-15', 'Bill To: Shipper A (textile exporter, Bursa)',
  `PO: ${o.po ?? 'PO-24139'}`, `Origin: ${o.origin ?? 'Bursa, TR'}`, `Destination: ${o.dest ?? 'Hamburg, DE'}`,
  `Total Due: ${o.total ?? 'USDC 120.00'}`, `Pay To Wallet: ${o.payee ?? CARRIER}`,
].join('\n');
const POD = 'PROOF OF DELIVERY\nDelivery Date: 15.10.2026\nReceived by: M. Weber, Hamburg DC';
const rep = { completed: 5, disputed: 0, late: 0 };
const match = (inv: string, s = ship(), seen: Record<string, number> = {}, pod: string | null = POD) =>
  reconcile({ shipment: s, terms: parseTerms(s.metadataURI), fields: extractFields(inv, pod ?? ''), reputation: rep, amountTolerance: 0, seenInvoices: seen, hasPod: pod !== null });
const fails = (f: Finding[]) => f.filter(x => x.severity === 'fail').map(x => x.check);
const policyCtx = (findings: Finding[], s = ship(), o = {}) => ({ shipment: s, findings, reputation: rep, confirmedLast24h: 0, now: T0 + 90000, ...o });

describe('invoice extraction', () => {
  it('reads the fields an AP clerk would', () => {
    const f = extractFields(invoice(), POD);
    expect(f).toMatchObject({ invoiceNumber: 'INV-2026001', amountUSDC: 120, payee: CARRIER, poRef: 'PO-24139', origin: 'Bursa, TR', destination: 'Hamburg, DE', invoiceDate: '2026-10-15', podDate: '2026-10-15', podSignedBy: 'M. Weber, Hamburg DC' });
  });
  it('handles EU number format and does not read "Bill To" as destination', () => {
    const f = extractFields(invoice({ total: '€ 1.250,50' }));
    expect(f.amountUSDC).toBe(1250.5);
    expect(f.destination).toBe('Hamburg, DE');
  });
  it('does not mistake words containing "po" for a PO reference', () => {
    expect(extractFields('Bill To: Shipper A (textile exporter)\nTotal: 5').poRef).toBeUndefined();
  });
});

describe('three-way match', () => {
  it('passes a clean invoice', () => expect(fails(match(invoice()))).toEqual([]));
  it('catches over-billing', () => expect(fails(match(invoice({ total: 'USDC 141.60' })))).toContain('amount'));
  it('catches a changed payout wallet (invoice redirection fraud)', () => expect(fails(match(invoice({ payee: '0x9b1f6C4e3A2d5E7f8B0a1C2D3e4F5a6B7c8D9e0F' })))).toContain('payee'));
  it('catches the wrong PO and the wrong lane', () => expect(fails(match(invoice({ po: 'PO-99999', dest: 'Tbilisi, GE' })))).toEqual(expect.arrayContaining(['po_ref', 'lane'])));
  it('requires a proof of delivery', () => expect(fails(match(invoice(), ship(), {}, null))).toContain('pod'));
  it('rejects a POD dated before pickup', () => expect(fails(match(invoice(), ship(), {}, 'Delivery Date: 2026-10-01\nReceived by: X'))).toContain('pod_date'));
  it('catches the same invoice presented on a second shipment', () => {
    const seen: Record<string, number> = {};
    seen[invoiceFingerprint(CARRIER, extractFields(invoice()))] = 3;
    expect(fails(match(invoice(), ship(), seen))).toContain('duplicate');
  });
});

describe('spending policy', () => {
  const clean = match(invoice());
  it('lets the agent confirm a clean, in-limit shipment', () => expect(evaluate(DEFAULT_POLICY, policyCtx(clean)).kind).toBe('confirm'));
  it('escalates above the per-shipment limit', () => {
    const v = evaluate(DEFAULT_POLICY, policyCtx(clean, ship({ amount: 900_000000n })));
    expect(v.kind).toBe('needs_approval');
  });
  it('escalates when the rolling 24h cap would be exceeded', () => expect(evaluate(DEFAULT_POLICY, policyCtx(clean, ship(), { confirmedLast24h: 950 })).kind).toBe('needs_approval'));
  it('limits new carriers', () => expect(evaluate(DEFAULT_POLICY, policyCtx(clean, ship(), { reputation: { completed: 0, disputed: 0, late: 0 } })).kind).toBe('needs_approval'));
  it('sends late deliveries to a human', () => {
    const late = ship({ deliveredAt: T0 + 86400 + 20 * 3600 });
    expect(evaluate(DEFAULT_POLICY, policyCtx(match(invoice(), late), late)).kind).toBe('needs_approval');
  });
  it('disputes hard failures, or asks first when autoDispute is off', () => {
    const bad = match(invoice({ total: 'USDC 200' }));
    expect(evaluate(DEFAULT_POLICY, policyCtx(bad)).kind).toBe('dispute');
    expect(evaluate({ ...DEFAULT_POLICY, autoDispute: false }, policyCtx(bad)).kind).toBe('needs_approval');
  });
  it('holds (does not dispute) when only the POD is missing', () => expect(evaluate(DEFAULT_POLICY, policyCtx(match(invoice(), ship(), {}, null))).kind).toBe('hold'));
  it('never auto-confirms a blocked carrier', () => expect(evaluate({ ...DEFAULT_POLICY, blockedCarriers: [CARRIER.toLowerCase()] }, policyCtx(clean)).kind).toBe('needs_approval'));
  it('knows when autoRelease is callable', () => {
    expect(isAutoReleaseDue(ship(), ship().deliveredAt + 47 * 3600)).toBe(false);
    expect(isAutoReleaseDue(ship(), ship().deliveredAt + 48 * 3600)).toBe(true);
  });
});

describe('on-chain dispute reason', () => {
  it('fits the 256-byte contract limit even with multi-byte text', () => {
    expect(Buffer.byteLength(clampBytes('ş'.repeat(400)))).toBeLessThanOrEqual(256);
    const r = disputeReason('INV-1', match(invoice({ total: 'USDC 999', payee: '0x9b1f6C4e3A2d5E7f8B0a1C2D3e4F5a6B7c8D9e0F', po: 'PO-1', dest: 'Tbilisi, GE' })));
    expect(Buffer.byteLength(r)).toBeLessThanOrEqual(256);
  });
});

describe('decision ledger', () => {
  it('detects an edited entry', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'hw-')), 'log.jsonl');
    const l = new Ledger(file);
    l.append({ action: 'confirm', rationale: 'ok', planner: 'rules', amountUSDC: 10 });
    l.append({ action: 'dispute', rationale: 'bad', planner: 'rules' });
    expect(l.verify().ok).toBe(true);
    writeFileSync(file, readFileSync(file, 'utf8').replace('"amountUSDC":10', '"amountUSDC":1000'));
    expect(new Ledger(file).verify()).toEqual({ ok: false, brokenAt: 1 });
  });
});
