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
import { Package, ExternalLink } from 'lucide-react';
import { NETWORK } from './config';

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
    <div className="min-h-dvh bg-[var(--bg)]">
      <Header role={activeRole} onRoleChange={setRole} showArbiter={isArbiter} />

      <section className="border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h1 className="text-lg sm:text-xl font-600 text-[var(--ink)]">Freight payments held in USDC escrow until delivery is confirmed.</h1>
            <p className="text-sm text-[var(--muted)] mt-1">
              Shippers lock the rate up front, carriers are paid on delivery, disputes go to an arbiter. 0.5% fee on release.
            </p>
          </div>
          {CARGOBILL_ADDRESS && (
            <a
              href={`${NETWORK.explorerBase}/address/${CARGOBILL_ADDRESS}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 self-start md:self-auto rounded-md border border-[var(--border)] px-3 py-2 text-xs text-[var(--ink-2)] hover:border-[var(--border-strong)] transition-colors"
            >
              <span className="w-2 h-2 rounded-full bg-[var(--success)]" />
              <span className="font-500">Live on {NETWORK.key === 'arc' ? 'Arc mainnet' : NETWORK.name}</span>
              <span className="mono text-[var(--subtle)]">{CARGOBILL_ADDRESS.slice(0, 6)}…{CARGOBILL_ADDRESS.slice(-4)}</span>
              <ExternalLink size={12} className="text-[var(--subtle)]" />
            </a>
          )}
        </div>
      </section>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <NetworkGuard />

        {notDeployed && (
          <div className="rounded-lg border border-[var(--warning)] bg-[var(--warning-soft)] p-4 mb-6 text-sm text-[var(--warning)] flex items-center gap-2">
            <Package size={16} />
            No escrow contract configured for this network. Set VITE_CARGOBILL_ADDRESS.
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-6">
          <div className="space-y-4">
            {!address && (
              <div className="rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--surface)] p-5 text-sm text-[var(--muted)]">
                <div className="font-500 text-[var(--ink)] mb-1">Connect a wallet to continue</div>
                Shippers create shipments and deposit the freight rate. Carriers see jobs assigned to their address and
                mark pickup and delivery. Any EVM wallet on {NETWORK.name} (chain {NETWORK.chainId}) works.
              </div>
            )}
            {activeRole === 'shipper' && <ShipperView shipments={shipments} refetch={refetch} addLog={addLog} />}
            {activeRole === 'carrier' && <CarrierView shipments={shipments} refetch={refetch} addLog={addLog} />}
            {activeRole === 'arbiter' && <ArbiterView shipments={shipments} refetch={refetch} />}
          </div>

          <div className="xl:sticky xl:top-20 xl:self-start">
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
