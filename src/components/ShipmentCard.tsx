import { Shipment, ShipmentStatus } from '../types/cargo';
import {
  formatAddress,
  formatUSDC,
  formatCountdown,
  isPickupOverdue,
  isDeliveryOverdue,
  isAutoReleaseReady,
  canRefundUndelivered,
  canEscalateDispute,
} from '../lib/utils';
import StatusBadge from './StatusBadge';
import { ChevronRight, Clock, AlertCircle } from 'lucide-react';

interface ShipmentCardProps {
  shipment: Shipment;
  viewerAddress?: `0x${string}`;
  onClick: () => void;
}

export default function ShipmentCard({ shipment, viewerAddress, onClick }: ShipmentCardProps) {
  const pickupOverdue = isPickupOverdue(shipment.pickupDeadline) && shipment.status === ShipmentStatus.Created;
  const deliveryOverdue = isDeliveryOverdue(shipment.deliveryDeadline) && shipment.status === ShipmentStatus.PickedUp;
  const refundReady = shipment.status === ShipmentStatus.PickedUp && canRefundUndelivered(shipment.deliveryDeadline);
  const autoRelReady = shipment.status === ShipmentStatus.Delivered && isAutoReleaseReady(shipment.deliveredAt);
  const escalateReady = shipment.status === ShipmentStatus.Disputed && canEscalateDispute(shipment.disputedAt);
  const isShipper = viewerAddress?.toLowerCase() === shipment.shipper.toLowerCase();

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-xl border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-strong)] transition-colors p-4 group"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="display text-sm font-600 text-[var(--accent)]">#{Number(shipment.id)}</span>
            <StatusBadge status={shipment.status} size="sm" />
            {pickupOverdue && (
              <span className="flex items-center gap-1 text-xs text-[var(--danger)]">
                <AlertCircle size={11} /> Pickup overdue
              </span>
            )}
            {refundReady && (
              <span className="flex items-center gap-1 text-xs text-[var(--danger)] font-600">
                <AlertCircle size={11} /> Refund available
              </span>
            )}
            {!refundReady && deliveryOverdue && (
              <span className="flex items-center gap-1 text-xs text-[var(--warning)]">
                <AlertCircle size={11} /> Delivery overdue
              </span>
            )}
            {escalateReady && (
              <span className="flex items-center gap-1 text-xs text-[var(--warning)] font-600">
                <Clock size={11} /> Escalation ready
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

          {shipment.status === ShipmentStatus.Created && (
            <div className="flex items-center gap-1 mt-1.5 text-xs text-[var(--subtle)]">
              <Clock size={11} />
              <span>Pickup: <span className="tabular-nums">{pickupOverdue ? 'Overdue (cancellable)' : formatCountdown(shipment.pickupDeadline)}</span></span>
            </div>
          )}
          {shipment.status === ShipmentStatus.PickedUp && (
            <div className="flex items-center gap-1 mt-1.5 text-xs text-[var(--subtle)]">
              <Clock size={11} />
              <span>Delivery: <span className="tabular-nums">{deliveryOverdue ? 'Past deadline' : formatCountdown(shipment.deliveryDeadline)}</span></span>
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
