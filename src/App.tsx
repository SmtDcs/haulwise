import { useState } from 'react';
import { useAccount, useReadContracts } from 'wagmi';
import { Role, Reputation } from './types/cargo';
import { CARGOBILL_ABI, CARGOBILL_ADDRESS } from './lib/cargobill';
import { useShipmentCount, useAllShipments } from './hooks/useShipments';
import { useAgentLog } from './hooks/useAgentLog';
import Header from './components/Header';
import ShipperView from './components/ShipperView';
import CarrierView from './components/CarrierView';
import AgentPanel from './components/AgentPanel';
import DemoSeeder from './components/DemoSeeder';
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

  // Collect unique carrier addresses from shipments and load their reputations
  const uniqueCarriers = [...new Set(shipments.map(s => s.carrier.toLowerCase()))] as `0x${string}`[];

  // Build reputations map
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

  const notDeployed = !CARGOBILL_ADDRESS;

  return (
    <div className="min-h-dvh" style={{ background: 'var(--bg-gradient)' }}>
      <Header role={role} onRoleChange={setRole} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {notDeployed && (
          <div className="rounded-xl border border-[var(--warning)] bg-[rgba(246,194,106,0.08)] p-4 mb-6 text-sm text-[var(--warning)] flex items-center gap-2">
            <Package size={16} />
            Contract not deployed yet. Deploy CargoBill to Arc Testnet and set VITE_CARGOBILL_ADDRESS in .env to enable onchain features.
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-6">
          {/* Main content */}
          <div className="space-y-4">
            {address && <DemoSeeder refetch={refetch} connectedAddress={address} />}

            {role === 'shipper' ? (
              <ShipperView shipments={shipments} refetch={refetch} addLog={addLog} />
            ) : (
              <CarrierView shipments={shipments} refetch={refetch} addLog={addLog} />
            )}
          </div>

          {/* Settlement Agent */}
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
