import { useAccount, useSwitchChain } from 'wagmi';
import { AlertTriangle } from 'lucide-react';
import { CHAIN_ID, NETWORK } from '../config';
import { parseOnchainError } from '../lib/utils';

/** Shown when a wallet is connected to a chain other than the one this build targets. */
export default function NetworkGuard() {
  const { isConnected, chainId } = useAccount();
  const { switchChain, isPending, error } = useSwitchChain();

  if (!isConnected || chainId === CHAIN_ID) return null;

  return (
    <div className="rounded-lg border border-[var(--warning)] bg-[var(--warning-soft)] p-4 mb-6 text-sm text-[var(--warning)] flex flex-wrap items-center gap-3">
      <AlertTriangle size={16} />
      <span className="flex-1">
        Your wallet is on chain {chainId}. Haulwise runs on {NETWORK.name} (chain {CHAIN_ID}).
        {error && <span className="block text-xs mt-1">{parseOnchainError(error)}</span>}
      </span>
      <button
        onClick={() => switchChain({ chainId: CHAIN_ID })}
        disabled={isPending}
        className="px-3 py-1.5 rounded-lg border border-[var(--warning)] text-xs font-600 disabled:opacity-50"
      >
        {isPending ? 'Switching…' : `Switch to ${NETWORK.name}`}
      </button>
    </div>
  );
}
