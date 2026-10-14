import { useEffect, useState } from 'react';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { toast } from 'sonner';
import { Shipment, ShipmentStatus } from '../types/cargo';
import { CARGOBILL_ABI, CARGOBILL_ADDRESS } from '../lib/cargobill';
import { CHAIN_ID } from '../config';
import { formatAddress, formatUSDC, formatEscalateCountdown, parseOnchainError } from '../lib/utils';
import { Scale } from 'lucide-react';

interface ArbiterViewProps {
  shipments: Shipment[];
  refetch: () => void;
}

export default function ArbiterView({ shipments, refetch }: ArbiterViewProps) {
  const disputed = shipments.filter(s => s.status === ShipmentStatus.Disputed);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="display text-base font-600 text-[var(--ink)]">Open disputes</h2>
        <p className="text-xs text-[var(--subtle)] mt-1">
          Choose how much of the escrow goes to the carrier; the rest returns to the shipper. No protocol fee is taken on
          resolutions. Disputes left unresolved for 14 days can be closed by anyone at a fixed 50/50 split.
        </p>
      </div>
      {disputed.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--subtle)]">
          No shipments are in dispute.
        </div>
      ) : (
        disputed.map(s => <DisputeRow key={Number(s.id)} shipment={s} refetch={refetch} />)
      )}
    </div>
  );
}

function DisputeRow({ shipment, refetch }: { shipment: Shipment; refetch: () => void }) {
  const [carrierPct, setCarrierPct] = useState(50);
  const { writeContract, data: txHash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (isSuccess) {
      toast.success(`Dispute #${Number(shipment.id)} resolved`);
      refetch();
    }
  }, [isSuccess, refetch, shipment.id]);

  useEffect(() => {
    if (error) toast.error(parseOnchainError(error));
  }, [error]);

  const carrierBps = BigInt(carrierPct * 100);
  const carrierAmount = (shipment.amount * carrierBps) / 10_000n;
  const shipperAmount = shipment.amount - carrierAmount;
  const busy = isPending || isConfirming;

  function resolve() {
    writeContract({
      address: CARGOBILL_ADDRESS,
      abi: CARGOBILL_ABI,
      functionName: 'resolveDispute',
      args: [shipment.id, carrierBps],
      chainId: CHAIN_ID,
    });
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-600 text-[var(--ink)]">Shipment #{Number(shipment.id)}</div>
          <div className="text-xs text-[var(--subtle)] mono mt-0.5">
            shipper {formatAddress(shipment.shipper)} · carrier {formatAddress(shipment.carrier)}
          </div>
        </div>
        <div className="text-right">
          <div className="display text-lg font-700 tabular-nums text-[var(--ink)]">{formatUSDC(shipment.amount)}</div>
          <div className="text-xs text-[var(--subtle)]">USDC in escrow</div>
        </div>
      </div>

      <div className="text-sm text-[var(--ink-2)] bg-[var(--surface-muted)] rounded-lg p-3 break-words">
        {shipment.disputeReason || <span className="text-[var(--subtle)]">No reason given.</span>}
      </div>
      <div className="text-xs text-[var(--subtle)]">{formatEscalateCountdown(shipment.disputedAt)}</div>

      <div>
        <label className="flex justify-between text-xs text-[var(--subtle)] mb-1">
          <span>Carrier share: {carrierPct}%</span>
          <span className="tabular-nums">
            carrier {formatUSDC(carrierAmount)} · shipper {formatUSDC(shipperAmount)}
          </span>
        </label>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={carrierPct}
          onChange={e => setCarrierPct(Number(e.target.value))}
          disabled={busy}
          className="w-full accent-[var(--accent)]"
        />
        <p className="text-xs text-[var(--subtle)] mt-1">
          Below 50% counts as a dispute against the carrier; 50% or more counts against the shipper.
        </p>
      </div>

      <button
        onClick={resolve}
        disabled={busy}
        className="w-full py-2.5 rounded-lg bg-[var(--accent)] text-[#0d1b2f] font-600 text-sm hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors min-h-[44px] flex items-center justify-center gap-2"
      >
        <Scale size={16} />
        {isPending ? 'Confirm in wallet…' : isConfirming ? 'Confirming…' : 'Resolve dispute'}
      </button>
    </div>
  );
}
