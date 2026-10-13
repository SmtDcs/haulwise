import { useState } from 'react';
import { useAccount } from 'wagmi';
import { Shipment, ShipmentStatus, AgentLog } from '../types/cargo';
import { formatUSDC } from '../lib/utils';
import { useReputation } from '../hooks/useShipments';
import ShipmentCard from './ShipmentCard';
import ReputationBadge from './ReputationBadge';
import ShipmentDetail from './ShipmentDetail';
import { Truck, DollarSign, Package } from 'lucide-react';

interface CarrierViewProps {
  shipments: Shipment[];
  refetch: () => void;
  addLog: (entry: Omit<AgentLog, 'id' | 'timestamp'>) => void;
}

export default function CarrierView({ shipments, refetch, addLog }: CarrierViewProps) {
  const { address } = useAccount();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { reputation } = useReputation(address);

  const myJobs = address
    ? shipments.filter(s => s.carrier.toLowerCase() === address.toLowerCase())
    : [];

  const activeJobs = myJobs.filter(s => [ShipmentStatus.Created, ShipmentStatus.PickedUp, ShipmentStatus.Delivered].includes(s.status));
  const completedJobs = myJobs.filter(s => [ShipmentStatus.Released, ShipmentStatus.Resolved].includes(s.status));
  const totalEarnings = completedJobs.reduce((a, s) => a + s.amount - (s.amount * 50n / 10000n), 0n);

  return (
    <div className="space-y-6">
      {/* Earnings header */}
      <div className="rounded-xl border border-[var(--border-strong)] bg-[var(--surface-strong)] p-5">
        <div className="text-xs text-[var(--subtle)] uppercase mb-2 font-500" style={{ letterSpacing: '0.07em' }}>Total Earned</div>
        <div className="display text-4xl font-700 tabular-nums text-[var(--ink)]">
          ${formatUSDC(totalEarnings)}
          <span className="text-base font-500 text-[var(--subtle)] ml-2">USDC</span>
        </div>
        <div className="text-xs text-[var(--subtle)] mt-1">{completedJobs.length} completed deliveries</div>
      </div>

      {/* Stats + reputation */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-3">
          {([
            ['Active Jobs', activeJobs.length, <Truck size={16} className="text-[var(--accent)]" />],
            ['Pending Payout', `$${formatUSDC(activeJobs.reduce((a, s) => a + s.amount - s.amount * 50n / 10000n, 0n))}`, <DollarSign size={16} className="text-[var(--warning)]" />],
          ] as const).map(([label, value, icon]) => (
            <div key={label} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[var(--surface-muted)] flex items-center justify-center shrink-0">{icon}</div>
              <div>
                <div className="text-xs text-[var(--subtle)] font-500">{label}</div>
                <div className="display text-lg font-700 tabular-nums text-[var(--ink)]">{value}</div>
              </div>
            </div>
          ))}
        </div>
        {reputation && <ReputationBadge reputation={reputation} />}
      </div>

      {/* Job list */}
      <div>
        <h2 className="display text-base font-600 text-[var(--ink)] mb-3">Incoming Jobs</h2>
        {myJobs.length === 0 ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center">
            <Package size={32} className="text-[var(--subtle)] mx-auto mb-3" />
            <p className="text-sm text-[var(--subtle)]">No jobs assigned to your address.</p>
            <p className="text-xs text-[var(--subtle)] mt-1">Ask a shipper to assign a shipment to you.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {myJobs.map(s => (
              <ShipmentCard
                key={Number(s.id)}
                shipment={s}
                viewerAddress={address}
                onClick={() => setSelectedId(Number(s.id))}
              />
            ))}
          </div>
        )}
      </div>

      {selectedId !== null && (
        <ShipmentDetail
          shipmentId={selectedId}
          viewerAddress={address}
          onClose={() => setSelectedId(null)}
          refetch={refetch}
          addLog={addLog}
        />
      )}
    </div>
  );
}
