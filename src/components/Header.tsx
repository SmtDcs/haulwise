import { ConnectKitButton } from 'connectkit';
import { Package } from 'lucide-react';
import { Role } from '../types/cargo';

interface HeaderProps {
  role: Role;
  onRoleChange: (r: Role) => void;
}

export default function Header({ role, onRoleChange }: HeaderProps) {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--border)] backdrop-blur-md bg-[rgba(13,27,47,0.85)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        {/* Brand */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-[var(--accent)] flex items-center justify-center">
            <Package size={16} className="text-[#0d1b2f]" />
          </div>
          <span className="display text-lg font-700 text-[var(--ink)] tracking-tight">CargoBill</span>
          <span className="hidden sm:inline text-xs text-[var(--subtle)] ml-1 font-medium">Freight Settlement</span>
        </div>

        {/* Role toggle + connect */}
        <div className="flex items-center gap-3">
          <div className="flex rounded-lg overflow-hidden border border-[var(--border)] bg-[var(--surface)]">
            <button
              onClick={() => onRoleChange('shipper')}
              className={`px-3 py-1.5 text-sm font-medium transition-colors min-h-[36px] ${
                role === 'shipper'
                  ? 'bg-[var(--accent)] text-[#0d1b2f]'
                  : 'text-[var(--muted)] hover:text-[var(--ink)]'
              }`}
            >
              Shipper
            </button>
            <button
              onClick={() => onRoleChange('carrier')}
              className={`px-3 py-1.5 text-sm font-medium transition-colors min-h-[36px] ${
                role === 'carrier'
                  ? 'bg-[var(--accent)] text-[#0d1b2f]'
                  : 'text-[var(--muted)] hover:text-[var(--ink)]'
              }`}
            >
              Carrier
            </button>
          </div>
          <ConnectKitButton />
        </div>
      </div>
    </header>
  );
}
