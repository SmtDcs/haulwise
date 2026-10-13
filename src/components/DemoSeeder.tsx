import { useState } from 'react';
import { useWriteContract } from 'wagmi';
import { erc20Abi } from 'viem';
import { toast } from 'sonner';
import { CARGOBILL_ABI, CARGOBILL_ADDRESS } from '../lib/cargobill';
import { CHAIN_ID, USDC_ADDRESS } from '../config';
import { parseUSDC } from '../lib/utils';
import { Zap } from 'lucide-react';

// Demo carrier address (must be distinct from shipper per CargoBill contract rules)
const DEMO_CARRIER: `0x${string}` = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

const DEMO_SHIPMENTS = [
  { amount: '100', pickupHours: 24, deliveryHours: 72, meta: 'Electronics - Chicago to Dallas' },
  { amount: '250', pickupHours: 12, deliveryHours: 48, meta: 'Auto Parts - Detroit to Memphis' },
  { amount: '50', pickupHours: 48, deliveryHours: 168, meta: 'Books - Seattle to Portland' },
];

interface DemoSeederProps {
  refetch: () => void;
  connectedAddress?: `0x${string}`;
}

export default function DemoSeeder({ refetch, connectedAddress }: DemoSeederProps) {
  const [seeding, setSeeding] = useState(false);
  const [step, setStep] = useState('');

  const { writeContractAsync } = useWriteContract();

  async function seed() {
    if (!connectedAddress) { toast.error('Connect wallet first'); return; }
    if (!CARGOBILL_ADDRESS) { toast.error('Deploy the contract first'); return; }

    setSeeding(true);
    try {
      for (let i = 0; i < DEMO_SHIPMENTS.length; i++) {
        const demo = DEMO_SHIPMENTS[i];
        const amount = parseUSDC(demo.amount);
        const nowSec = Math.floor(Date.now() / 1000);
        const pickupDeadline = BigInt(nowSec + demo.pickupHours * 3600);
        const deliveryDeadline = BigInt(nowSec + demo.deliveryHours * 3600);

        setStep(`Approving USDC for shipment ${i + 1}/${DEMO_SHIPMENTS.length}...`);
        await writeContractAsync({
          address: USDC_ADDRESS,
          abi: erc20Abi,
          functionName: 'approve',
          args: [CARGOBILL_ADDRESS, amount],
          chainId: CHAIN_ID,
        });

        setStep(`Creating shipment ${i + 1}/${DEMO_SHIPMENTS.length}...`);
        await writeContractAsync({
          address: CARGOBILL_ADDRESS,
          abi: CARGOBILL_ABI,
          functionName: 'createShipment',
          args: [DEMO_CARRIER, amount, pickupDeadline, deliveryDeadline, demo.meta],
          chainId: CHAIN_ID,
        });
      }
      toast.success('Demo data seeded!', {
        description: `${DEMO_SHIPMENTS.length} shipments created with pickup and delivery deadlines.`,
      });
      refetch();
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message ?? '';
      if (!msg.includes('User rejected')) toast.error('Seeding failed: ' + msg.slice(0, 60));
    } finally {
      setSeeding(false);
      setStep('');
    }
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-600 text-[var(--ink)] flex items-center gap-1.5">
            <Zap size={14} className="text-[var(--warning)]" />
            Seed Demo Data
          </div>
          <div className="text-xs text-[var(--subtle)] mt-0.5">
            Creates 3 shipments with configured pickup and delivery deadlines
          </div>
        </div>
        <button
          onClick={() => void seed()}
          disabled={seeding || !CARGOBILL_ADDRESS}
          className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--muted)] text-xs font-500 hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50 transition-colors min-h-[36px]"
        >
          {seeding ? step || 'Seeding...' : 'Seed'}
        </button>
      </div>
    </div>
  );
}
