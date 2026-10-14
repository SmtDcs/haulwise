import { useEffect, useRef } from 'react';
import { Shipment, ShipmentStatus, AgentLog, Reputation } from '../types/cargo';
import {
  formatUSDC,
  isPickupOverdue,
  isDeliveryOverdue,
  canRefundUndelivered,
  canEscalateDispute,
  isAutoReleaseReady,
  netOfFee,
} from '../lib/utils';
import { Bot, AlertTriangle, Lightbulb, Activity, Trash2 } from 'lucide-react';

interface AgentPanelProps {
  shipments: Shipment[];
  reputations: Record<string, Reputation>;
  logs: AgentLog[];
  onAddLog: (entry: Omit<AgentLog, 'id' | 'timestamp'>) => void;
  onClearLogs: () => void;
}

function analyzeShipments(
  shipments: Shipment[],
  reputations: Record<string, Reputation>,
  addLog: (entry: Omit<AgentLog, 'id' | 'timestamp'>) => void,
  lastRunRef: React.MutableRefObject<number>
) {
  const now = Date.now();
  if (now - lastRunRef.current < 15_000) return; // throttle to 15s
  lastRunRef.current = now;

  for (const s of shipments) {
    if (s.status === ShipmentStatus.Created && isPickupOverdue(s.pickupDeadline)) {
      addLog({
        type: 'flag',
        shipmentId: Number(s.id),
        message: `Shipment #${Number(s.id)} (${formatUSDC(s.amount)} USDC) is past its pickup deadline. Carrier has not picked up. Shipper can cancel and recover funds.`,
      });
    }

    if (s.status === ShipmentStatus.PickedUp) {
      if (canRefundUndelivered(s.deliveryDeadline)) {
        addLog({
          type: 'flag',
          shipmentId: Number(s.id),
          message: `Shipment #${Number(s.id)} is 7+ days past delivery deadline. Shipper can claim a full refund via refundUndelivered.`,
        });
      } else if (isDeliveryOverdue(s.deliveryDeadline)) {
        addLog({
          type: 'suggestion',
          shipmentId: Number(s.id),
          message: `Shipment #${Number(s.id)} is past delivery deadline. Monitoring transit.`,
        });
      }
    }

    if (s.status === ShipmentStatus.Disputed) {
      if (canEscalateDispute(s.disputedAt)) {
        addLog({
          type: 'action',
          shipmentId: Number(s.id),
          message: `Shipment #${Number(s.id)} dispute unresolved for 14+ days. Anyone can trigger a 50/50 timeout escalation.`,
        });
      } else {
        addLog({
          type: 'flag',
          shipmentId: Number(s.id),
          message: `Shipment #${Number(s.id)} is in dispute. Reason: "${s.disputeReason || 'not provided'}". Awaiting arbiter resolution.`,
        });
      }
    }

    const rep = reputations[s.carrier.toLowerCase()];
    if (rep && Number(rep.disputed) >= 2) {
      addLog({
        type: 'suggestion',
        shipmentId: Number(s.id),
        message: `Carrier for shipment #${Number(s.id)} has ${Number(rep.disputed)} dispute(s) on record. Consider monitoring this delivery closely.`,
      });
    }

    if (s.status === ShipmentStatus.Delivered && isAutoReleaseReady(s.deliveredAt)) {
      addLog({
        type: 'suggestion',
        shipmentId: Number(s.id),
        message: `Auto-release is ready for shipment #${Number(s.id)}. Carrier receives ${formatUSDC(netOfFee(s.amount))} USDC.`,
      });
    }
  }
}

const TYPE_ICON = {
  flag: <AlertTriangle size={14} className="text-[var(--danger)] shrink-0 mt-0.5" />,
  suggestion: <Lightbulb size={14} className="text-[var(--warning)] shrink-0 mt-0.5" />,
  action: <Activity size={14} className="text-[var(--accent)] shrink-0 mt-0.5" />,
};

const TYPE_COLOR = {
  flag: 'border-l-[var(--danger)]',
  suggestion: 'border-l-[var(--warning)]',
  action: 'border-l-[var(--accent)]',
};

export default function AgentPanel({ shipments, reputations, logs, onAddLog, onClearLogs }: AgentPanelProps) {
  const lastRunRef = useRef<number>(0);

  useEffect(() => {
    if (shipments.length > 0) {
      analyzeShipments(shipments, reputations, onAddLog, lastRunRef);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipments, reputations]); // onAddLog is stable (useCallback)

  function formatTime(ts: number) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] flex flex-col h-full min-h-[400px]">
      <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[var(--accent)] flex items-center justify-center">
            <Bot size={14} className="text-[#0d1b2f]" />
          </div>
          <div>
            <div className="text-sm font-600 text-[var(--ink)]">Shipment monitor</div>
            <div className="text-xs text-[var(--subtle)]">Rule-based checks, runs in your browser</div>
          </div>
        </div>
        {logs.length > 0 && (
          <button onClick={onClearLogs} className="flex items-center gap-1 text-xs text-[var(--subtle)] hover:text-[var(--muted)] transition-colors">
            <Trash2 size={12} /> Clear
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {logs.length === 0 ? (
          <div className="text-center py-8">
            <Bot size={28} className="text-[var(--subtle)] mx-auto mb-2" />
            <p className="text-xs text-[var(--subtle)]">No alerts.</p>
            <p className="text-xs text-[var(--subtle)] mt-0.5">Overdue pickups, refund windows, disputes and auto-release eligibility show up here.</p>
          </div>
        ) : (
          logs.map(log => (
            <div
              key={log.id}
              className={`rounded-lg border-l-2 border border-[var(--border)] bg-[var(--surface-muted)] p-3 ${TYPE_COLOR[log.type]}`}
            >
              <div className="flex items-start gap-2">
                {TYPE_ICON[log.type]}
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-[var(--ink-2)] leading-relaxed">{log.message}</p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="mono text-xs text-[var(--subtle)]">{formatTime(log.timestamp)}</span>
                    {log.shipmentId !== undefined && (
                      <span className="text-xs text-[var(--subtle)]">· #{log.shipmentId}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="border-t border-[var(--border)] p-3 flex items-center justify-between text-xs text-[var(--subtle)]">
        <span>{logs.filter(l => l.type === 'flag').length} flags · {logs.filter(l => l.type === 'suggestion').length} suggestions</span>
        <span className="tabular-nums">{logs.length} events</span>
      </div>
    </div>
  );
}
