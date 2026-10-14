import { useState, useEffect, useRef } from 'react';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { toast } from 'sonner';
import { ShipmentStatus, AgentLog } from '../types/cargo';
import { CARGOBILL_ABI, CARGOBILL_ADDRESS } from '../lib/cargobill';
import { CHAIN_ID } from '../config';
import { buildTxExplorerUrl } from '@/onchain-facts';
import {
  formatUSDC,
  formatAddress,
  formatCountdown,
  formatRefundCountdown,
  formatEscalateCountdown,
  isAutoReleaseReady,
  canRefundUndelivered,
  canEscalateDispute,
  parseOnchainError,
  AUTO_RELEASE_DELAY_S
} from '../lib/utils';
import { useShipment } from '../hooks/useShipments';
import { useNowSec } from '../hooks/useNow';
import StatusBadge from './StatusBadge';
import { X, Check, ExternalLink, Truck, CheckCircle, Clock, AlertTriangle, RotateCcw, Scale } from 'lucide-react';

interface ShipmentDetailProps {
  shipmentId: number;
  viewerAddress?: `0x${string}`;
  onClose: () => void;
  refetch: () => void;
  addLog: (entry: Omit<AgentLog, 'id' | 'timestamp'>) => void;
}

type ActionType = 'pickup' | 'deliver' | 'confirm' | 'autorelease' | 'dispute' | 'cancel' | 'refund' | 'escalate';

export default function ShipmentDetail({ shipmentId, viewerAddress, onClose, refetch, addLog }: ShipmentDetailProps) {
  const { shipment, refetch: refetchDetail } = useShipment(shipmentId);
  const nowSec = useNowSec();
  const [disputeReason, setDisputeReason] = useState('');
  const [showDisputeInput, setShowDisputeInput] = useState(false);

  const { writeContract, data: txHash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  // Only log an action once its transaction is confirmed onchain.
  const pendingLogRef = useRef<string | null>(null);

  useEffect(() => {
    if (isSuccess) {
      toast.success('Transaction confirmed');
      if (pendingLogRef.current) {
        addLog({ type: 'action', shipmentId, message: pendingLogRef.current });
        pendingLogRef.current = null;
      }
      void refetchDetail();
      refetch();
    }
  }, [isSuccess, refetchDetail, refetch, addLog, shipmentId]);

  useEffect(() => {
    if (error) {
      pendingLogRef.current = null;
      toast.error(parseOnchainError(error));
    }
  }, [error]);

  if (!shipment) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(17,24,39,0.45)] p-4">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-8 text-center">
          <div className="text-[var(--subtle)]">Loading...</div>
        </div>
      </div>
    );
  }

  const isShipper = viewerAddress?.toLowerCase() === shipment.shipper.toLowerCase();
  const isCarrier = viewerAddress?.toLowerCase() === shipment.carrier.toLowerCase();
  const canCancel = isShipper && shipment.status === ShipmentStatus.Created && nowSec >= Number(shipment.pickupDeadline);
  const refundEligible = isShipper && shipment.status === ShipmentStatus.PickedUp && canRefundUndelivered(shipment.deliveryDeadline);
  const escalateEligible = shipment.status === ShipmentStatus.Disputed && canEscalateDispute(shipment.disputedAt);

  function doAction(action: ActionType) {
    const args: [bigint] = [BigInt(shipmentId)];
    const fnMap: Record<ActionType, string> = {
      pickup: 'markPickedUp',
      deliver: 'markDelivered',
      confirm: 'confirmDelivery',
      autorelease: 'autoRelease',
      dispute: 'openDispute',
      cancel: 'cancel',
      refund: 'refundUndelivered',
      escalate: 'escalateTimeout',
    };

    if (action === 'dispute') {
      if (!disputeReason.trim()) { toast.error('Enter a dispute reason'); return; }
      if (new TextEncoder().encode(disputeReason).length > 256) {
        toast.error('Dispute reason must be 256 bytes or fewer');
        return;
      }
      writeContract({
        address: CARGOBILL_ADDRESS,
        abi: CARGOBILL_ABI,
        functionName: 'openDispute',
        args: [BigInt(shipmentId), disputeReason],
        chainId: CHAIN_ID,
      });
      pendingLogRef.current = `Dispute opened on shipment #${shipmentId}: "${disputeReason}"`;
      return;
    }

    writeContract({
      address: CARGOBILL_ADDRESS,
      abi: CARGOBILL_ABI,
      functionName: fnMap[action] as
        | 'markPickedUp'
        | 'markDelivered'
        | 'confirmDelivery'
        | 'autoRelease'
        | 'cancel'
        | 'refundUndelivered'
        | 'escalateTimeout',
      args,
      chainId: CHAIN_ID,
    });

    const logMap: Record<ActionType, string> = {
      pickup: `Carrier marked shipment #${shipmentId} as picked up`,
      deliver: `Carrier marked shipment #${shipmentId} as delivered`,
      confirm: `Shipper confirmed delivery for shipment #${shipmentId}; funds released`,
      autorelease: `Auto-release triggered for shipment #${shipmentId}`,
      dispute: '',
      cancel: `Shipment #${shipmentId} cancelled; escrow refunded`,
      refund: `Shipper claimed refund for undelivered shipment #${shipmentId}`,
      escalate: `Dispute timeout escalated for shipment #${shipmentId} (50/50 split)`,
    };
    pendingLogRef.current = logMap[action];
  }

  const busy = isPending || isConfirming;
  const isFinalStatus = [ShipmentStatus.Released, ShipmentStatus.Resolved, ShipmentStatus.Cancelled, ShipmentStatus.Refunded].includes(shipment.status);

  const fmt = (t: bigint) => (t > 0n ? new Date(Number(t) * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');
  const st = shipment.status;
  const pickedStates = [ShipmentStatus.PickedUp, ShipmentStatus.Delivered, ShipmentStatus.Released, ShipmentStatus.Disputed, ShipmentStatus.Resolved, ShipmentStatus.Refunded];
  type Step = { label: string; done: boolean; meta: string; tone?: 'bad' };
  const timeline: Step[] = [
    { label: 'Escrow funded', done: true, meta: '' },
    {
      label: 'Picked up',
      done: pickedStates.includes(st) && shipment.pickedUpAt > 0n,
      meta: shipment.pickedUpAt > 0n ? fmt(shipment.pickedUpAt) : `due ${fmt(shipment.pickupDeadline)}`,
    },
    {
      label: 'Delivered',
      done: shipment.deliveredAt > 0n,
      meta: shipment.deliveredAt > 0n ? fmt(shipment.deliveredAt) : `due ${fmt(shipment.deliveryDeadline)}`,
    },
  ];
  if (st === ShipmentStatus.Disputed || st === ShipmentStatus.Resolved) {
    timeline.push({ label: 'Dispute opened', done: true, meta: fmt(shipment.disputedAt), tone: 'bad' });
  }
  if (st === ShipmentStatus.Cancelled) timeline.push({ label: 'Cancelled, escrow returned', done: true, meta: '', tone: 'bad' });
  else if (st === ShipmentStatus.Refunded) timeline.push({ label: 'Refunded to shipper', done: true, meta: '', tone: 'bad' });
  else if (st === ShipmentStatus.Resolved) timeline.push({ label: 'Resolved by arbiter', done: true, meta: '' });
  else timeline.push({ label: 'Payment released', done: st === ShipmentStatus.Released, meta: '' });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[rgba(17,24,39,0.45)] p-4">
      <div className="w-full max-w-lg rounded-lg border border-[var(--border)] bg-[var(--surface)] overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-[var(--border)]">
          <div className="flex items-center gap-3">
            <span className="display text-lg font-700 text-[var(--accent)]">#{shipmentId}</span>
            <StatusBadge status={shipment.status} />
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[var(--surface)] text-[var(--subtle)] transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          <div className="rounded-lg bg-[var(--surface-muted)] p-4">
            <div className="text-xs text-[var(--subtle)] mb-1">Escrowed Amount</div>
            <div className="text-3xl font-600 tabular-nums tracking-tight text-[var(--ink)]">${formatUSDC(shipment.amount)}</div>
            <div className="text-xs text-[var(--subtle)] mt-0.5">USDC · 0.5% protocol fee on release</div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-[var(--border)] p-3">
              <div className="text-xs text-[var(--subtle)] mb-1">Shipper</div>
              <div className="mono text-sm text-[var(--ink-2)]">{formatAddress(shipment.shipper)}</div>
              {isShipper && <div className="text-xs text-[var(--accent)] mt-0.5">You</div>}
            </div>
            <div className="rounded-lg border border-[var(--border)] p-3">
              <div className="text-xs text-[var(--subtle)] mb-1">Carrier</div>
              <div className="mono text-sm text-[var(--ink-2)]">{formatAddress(shipment.carrier)}</div>
              {isCarrier && <div className="text-xs text-[var(--accent)] mt-0.5">You</div>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
              <div className="text-xs text-[var(--subtle)] mb-1 flex items-center gap-1">
                <Clock size={12} /> Pickup Deadline
              </div>
              <div className="text-xs text-[var(--ink-2)] font-500">
                {new Date(Number(shipment.pickupDeadline) * 1000).toLocaleString()}
              </div>
              {shipment.status === ShipmentStatus.Created && (
                <div className="text-[11px] text-[var(--warning)] mt-1">
                  {nowSec >= Number(shipment.pickupDeadline) ? 'Overdue · Shipper may cancel' : `Due in ${formatCountdown(shipment.pickupDeadline)}`}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
              <div className="text-xs text-[var(--subtle)] mb-1 flex items-center gap-1">
                <Clock size={12} /> Delivery Deadline
              </div>
              <div className="text-xs text-[var(--ink-2)] font-500">
                {new Date(Number(shipment.deliveryDeadline) * 1000).toLocaleString()}
              </div>
              {shipment.status === ShipmentStatus.PickedUp && (
                <div className="text-[11px] text-[var(--warning)] mt-1">
                  {nowSec >= Number(shipment.deliveryDeadline) ? 'Past delivery deadline' : `Due in ${formatCountdown(shipment.deliveryDeadline)}`}
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="eyebrow mb-3">Timeline</div>
            <ol className="relative">
              {timeline.map((step, i) => {
                const last = i === timeline.length - 1;
                const tone = step.tone === 'bad' ? 'bg-[var(--danger)] border-[var(--danger)]' : step.done ? 'bg-[var(--ink)] border-[var(--ink)]' : 'bg-[var(--surface)] border-[var(--border-strong)]';
                return (
                  <li key={step.label} className="relative flex gap-3 pb-4 last:pb-0">
                    {!last && <span className={`absolute left-[7px] top-4 bottom-0 w-px ${step.done && timeline[i + 1].done ? 'bg-[var(--ink)]' : 'bg-[var(--border)]'}`} />}
                    <span className={`relative mt-0.5 w-[15px] h-[15px] rounded-full border-2 shrink-0 flex items-center justify-center ${tone}`}>
                      {step.done && <Check size={9} strokeWidth={3} className="text-white" />}
                    </span>
                    <div className="flex-1 min-w-0 flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className={`text-sm ${step.done ? 'text-[var(--ink)] font-500' : 'text-[var(--subtle)]'}`}>{step.label}</span>
                      <span className="text-xs text-[var(--subtle)] tabular-nums">{step.meta}</span>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>

          {shipment.status === ShipmentStatus.Disputed && (
            <div className="rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] p-3 space-y-2">
              <div className="flex items-center gap-1.5 text-[var(--danger)] text-xs font-600">
                <AlertTriangle size={12} /> Dispute Under Review
              </div>
              {shipment.disputeReason && (
                <p className="text-sm text-[var(--ink-2)]">{shipment.disputeReason}</p>
              )}
              {shipment.disputedAt > 0n && (
                <div className="text-xs text-[var(--muted)]">
                  Disputed on {new Date(Number(shipment.disputedAt) * 1000).toLocaleString()}.
                  {' '}
                  {escalateEligible
                    ? '14-day timeout reached: Anyone can trigger 50/50 escalation split.'
                    : formatEscalateCountdown(shipment.disputedAt)}
                </div>
              )}
            </div>
          )}

          {shipment.status === ShipmentStatus.PickedUp && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-xs text-[var(--muted)]">
              {refundEligible ? (
                <span className="text-[var(--danger)] font-500">
                  Delivery deadline + 7-day grace period expired. Shipper can claim full refund.
                </span>
              ) : (
                <span>
                  Carrier in transit. {formatRefundCountdown(shipment.deliveryDeadline)}
                </span>
              )}
            </div>
          )}

          {shipment.status === ShipmentStatus.Delivered && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-sm text-[var(--muted)]">
              <Clock size={14} className="inline mr-1.5 text-[var(--warning)]" />
              {isAutoReleaseReady(shipment.deliveredAt)
                ? 'Auto-release is available. Anyone can trigger it.'
                : `Auto-release in ${formatAutoReleaseCountdown(shipment.deliveredAt)} if shipper doesn't confirm.`}
            </div>
          )}

          {shipment.metadataURI && (
            <div className="text-xs text-[var(--subtle)]">
              <span className="font-500">Metadata: </span>
              {/^https:\/\//i.test(shipment.metadataURI) ? (
                <a href={shipment.metadataURI} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline break-all">
                  {shipment.metadataURI.slice(0, 60)}{shipment.metadataURI.length > 60 ? '…' : ''}
                  <ExternalLink size={10} className="inline ml-0.5" />
                </a>
              ) : (
                <span className="break-all">{shipment.metadataURI}</span>
              )}
            </div>
          )}

          {txHash && (
            <a
              href={buildTxExplorerUrl(CHAIN_ID, txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-[var(--accent)] hover:underline"
            >
              <ExternalLink size={12} /> View last transaction
            </a>
          )}
        </div>

        {!isFinalStatus && (
          <div className="p-5 border-t border-[var(--border)] space-y-2">
            {isCarrier && shipment.status === ShipmentStatus.Created && (
              <button
                onClick={() => doAction('pickup')}
                disabled={busy || nowSec > Number(shipment.pickupDeadline)}
                className="w-full py-2.5 rounded-lg bg-[var(--accent)] text-white font-600 text-sm hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors min-h-[44px] flex items-center justify-center gap-2"
              >
                <Truck size={16} />
                {nowSec > Number(shipment.pickupDeadline)
                  ? 'Pickup deadline passed'
                  : isPending ? 'Confirm in wallet…' : isConfirming ? 'Confirming…' : 'Mark Picked Up'}
              </button>
            )}

            {isCarrier && shipment.status === ShipmentStatus.PickedUp && (
              <button
                onClick={() => doAction('deliver')}
                disabled={busy}
                className="w-full py-2.5 rounded-lg bg-[var(--accent)] text-white font-600 text-sm hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors min-h-[44px] flex items-center justify-center gap-2"
              >
                <CheckCircle size={16} />
                {isPending ? 'Confirm in wallet…' : isConfirming ? 'Confirming…' : 'Mark Delivered'}
              </button>
            )}

            {isShipper && shipment.status === ShipmentStatus.Delivered && (
              <button
                onClick={() => doAction('confirm')}
                disabled={busy}
                className="w-full py-2.5 rounded-lg bg-[var(--success)] text-white font-700 text-sm hover:opacity-90 disabled:opacity-50 transition-colors min-h-[44px] flex items-center justify-center gap-2"
              >
                <CheckCircle size={16} />
                {isPending ? 'Confirm in wallet…' : isConfirming ? 'Confirming…' : 'Confirm Delivery & Release Funds'}
              </button>
            )}

            {isShipper && shipment.status === ShipmentStatus.Created && (
              <button
                onClick={() => doAction('cancel')}
                disabled={busy || !canCancel}
                className="w-full py-2.5 rounded-lg border border-[var(--border)] text-[var(--muted)] font-500 text-sm hover:border-[var(--danger)] hover:text-[var(--danger)] disabled:opacity-50 transition-colors min-h-[44px]"
              >
                {!canCancel
                  ? `Cancel available after pickup deadline (${formatCountdown(shipment.pickupDeadline)})`
                  : isPending ? 'Confirm in wallet…' : isConfirming ? 'Confirming…' : 'Cancel & Refund Escrow'}
              </button>
            )}

            {isShipper && shipment.status === ShipmentStatus.PickedUp && refundEligible && (
              <button
                onClick={() => doAction('refund')}
                disabled={busy}
                className="w-full py-2.5 rounded-lg bg-[var(--danger)] text-white font-600 text-sm hover:opacity-90 disabled:opacity-50 transition-colors min-h-[44px] flex items-center justify-center gap-2"
              >
                <RotateCcw size={16} />
                {isPending ? 'Confirm in wallet…' : isConfirming ? 'Confirming…' : 'Claim Full Refund (Undelivered)'}
              </button>
            )}

            {shipment.status === ShipmentStatus.Delivered && isAutoReleaseReady(shipment.deliveredAt) && (
              <button
                onClick={() => doAction('autorelease')}
                disabled={busy}
                className="w-full py-2.5 rounded-lg border border-[var(--warning)] text-[var(--warning)] font-500 text-sm hover:bg-[var(--warning-soft)] disabled:opacity-50 transition-colors min-h-[44px] flex items-center justify-center gap-2"
              >
                <Clock size={16} />
                {isPending ? 'Confirm in wallet…' : isConfirming ? 'Confirming…' : 'Auto-Release Funds'}
              </button>
            )}

            {shipment.status === ShipmentStatus.Disputed && escalateEligible && (
              <button
                onClick={() => doAction('escalate')}
                disabled={busy}
                className="w-full py-2.5 rounded-lg border border-[var(--warning)] text-[var(--warning)] font-600 text-sm hover:bg-[var(--warning-soft)] disabled:opacity-50 transition-colors min-h-[44px] flex items-center justify-center gap-2"
              >
                <Scale size={16} />
                {isPending ? 'Confirm in wallet…' : isConfirming ? 'Confirming…' : 'Escalate Dispute (Timeout 50/50 Split)'}
              </button>
            )}

            {(isShipper || isCarrier) && [ShipmentStatus.PickedUp, ShipmentStatus.Delivered].includes(shipment.status) && (
              <div>
                {!showDisputeInput ? (
                  <button
                    onClick={() => setShowDisputeInput(true)}
                    className="w-full py-2 rounded-lg text-[var(--danger)] text-sm font-500 hover:bg-[var(--danger-soft)] transition-colors min-h-[40px] flex items-center justify-center gap-2"
                  >
                    <AlertTriangle size={14} /> Open Dispute
                  </button>
                ) : (
                  <div className="space-y-2">
                    <textarea
                      value={disputeReason}
                      onChange={e => setDisputeReason(e.target.value)}
                      placeholder="Describe the issue (max 256 bytes)..."
                      maxLength={256}
                      rows={2}
                      className="w-full text-sm bg-[var(--surface-muted)] border border-[var(--danger)] rounded-lg px-3 py-2 text-[var(--ink)] placeholder-[var(--subtle)] focus:outline-none resize-none"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => doAction('dispute')}
                        disabled={busy || !disputeReason.trim()}
                        className="flex-1 py-2 rounded-lg bg-[var(--danger)] text-white font-600 text-sm disabled:opacity-50 transition-colors min-h-[40px]"
                      >
                        {busy ? 'Submitting...' : 'Submit Dispute'}
                      </button>
                      <button
                        onClick={() => setShowDisputeInput(false)}
                        className="px-3 py-2 rounded-lg border border-[var(--border)] text-[var(--subtle)] text-sm hover:text-[var(--ink)] transition-colors min-h-[40px]"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function formatAutoReleaseCountdown(deliveredAt: bigint): string {
  const releaseAt = Number(deliveredAt) + AUTO_RELEASE_DELAY_S;
  const now = Math.floor(Date.now() / 1000);
  const diff = releaseAt - now;
  if (diff <= 0) return '';
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  return `${h}h ${m}m`;
}
