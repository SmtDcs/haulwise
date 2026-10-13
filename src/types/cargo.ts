export enum ShipmentStatus {
  Created = 0,
  PickedUp = 1,
  Delivered = 2,
  Released = 3,
  Disputed = 4,
  Cancelled = 5,
  Resolved = 6,
}

export const STATUS_LABEL: Record<ShipmentStatus, string> = {
  [ShipmentStatus.Created]: 'Created',
  [ShipmentStatus.PickedUp]: 'Picked Up',
  [ShipmentStatus.Delivered]: 'Delivered',
  [ShipmentStatus.Released]: 'Released',
  [ShipmentStatus.Disputed]: 'Disputed',
  [ShipmentStatus.Cancelled]: 'Cancelled',
  [ShipmentStatus.Resolved]: 'Resolved',
};

export interface Shipment {
  id: bigint;
  shipper: `0x${string}`;
  carrier: `0x${string}`;
  amount: bigint;
  deadline: bigint;
  metadataURI: string;
  status: ShipmentStatus;
  pickedUpAt: bigint;
  deliveredAt: bigint;
  disputeReason: string;
}

export interface Reputation {
  completed: bigint;
  disputed: bigint;
  late: bigint;
}

export type Role = 'shipper' | 'carrier';

export interface AgentLog {
  id: string;
  timestamp: number;
  type: 'suggestion' | 'action' | 'flag';
  shipmentId?: number;
  message: string;
}
