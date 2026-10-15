export type Address = `0x${string}`;
export type Hex = `0x${string}`;

export enum Status { Created, PickedUp, Delivered, Released, Disputed, Cancelled, Resolved, Refunded }
export const STATUS_NAME = ['Created', 'PickedUp', 'Delivered', 'Released', 'Disputed', 'Cancelled', 'Resolved', 'Refunded'] as const;

export interface Shipment {
  id: number;
  shipper: Address;
  carrier: Address;
  amount: bigint; // USDC, 6 decimals
  pickupDeadline: number; // unix seconds
  deliveryDeadline: number;
  metadataURI: string;
  status: Status;
  pickedUpAt: number;
  deliveredAt: number;
  disputeReason: string;
  disputedAt: number;
}

export interface Reputation { completed: number; disputed: number; late: number }

/** Commercial terms encoded in metadataURI: hw1|<poRef>|<origin>|<destination>|<cargo> */
export interface Terms { poRef: string; origin: string; destination: string; cargo: string }

/** Fields read off a carrier invoice + proof of delivery. Any field may be missing. */
export interface InvoiceFields {
  invoiceNumber?: string;
  amountUSDC?: number;
  payee?: string;
  poRef?: string;
  origin?: string;
  destination?: string;
  invoiceDate?: string; // ISO date
  podSignedBy?: string;
  podDate?: string; // ISO date
}

export type Severity = 'ok' | 'warn' | 'fail';
export interface Finding { check: string; severity: Severity; detail: string }

export type Verdict =
  | { kind: 'confirm' }
  | { kind: 'needs_approval'; reasons: string[] }
  | { kind: 'dispute'; reasons: string[] }
  | { kind: 'hold'; reasons: string[] };

export interface Policy {
  /** Agent may confirm on its own up to this amount per shipment. */
  autoConfirmMaxUSDC: number;
  /** Rolling 24h cap on value the agent releases without a human. */
  dailyAutoConfirmCapUSDC: number;
  /** Invoice may not exceed escrow by more than this (fraction). Under-billing is fine. */
  amountTolerance: number;
  /** Late deliveries beyond this many hours go to a human instead of auto-confirm. */
  maxLateHours: number;
  /** Carriers with fewer completed jobs than this need approval above newCarrierMaxUSDC. */
  newCarrierMinCompleted: number;
  newCarrierMaxUSDC: number;
  /** Agent opens disputes on hard failures itself; otherwise it drafts and asks. */
  autoDispute: boolean;
  /** Call autoRelease on shipments past the 48h window (permissionless, carrier-friendly). */
  triggerAutoRelease: boolean;
  blockedCarriers: string[];
}

export const DEFAULT_POLICY: Policy = {
  autoConfirmMaxUSDC: 250,
  dailyAutoConfirmCapUSDC: 1000,
  amountTolerance: 0,
  maxLateHours: 12,
  newCarrierMinCompleted: 3,
  newCarrierMaxUSDC: 50,
  autoDispute: true,
  triggerAutoRelease: true,
  blockedCarriers: [],
};
