import { Reputation } from '../types/cargo';
import { CheckCircle, AlertTriangle, Clock } from 'lucide-react';

interface ReputationBadgeProps {
  reputation: Reputation;
  compact?: boolean;
}

export default function ReputationBadge({ reputation, compact = false }: ReputationBadgeProps) {
  const total = Number(reputation.completed) + Number(reputation.disputed) + Number(reputation.late);
  const score = total === 0 ? null : Math.round(
    ((Number(reputation.completed) - Number(reputation.disputed) * 0.5 - Number(reputation.late) * 0.25) / Math.max(total, 1)) * 100
  );

  if (compact) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="flex items-center gap-1 text-[var(--success)]">
          <CheckCircle size={12} />
          <span className="tabular-nums">{Number(reputation.completed)}</span>
        </span>
        <span className="flex items-center gap-1 text-[var(--danger)]">
          <AlertTriangle size={12} />
          <span className="tabular-nums">{Number(reputation.disputed)}</span>
        </span>
        <span className="flex items-center gap-1 text-[var(--warning)]">
          <Clock size={12} />
          <span className="tabular-nums">{Number(reputation.late)}</span>
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs uppercase tracking-wider text-[var(--subtle)] font-600" style={{ letterSpacing: '0.08em' }}>
          Reputation
        </span>
        {score !== null && (
          <span className={`text-sm font-700 tabular-nums ${score >= 70 ? 'text-[var(--success)]' : score >= 40 ? 'text-[var(--warning)]' : 'text-[var(--danger)]'}`}>
            {score}/100
          </span>
        )}
        {score === null && <span className="text-xs text-[var(--subtle)]">No history</span>}
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col items-center gap-1 p-2 rounded-lg bg-[var(--surface-muted)]">
          <CheckCircle size={16} className="text-[var(--success)]" />
          <span className="text-lg font-700 tabular-nums text-[var(--ink)]">{Number(reputation.completed)}</span>
          <span className="text-xs text-[var(--subtle)]">Done</span>
        </div>
        <div className="flex flex-col items-center gap-1 p-2 rounded-lg bg-[var(--surface-muted)]">
          <AlertTriangle size={16} className="text-[var(--danger)]" />
          <span className="text-lg font-700 tabular-nums text-[var(--ink)]">{Number(reputation.disputed)}</span>
          <span className="text-xs text-[var(--subtle)]">Disputed</span>
        </div>
        <div className="flex flex-col items-center gap-1 p-2 rounded-lg bg-[var(--surface-muted)]">
          <Clock size={16} className="text-[var(--warning)]" />
          <span className="text-lg font-700 tabular-nums text-[var(--ink)]">{Number(reputation.late)}</span>
          <span className="text-xs text-[var(--subtle)]">Late</span>
        </div>
      </div>
    </div>
  );
}
