import { useState, useEffect, useRef } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSwitchChain } from 'wagmi';
import { erc20Abi } from 'viem';
import { toast } from 'sonner';
import { Shipment, ShipmentStatus, AgentLog } from '../types/cargo';
import { CARGOBILL_ABI, CARGOBILL_ADDRESS } from '../lib/cargobill';
import { CHAIN_ID, USDC_ADDRESS } from '../config';
import { buildTxExplorerUrl } from '@/onchain-facts';
import { parseUSDC, formatUSDC } from '../lib/utils';
import ShipmentCard from './ShipmentCard';
import ShipmentDetail from './ShipmentDetail';
import { Plus, X, Package } from 'lucide-react';

interface ShipperViewProps {
  shipments: Shipment[];
  refetch: () => void;
  addLog: (entry: Omit<AgentLog, 'id' | 'timestamp'>) => void;
}

interface FormState {
  carrier: string;
  amount: string;
  pickupHours: string;
  deliveryHours: string;
  metadataURI: string;
}

const DEFAULT_FORM: FormState = {
  carrier: '',
  amount: '',
  pickupHours: '24',
  deliveryHours: '72',
  metadataURI: '',
};

export default function ShipperView({ shipments, refetch, addLog }: ShipperViewProps) {
  const { address, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [step, setStep] = useState<'idle' | 'approving' | 'creating'>('idle');
  const pendingFormRef = useRef<FormState>(DEFAULT_FORM);

  const myShipments = address
    ? shipments.filter(s => s.shipper.toLowerCase() === address.toLowerCase())
    : [];

  // Approve USDC
  const { writeContract: approve, data: approveTxHash, isPending: isApproving } = useWriteContract();
  const { isSuccess: approveSuccess } = useWaitForTransactionReceipt({ hash: approveTxHash });

  // Create shipment
  const { writeContract: create, data: createTxHash, isPending: isCreating } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: createSuccess } = useWaitForTransactionReceipt({ hash: createTxHash });

  useEffect(() => {
    if (approveSuccess && step === 'approving') {
      setStep('creating');
      toast.success('USDC approved');
      const f = pendingFormRef.current;
      const nowSec = Math.floor(Date.now() / 1000);
      const pickupDeadline = BigInt(nowSec + parseInt(f.pickupHours) * 3600);
      const deliveryDeadline = BigInt(nowSec + parseInt(f.deliveryHours) * 3600);
      const amount = parseUSDC(f.amount);
      create({
        address: CARGOBILL_ADDRESS,
        abi: CARGOBILL_ABI,
        functionName: 'createShipment',
        args: [
          f.carrier as `0x${string}`,
          amount,
          pickupDeadline,
          deliveryDeadline,
          f.metadataURI || `shipment:${Date.now()}`,
        ],
        chainId: CHAIN_ID,
      });
    }
  }, [approveSuccess, step, create]);

  useEffect(() => {
    if (createSuccess) {
      const f = pendingFormRef.current;
      setStep('idle');
      setShowCreate(false);
      setForm(DEFAULT_FORM);
      const txHash = createTxHash;
      toast.success('Shipment created!', {
        description: txHash ? `Tx: ${txHash.slice(0, 10)}...` : undefined,
        action: txHash ? { label: 'View', onClick: () => window.open(buildTxExplorerUrl(CHAIN_ID, txHash), '_blank') } : undefined,
      });
      addLog({ type: 'action', message: `New shipment created for carrier ${f.carrier.slice(0, 8)}... with $${f.amount} USDC` });
      refetch();
    }
  }, [createSuccess, createTxHash, addLog, refetch]);

  function handleCreate() {
    if (!address) { toast.error('Connect your wallet'); return; }
    if (chainId !== CHAIN_ID) { switchChain({ chainId: CHAIN_ID }); return; }
    if (!form.carrier || !form.amount) { toast.error('Fill all required fields'); return; }
    if (form.carrier.toLowerCase() === address.toLowerCase()) {
      toast.error('Carrier address cannot be your own address');
      return;
    }

    const pickupH = parseInt(form.pickupHours);
    const deliveryH = parseInt(form.deliveryHours);
    if (isNaN(pickupH) || pickupH <= 0) {
      toast.error('Pickup deadline must be greater than 0 hours');
      return;
    }
    if (isNaN(deliveryH) || deliveryH <= pickupH) {
      toast.error('Delivery deadline must be greater than pickup deadline');
      return;
    }

    const metaUri = form.metadataURI || `shipment:${Date.now()}`;
    if (new TextEncoder().encode(metaUri).length > 256) {
      toast.error('Metadata URI must be 256 bytes or fewer');
      return;
    }

    const amount = parseUSDC(form.amount);
    if (amount === 0n) { toast.error('Invalid amount'); return; }

    pendingFormRef.current = { ...form };
    setStep('approving');
    approve({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: 'approve',
      args: [CARGOBILL_ADDRESS, amount],
      chainId: CHAIN_ID,
    });
  }

  const busy = isApproving || isCreating || isConfirming;

  return (
    <div className="space-y-6">
      {/* Hero stats row */}
      <div className="grid grid-cols-3 gap-3">
        {([
          ['Total Shipments', myShipments.length, ''],
          ['Active', myShipments.filter(s => [ShipmentStatus.Created, ShipmentStatus.PickedUp, ShipmentStatus.Delivered].includes(s.status)).length, ''],
          ['In Escrow', `$${formatUSDC(myShipments.filter(s => ![ShipmentStatus.Released, ShipmentStatus.Cancelled, ShipmentStatus.Resolved, ShipmentStatus.Refunded].includes(s.status)).reduce((a, s) => a + s.amount, 0n))}`, 'USDC'],
        ] as const).map(([label, value, unit]) => (
          <div key={label} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="text-xs text-[var(--subtle)] mb-1 uppercase tracking-wider" style={{ letterSpacing: '0.07em' }}>{label}</div>
            <div className="display text-2xl font-700 tabular-nums text-[var(--ink)]">{value}</div>
            {unit && <div className="text-xs text-[var(--subtle)] mt-0.5">{unit}</div>}
          </div>
        ))}
      </div>

      {/* Create shipment */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="display text-base font-600 text-[var(--ink)]">My Shipments</h2>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent)] text-[#0d1b2f] text-sm font-600 hover:bg-[var(--accent-hover)] transition-colors min-h-[36px]"
          >
            {showCreate ? <X size={14} /> : <Plus size={14} />}
            {showCreate ? 'Cancel' : 'New Shipment'}
          </button>
        </div>

        {showCreate && (
          <div className="rounded-xl border border-[var(--border-strong)] bg-[var(--surface-strong)] p-5 mb-4">
            <h3 className="display text-sm font-600 text-[var(--ink)] mb-4">Create Shipment</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-[var(--subtle)] mb-1 font-500">Carrier Address * (must not be own address)</label>
                <input
                  value={form.carrier}
                  onChange={e => setForm(f => ({ ...f, carrier: e.target.value }))}
                  placeholder="0x..."
                  className="w-full mono text-sm bg-[var(--surface-muted)] border border-[var(--border)] rounded-lg px-3 py-2.5 text-[var(--ink)] placeholder-[var(--subtle)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs text-[var(--subtle)] mb-1 font-500">Amount (USDC) *</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                  placeholder="0.00"
                  className="w-full tabular-nums text-sm bg-[var(--surface-muted)] border border-[var(--border)] rounded-lg px-3 py-2.5 text-[var(--ink)] placeholder-[var(--subtle)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[var(--subtle)] mb-1 font-500">Pickup Deadline (hours)</label>
                  <input
                    type="number"
                    min="1"
                    value={form.pickupHours}
                    onChange={e => setForm(f => ({ ...f, pickupHours: e.target.value }))}
                    className="w-full tabular-nums text-sm bg-[var(--surface-muted)] border border-[var(--border)] rounded-lg px-3 py-2.5 text-[var(--ink)] placeholder-[var(--subtle)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--subtle)] mb-1 font-500">Delivery Deadline (hours)</label>
                  <input
                    type="number"
                    min="2"
                    value={form.deliveryHours}
                    onChange={e => setForm(f => ({ ...f, deliveryHours: e.target.value }))}
                    className="w-full tabular-nums text-sm bg-[var(--surface-muted)] border border-[var(--border)] rounded-lg px-3 py-2.5 text-[var(--ink)] placeholder-[var(--subtle)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-[var(--subtle)] mb-1 font-500">Metadata URI (max 256 bytes)</label>
                <input
                  value={form.metadataURI}
                  maxLength={256}
                  onChange={e => setForm(f => ({ ...f, metadataURI: e.target.value }))}
                  placeholder="ipfs://... or https://..."
                  className="w-full text-sm bg-[var(--surface-muted)] border border-[var(--border)] rounded-lg px-3 py-2.5 text-[var(--ink)] placeholder-[var(--subtle)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                />
              </div>

              {form.amount && (
                <div className="rounded-lg bg-[var(--surface-muted)] p-3 text-xs space-y-1">
                  <div className="flex justify-between text-[var(--muted)]">
                    <span>Escrow amount</span>
                    <span className="tabular-nums">${formatUSDC(parseUSDC(form.amount))} USDC</span>
                  </div>
                  <div className="flex justify-between text-[var(--subtle)]">
                    <span>Protocol fee (0.5% on release)</span>
                    <span className="tabular-nums">${formatUSDC((parseUSDC(form.amount) * 50n) / 10000n)} USDC</span>
                  </div>
                </div>
              )}

              <button
                onClick={handleCreate}
                disabled={busy}
                className="w-full py-2.5 rounded-lg bg-[var(--accent)] text-[#0d1b2f] font-600 text-sm hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors min-h-[44px]"
              >
                {step === 'approving' && isApproving && 'Approving USDC in wallet...'}
                {step === 'approving' && !isApproving && 'Confirming USDC approval...'}
                {step === 'creating' && isCreating && 'Creating shipment in wallet...'}
                {step === 'creating' && isConfirming && 'Confirming onchain...'}
                {step === 'idle' && 'Deposit Escrow & Create'}
              </button>
            </div>
          </div>
        )}

        {myShipments.length === 0 ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center">
            <Package size={32} className="text-[var(--subtle)] mx-auto mb-3" />
            <p className="text-sm text-[var(--subtle)]">No shipments created yet.</p>
            <p className="text-xs text-[var(--subtle)] mt-1">Create your first shipment or seed demo data.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {myShipments.map(s => (
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
