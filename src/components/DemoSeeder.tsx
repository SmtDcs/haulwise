import { useState } from 'react';
import { useWriteContract } from 'wagmi';
import { erc20Abi } from 'viem';
import { toast } from 'sonner';
import { CARGOBILL_ABI, CARGOBILL_ADDRESS } from '../lib/cargobill';
import { getUsdc } from '@/onchain-facts';
import { parseUSDC } from '../lib/utils';
import { Zap } from 'lucide-react';

const CHAIN_ID = 5042002;
const usdcFact = getUsdc(CHAIN_ID);
const USDC_ADDRESS = usdcFact?.address as `0x${string}`;

// Demo shipments to seed (carrier = own address so shipper can demonstrate all flows)
const DEMO_SHIPMENTS = [
  { amount: '100', deadlineHours: 72, meta: 'Electronics - Chicago to Dallas' },
  { amount: '250', deadlineHours: 48, meta: 'Auto Parts - Detroit to Memphis' },
  { amount: '50', deadlineHours: 168, meta: 'Books - Seattle to Portland' },
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
        const deadline = BigInt(Math.floor(Date.now() / 1000) + demo.deadlineHours * 3600);

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
          args: [connectedAddress, amount, deadline, demo.meta],
          chainId: CHAIN_ID,
        });
      }
      toast.success('Demo data seeded!', { description: `${DEMO_SHIPMENTS.length} shipments created with your address as both shipper and carrier.` });
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
            Creates 3 shipments with your wallet as shipper and carrier
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
