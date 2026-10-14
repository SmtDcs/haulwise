import { formatUnits, parseUnits, BaseError, ContractFunctionRevertedError } from 'viem';
import { ShipmentStatus } from '../types/cargo';
import { USDC_DECIMALS } from '../onchain-facts';

// Mirrors the contract constants.
export const PROTOCOL_FEE_BPS = 50n;
export const AUTO_RELEASE_DELAY_S = 48 * 3600;
export const REFUND_UNDELIVERED_DELAY_S = 7 * 86400;
export const ESCALATE_TIMEOUT_DELAY_S = 14 * 86400;

export function netOfFee(amount: bigint): bigint {
  return amount - (amount * PROTOCOL_FEE_BPS) / 10_000n;
}

export function formatAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function formatUSDC(amount: bigint): string {
  // Format from the exact decimal string; never route base units through a float.
  const [whole, frac = ''] = formatUnits(amount, USDC_DECIMALS).split('.');
  const cents = (frac + '00').slice(0, 2);
  return `${BigInt(whole).toLocaleString('en-US')}.${cents}`;
}

/** Parses a user-entered USDC amount. Returns 0n for anything invalid or with more than 6 decimals. */
export function parseUSDC(value: string): bigint {
  const v = value.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(v)) return 0n;
  try {
    return parseUnits(v, USDC_DECIMALS);
  } catch {
    return 0n;
  }
}

export function formatCountdown(deadline: bigint): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = Number(deadline) - now;
  if (diff <= 0) return 'Expired';
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return `${h}h ${m}m ${s}s`;
}

export function formatAutoReleaseCountdown(deliveredAt: bigint): string {
  const releaseAt = Number(deliveredAt) + AUTO_RELEASE_DELAY_S;
  const now = Math.floor(Date.now() / 1000);
  const diff = releaseAt - now;
  if (diff <= 0) return 'Auto-release available now';
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  return `Auto-release in ${h}h ${m}m`;
}

export function formatRefundCountdown(deliveryDeadline: bigint): string {
  const refundAt = Number(deliveryDeadline) + REFUND_UNDELIVERED_DELAY_S;
  const now = Math.floor(Date.now() / 1000);
  const diff = refundAt - now;
  if (diff <= 0) return 'Refund available now';
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  return `Refund eligible in ${d}d ${h}h`;
}

export function formatEscalateCountdown(disputedAt: bigint): string {
  const escalateAt = Number(disputedAt) + ESCALATE_TIMEOUT_DELAY_S;
  const now = Math.floor(Date.now() / 1000);
  const diff = escalateAt - now;
  if (diff <= 0) return 'Escalation available now';
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  return `Escalate in ${d}d ${h}h`;
}

export function isOverdue(deadline: bigint): boolean {
  return Number(deadline) < Math.floor(Date.now() / 1000);
}

export function isPickupOverdue(pickupDeadline: bigint): boolean {
  return Number(pickupDeadline) < Math.floor(Date.now() / 1000);
}

export function isDeliveryOverdue(deliveryDeadline: bigint): boolean {
  return Number(deliveryDeadline) < Math.floor(Date.now() / 1000);
}

export function isAutoReleaseReady(deliveredAt: bigint): boolean {
  return Date.now() / 1000 >= Number(deliveredAt) + AUTO_RELEASE_DELAY_S;
}

export function canRefundUndelivered(deliveryDeadline: bigint): boolean {
  return Math.floor(Date.now() / 1000) > Number(deliveryDeadline) + REFUND_UNDELIVERED_DELAY_S;
}

export function canEscalateDispute(disputedAt: bigint): boolean {
  return disputedAt > 0n && Math.floor(Date.now() / 1000) >= Number(disputedAt) + ESCALATE_TIMEOUT_DELAY_S;
}

export function statusColor(status: ShipmentStatus): string {
  switch (status) {
    case ShipmentStatus.Created: return 'text-[var(--muted)]';
    case ShipmentStatus.PickedUp: return 'text-[var(--accent)]';
    case ShipmentStatus.Delivered: return 'text-[var(--warning)]';
    case ShipmentStatus.Released: return 'text-[var(--success)]';
    case ShipmentStatus.Disputed: return 'text-[var(--danger)]';
    case ShipmentStatus.Cancelled: return 'text-[var(--subtle)]';
    case ShipmentStatus.Resolved: return 'text-[var(--success)]';
    case ShipmentStatus.Refunded: return 'text-[var(--danger)]';
    default: return 'text-[var(--muted)]';
  }
}

export function statusDot(status: ShipmentStatus): string {
  switch (status) {
    case ShipmentStatus.Created: return 'bg-[var(--muted)]';
    case ShipmentStatus.PickedUp: return 'bg-[var(--accent)]';
    case ShipmentStatus.Delivered: return 'bg-[var(--warning)]';
    case ShipmentStatus.Released: return 'bg-[var(--success)]';
    case ShipmentStatus.Disputed: return 'bg-[var(--danger)]';
    case ShipmentStatus.Cancelled: return 'bg-[var(--subtle)]';
    case ShipmentStatus.Resolved: return 'bg-[var(--success)]';
    case ShipmentStatus.Refunded: return 'bg-[var(--danger)]';
    default: return 'bg-[var(--muted)]';
  }
}

export function parseOnchainError(error: unknown): string {
  if (error instanceof BaseError) {
    const revert = error.walk(e => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const reason = revert.reason ?? revert.data?.errorName;
      if (reason) return reason.replace(/^CargoBill: /, '');
    }
    const msg = error.message.toLowerCase();
    if (msg.includes('user rejected') || msg.includes('user denied')) return 'Transaction cancelled.';
    if (msg.includes('transfer amount exceeds balance') || msg.includes('insufficient')) return 'Insufficient USDC balance.';
    if (msg.includes('chain mismatch') || msg.includes('does not match the target chain')) return 'Wallet is on the wrong network.';
    return error.shortMessage;
  }
  if ((error as { code?: number })?.code === 4001) return 'Transaction cancelled.';
  return 'Something went wrong. Please try again.';
}
