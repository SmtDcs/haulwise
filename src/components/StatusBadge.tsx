import { ShipmentStatus, STATUS_LABEL } from '../types/cargo';
import { statusDot, statusColor } from '../lib/utils';

interface StatusBadgeProps {
  status: ShipmentStatus;
  size?: 'sm' | 'md';
}

export default function StatusBadge({ status, size = 'md' }: StatusBadgeProps) {
  const textSize = size === 'sm' ? 'text-xs' : 'text-sm';
  return (
    <span className={`inline-flex items-center gap-1.5 font-medium ${textSize} ${statusColor(status)}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot(status)}`} />
      {STATUS_LABEL[status]}
    </span>
  );
}
