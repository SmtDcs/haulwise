import { ConnectKitButton } from 'connectkit';
import { Package } from 'lucide-react';
import { Role } from '../types/cargo';
import { NETWORK } from '../config';

interface HeaderProps {
  role: Role;
  onRoleChange: (r: Role) => void;
  showArbiter: boolean;
}

export default function Header({ role, onRoleChange, showArbiter }: HeaderProps) {
  const roles: Role[] = showArbiter ? ['shipper', 'carrier', 'arbiter'] : ['shipper', 'carrier'];
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--border)] backdrop-blur-md bg-[rgba(13,27,47,0.85)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-[var(--accent)] flex items-center justify-center">
            <Package size={16} className="text-[#0d1b2f]" />
          </div>
          <span className="display text-lg font-700 text-[var(--ink)] tracking-tight">Haulwise</span>
          <span className="hidden sm:inline text-xs text-[var(--subtle)] ml-1 font-medium">{NETWORK.name}</span>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex rounded-lg overflow-hidden border border-[var(--border)] bg-[var(--surface)]">
            {roles.map(r => (
              <button
                key={r}
                onClick={() => onRoleChange(r)}
                className={`px-3 py-1.5 text-sm font-medium capitalize transition-colors min-h-[36px] ${
                  role === r ? 'bg-[var(--accent)] text-[#0d1b2f]' : 'text-[var(--muted)] hover:text-[var(--ink)]'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          <ConnectKitButton />
        </div>
      </div>
    </header>
  );
}
