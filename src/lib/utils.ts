import { ShipmentStatus } from '../types/cargo';

export function formatAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function formatUSDC(amount: bigint): string {
  const num = Number(amount) / 1_000_000;
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

export function parseUSDC(value: string): bigint {
  const num = parseFloat(value);
  if (isNaN(num) || num <= 0) return 0n;
  return BigInt(Math.round(num * 1_000_000));
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
  const releaseAt = Number(deliveredAt) + 48 * 3600;
  const now = Math.floor(Date.now() / 1000);
  const diff = releaseAt - now;
  if (diff <= 0) return 'Auto-release available now';
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  return `Auto-release in ${h}h ${m}m`;
}

export function isOverdue(deadline: bigint): boolean {
  return Number(deadline) < Math.floor(Date.now() / 1000);
}

export function isAutoReleaseReady(deliveredAt: bigint): boolean {
  return Date.now() / 1000 >= Number(deliveredAt) + 48 * 3600;
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
    default: return 'bg-[var(--muted)]';
  }
}

export function parseOnchainError(error: unknown): string {
  const msg = (error as { message?: string })?.message?.toLowerCase() ?? '';
  if (msg.includes('user rejected') || (error as { code?: number })?.code === 4001)
    return 'Transaction cancelled.';
  if (msg.includes('insufficient')) return 'Insufficient USDC balance.';
  if (msg.includes('reverted')) {
    const m = msg.match(/reason="([^"]+)"/);
    return m ? `Failed: ${m[1]}` : 'Transaction failed.';
  }
  if (msg.includes('network') || msg.includes('timeout'))
    return 'Network error. Please retry.';
  return 'Something went wrong. Please try again.';
}
