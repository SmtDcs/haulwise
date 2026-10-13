import { Shipment, ShipmentStatus } from '../types/cargo';
import { formatAddress, formatUSDC, formatCountdown, isOverdue, isAutoReleaseReady } from '../lib/utils';
import StatusBadge from './StatusBadge';
import { ChevronRight, Clock, AlertCircle } from 'lucide-react';

interface ShipmentCardProps {
  shipment: Shipment;
  viewerAddress?: `0x${string}`;
  onClick: () => void;
}

export default function ShipmentCard({ shipment, viewerAddress, onClick }: ShipmentCardProps) {
  const overdue = isOverdue(shipment.deadline) && shipment.status === ShipmentStatus.Created;
  const autoRelReady = shipment.status === ShipmentStatus.Delivered && isAutoReleaseReady(shipment.deliveredAt);
  const isShipper = viewerAddress?.toLowerCase() === shipment.shipper.toLowerCase();

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-xl border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-strong)] transition-colors p-4 group"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="display text-sm font-600 text-[var(--accent)]">#{Number(shipment.id)}</span>
            <StatusBadge status={shipment.status} size="sm" />
            {overdue && (
              <span className="flex items-center gap-1 text-xs text-[var(--danger)]">
                <AlertCircle size={11} /> Overdue
              </span>
            )}
            {autoRelReady && (
              <span className="flex items-center gap-1 text-xs text-[var(--warning)]">
                <Clock size={11} /> Release ready
              </span>
            )}
          </div>

          <div className="flex items-center gap-4 text-xs text-[var(--subtle)]">
            <span>{isShipper ? 'To' : 'From'}: <span className="mono text-[var(--muted)]">{formatAddress(isShipper ? shipment.carrier : shipment.shipper)}</span></span>
            <span className="tabular-nums font-600 text-[var(--ink-2)] text-sm">${formatUSDC(shipment.amount)} USDC</span>
          </div>

          {shipment.status === ShipmentStatus.Created && !overdue && (
            <div className="flex items-center gap-1 mt-1.5 text-xs text-[var(--subtle)]">
              <Clock size={11} />
              <span className="tabular-nums">{formatCountdown(shipment.deadline)}</span>
            </div>
          )}
          {shipment.status === ShipmentStatus.Delivered && (
            <div className="text-xs text-[var(--warning)] mt-1.5 tabular-nums">
              {isAutoReleaseReady(shipment.deliveredAt) ? 'Auto-release available' : formatAutoReleaseCountdown(shipment.deliveredAt)}
            </div>
          )}
        </div>
        <ChevronRight size={16} className="text-[var(--subtle)] group-hover:text-[var(--muted)] shrink-0 mt-1 transition-colors" />
      </div>
    </button>
  );
}

function formatAutoReleaseCountdown(deliveredAt: bigint): string {
  const releaseAt = Number(deliveredAt) + 48 * 3600;
  const now = Math.floor(Date.now() / 1000);
  const diff = releaseAt - now;
  if (diff <= 0) return 'Auto-release available';
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  return `Auto-release in ${h}h ${m}m`;
}
