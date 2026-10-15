import { createHash } from 'node:crypto';
import type { Finding, InvoiceFields, Reputation, Shipment, Terms } from './types.js';

const norm = (s?: string) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const usdc = (v: bigint) => Number(v) / 1e6;
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const day = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);

export function invoiceFingerprint(carrier: string, f: InvoiceFields): string {
  return createHash('sha256')
    .update(`${carrier.toLowerCase()}|${norm(f.invoiceNumber)}`)
    .digest('hex')
    .slice(0, 16);
}

export interface MatchContext {
  shipment: Shipment;
  terms: Terms | null;
  fields: InvoiceFields;
  reputation: Reputation;
  amountTolerance: number;
  /** fingerprint -> shipmentId it was first seen on */
  seenInvoices: Record<string, number>;
  hasPod: boolean;
}

/** Three-way match: escrow terms (the PO) vs carrier invoice vs proof of delivery. */
export function reconcile(c: MatchContext): Finding[] {
  const { shipment: s, terms, fields: f } = c;
  const out: Finding[] = [];
  const add = (check: string, severity: Finding['severity'], detail: string) => out.push({ check, severity, detail });

  // Amount
  const escrow = usdc(s.amount);
  if (f.amountUSDC === undefined) add('amount', 'warn', 'No total found on invoice');
  else if (f.amountUSDC > escrow * (1 + c.amountTolerance) + 1e-9)
    add('amount', 'fail', `Invoice bills ${f.amountUSDC} USDC, escrow holds ${escrow} USDC`);
  else if (f.amountUSDC < escrow) add('amount', 'warn', `Invoice ${f.amountUSDC} USDC is below escrow ${escrow} USDC; release would overpay`);
  else add('amount', 'ok', `${f.amountUSDC} USDC matches escrow`);

  // Payee wallet
  if (!f.payee) add('payee', 'warn', 'Invoice does not state a payout wallet');
  else if (f.payee.toLowerCase() !== s.carrier.toLowerCase())
    add('payee', 'fail', `Invoice pays to ${short(f.payee)}, escrow carrier is ${short(s.carrier)}`);
  else add('payee', 'ok', 'Payout wallet matches carrier on escrow');

  // PO reference and lane
  if (terms) {
    if (!f.poRef) add('po_ref', 'warn', 'Invoice has no PO reference');
    else if (norm(f.poRef) !== norm(terms.poRef)) add('po_ref', 'fail', `Invoice references ${f.poRef}, escrow is for ${terms.poRef}`);
    else add('po_ref', 'ok', `PO ${terms.poRef}`);

    const laneOk = (a?: string, b?: string) => !!a && !!b && (norm(a).includes(norm(b)) || norm(b).includes(norm(a)));
    if (!f.origin || !f.destination) add('lane', 'warn', 'Invoice lane incomplete');
    else if (!laneOk(f.origin, terms.origin) || !laneOk(f.destination, terms.destination))
      add('lane', 'fail', `Invoice lane ${f.origin} -> ${f.destination}, booked ${terms.origin} -> ${terms.destination}`);
    else add('lane', 'ok', `${terms.origin} -> ${terms.destination}`);
  } else add('terms', 'warn', 'Shipment has no structured terms; matched on amount and wallet only');

  // Proof of delivery
  if (!c.hasPod) add('pod', 'fail', 'No proof of delivery on file');
  else if (!f.podSignedBy) add('pod', 'warn', 'POD has no consignee signature line');
  else add('pod', 'ok', `POD signed by ${f.podSignedBy}`);

  if (f.podDate && s.pickedUpAt) {
    if (f.podDate < day(s.pickedUpAt)) add('pod_date', 'fail', `POD dated ${f.podDate}, before on-chain pickup ${day(s.pickedUpAt)}`);
    else if (s.deliveredAt && f.podDate > day(s.deliveredAt)) add('pod_date', 'warn', `POD dated ${f.podDate}, after on-chain delivery mark ${day(s.deliveredAt)}`);
    else add('pod_date', 'ok', `POD date ${f.podDate} consistent with chain`);
  }

  // Timing
  if (s.deliveredAt && s.deliveredAt > s.deliveryDeadline) {
    const h = Math.round((s.deliveredAt - s.deliveryDeadline) / 3600);
    add('on_time', 'warn', `Delivered ${h}h after deadline`);
  } else if (s.deliveredAt) add('on_time', 'ok', 'Delivered before deadline');

  // Duplicate invoice
  const fp = invoiceFingerprint(s.carrier, f);
  const prior = c.seenInvoices[fp];
  if (f.invoiceNumber && prior !== undefined && prior !== s.id)
    add('duplicate', 'fail', `Invoice ${f.invoiceNumber} was already presented on shipment #${prior}`);

  // Counterparty history
  const r = c.reputation;
  if (r.completed > 0 && r.disputed / r.completed > 0.25)
    add('carrier_history', 'warn', `Carrier dispute rate ${r.disputed}/${r.completed}`);

  return out;
}

/** On-chain dispute reasons are capped at 256 bytes by the contract. */
export function clampBytes(text: string, max = 256): string {
  let out = text;
  while (Buffer.byteLength(out, 'utf8') > max) out = out.slice(0, -2);
  return out === text ? out : out.slice(0, -3) + '...';
}

export function disputeReason(invoiceNumber: string | undefined, findings: Finding[]): string {
  const fails = findings.filter(f => f.severity === 'fail').map(f => f.detail);
  return clampBytes(`Invoice ${invoiceNumber ?? '(unnumbered)'} rejected. ${fails.join('. ')}.`);
}
