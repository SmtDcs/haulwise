import { useState } from 'react';
import { useAccount, useReadContract, useReadContracts } from 'wagmi';
import { Role, Reputation } from './types/cargo';
import { CARGOBILL_ABI, CARGOBILL_ADDRESS } from './lib/cargobill';
import { useShipmentCount, useAllShipments } from './hooks/useShipments';
import { useAgentLog } from './hooks/useAgentLog';
import Header from './components/Header';
import ShipperView from './components/ShipperView';
import CarrierView from './components/CarrierView';
import AgentPanel from './components/AgentPanel';
import ArbiterView from './components/ArbiterView';
import NetworkGuard from './components/NetworkGuard';
import { Package } from 'lucide-react';

export default function App() {
  const [role, setRole] = useState<Role>('shipper');
  const { address } = useAccount();
  const { logs, addLog, clearLogs } = useAgentLog();

  const { data: countData, refetch: refetchCount } = useShipmentCount();
  const count = countData ? Number(countData) : 0;
  const { shipments, refetch: refetchShipments } = useAllShipments(count);

  function refetch() {
    void refetchCount();
    void refetchShipments();
  }

  const uniqueCarriers = [...new Set(shipments.map(s => s.carrier.toLowerCase()))] as `0x${string}`[];

  const reputationContracts = uniqueCarriers.map(carrier => ({
    address: CARGOBILL_ADDRESS,
    abi: CARGOBILL_ABI,
    functionName: 'reputation' as const,
    args: [carrier] as const,
  }));

  const { data: repData } = useReadContracts({
    contracts: reputationContracts,
    query: { enabled: !!CARGOBILL_ADDRESS && uniqueCarriers.length > 0 },
  });

  const reputations: Record<string, Reputation> = {};
  if (repData) {
    uniqueCarriers.forEach((carrier, i) => {
      const r = repData[i];
      if (r?.status === 'success' && r.result) {
        const raw = r.result;
        reputations[carrier] = { completed: raw[0], disputed: raw[1], late: raw[2] };
      }
    });
  }

  const { data: arbiter } = useReadContract({
    address: CARGOBILL_ADDRESS || undefined,
    abi: CARGOBILL_ABI,
    functionName: 'arbiter',
    query: { enabled: !!CARGOBILL_ADDRESS },
  });
  const isArbiter = !!address && !!arbiter && arbiter.toLowerCase() === address.toLowerCase();
  const activeRole: Role = role === 'arbiter' && !isArbiter ? 'shipper' : role;

  const notDeployed = !CARGOBILL_ADDRESS;

  return (
    <div className="min-h-dvh" style={{ background: 'var(--bg-gradient)' }}>
      <Header role={activeRole} onRoleChange={setRole} showArbiter={isArbiter} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <NetworkGuard />

        {notDeployed && (
          <div className="rounded-xl border border-[var(--warning)] bg-[rgba(246,194,106,0.08)] p-4 mb-6 text-sm text-[var(--warning)] flex items-center gap-2">
            <Package size={16} />
            No escrow contract configured for this network. Set VITE_CARGOBILL_ADDRESS.
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-6">
          <div className="space-y-4">
            {!address && (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 text-sm text-[var(--muted)]">
                Haulwise holds freight payments in USDC escrow on Arc until delivery is confirmed. Connect a wallet to
                create shipments as a shipper or manage jobs as a carrier.
              </div>
            )}
            {activeRole === 'shipper' && <ShipperView shipments={shipments} refetch={refetch} addLog={addLog} />}
            {activeRole === 'carrier' && <CarrierView shipments={shipments} refetch={refetch} addLog={addLog} />}
            {activeRole === 'arbiter' && <ArbiterView shipments={shipments} refetch={refetch} />}
          </div>

          <div className="xl:sticky xl:top-24 xl:self-start">
            <AgentPanel
              shipments={shipments}
              reputations={reputations}
              logs={logs}
              onAddLog={addLog}
              onClearLogs={clearLogs}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
