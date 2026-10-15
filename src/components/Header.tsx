import { ConnectKitButton } from 'connectkit';
import { Role } from '../types/cargo';
import { NETWORK } from '../config';

interface HeaderProps {
  role: Role;
  onRoleChange: (r: Role) => void;
  showArbiter: boolean;
}

function Mark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <rect width="22" height="22" rx="5" fill="var(--ink)" />
      <path d="M6 6v10M16 6v10M6 11h10" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export default function Header({ role, onRoleChange, showArbiter }: HeaderProps) {
  const roles: Role[] = showArbiter ? ['shipper', 'carrier', 'arbiter', 'agent'] : ['shipper', 'carrier', 'agent'];
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] backdrop-blur bg-[rgba(255,255,255,0.92)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 shrink-0">
          <Mark />
          <span className="hidden min-[400px]:inline text-[15px] font-600 text-[var(--ink)]">Haulwise</span>
          <span className="hidden sm:inline text-xs text-[var(--subtle)] border-l border-[var(--border)] pl-2 ml-1">{NETWORK.name}</span>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <nav aria-label="Role" className="flex rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-0.5">
            {roles.map(r => (
              <button
                key={r}
                onClick={() => onRoleChange(r)}
                aria-pressed={role === r}
                className={`px-2.5 sm:px-3 py-1 text-[13px] font-500 capitalize rounded transition-colors min-h-[32px] ${
                  role === r ? 'bg-[var(--surface)] text-[var(--ink)] shadow-sm border border-[var(--border)]' : 'text-[var(--muted)] hover:text-[var(--ink)] border border-transparent'
                }`}
              >
                {r}
              </button>
            ))}
          </nav>
          <ConnectKitButton />
        </div>
      </div>
    </header>
  );
}
