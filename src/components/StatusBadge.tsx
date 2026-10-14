import { ShipmentStatus, STATUS_LABEL } from '../types/cargo';

interface StatusBadgeProps {
  status: ShipmentStatus;
  size?: 'sm' | 'md';
}

const TONE: Record<ShipmentStatus, string> = {
  [ShipmentStatus.Created]: 'bg-[var(--surface-muted)] text-[var(--muted)] border-[var(--border)]',
  [ShipmentStatus.PickedUp]: 'bg-[var(--accent-soft)] text-[var(--accent)] border-[#cfdcfa]',
  [ShipmentStatus.Delivered]: 'bg-[var(--warning-soft)] text-[var(--warning)] border-[#f2dcb5]',
  [ShipmentStatus.Released]: 'bg-[var(--success-soft)] text-[var(--success)] border-[#c4e6d4]',
  [ShipmentStatus.Disputed]: 'bg-[var(--danger-soft)] text-[var(--danger)] border-[#f3c9cd]',
  [ShipmentStatus.Cancelled]: 'bg-[var(--surface-muted)] text-[var(--subtle)] border-[var(--border)]',
  [ShipmentStatus.Resolved]: 'bg-[var(--success-soft)] text-[var(--success)] border-[#c4e6d4]',
  [ShipmentStatus.Refunded]: 'bg-[var(--surface-muted)] text-[var(--ink-2)] border-[var(--border-strong)]',
};

export default function StatusBadge({ status, size = 'md' }: StatusBadgeProps) {
  const sz = size === 'sm' ? 'text-[11px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded border font-500 whitespace-nowrap ${sz} ${TONE[status]}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />
      {STATUS_LABEL[status]}
    </span>
  );
}
