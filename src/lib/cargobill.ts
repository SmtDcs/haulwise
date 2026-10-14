import { NETWORK } from '../config';

// The escrow contract is deployed under its original name, CargoBill.
// VITE_CARGOBILL_ADDRESS overrides the per-network default (e.g. a local deploy).
export const CARGOBILL_ADDRESS = (import.meta.env.VITE_CARGOBILL_ADDRESS || NETWORK.escrow) as `0x${string}`;

export const CARGOBILL_ABI = [
  {
    "type": "constructor",
    "inputs": [
      { "name": "_usdc", "type": "address" },
      { "name": "_feeRecipient", "type": "address" },
      { "name": "_arbiter", "type": "address" }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "createShipment",
    "inputs": [
      { "name": "carrier", "type": "address" },
      { "name": "amountUSDC", "type": "uint256" },
      { "name": "pickupDeadline", "type": "uint256" },
      { "name": "deliveryDeadline", "type": "uint256" },
      { "name": "metadataURI", "type": "string" }
    ],
    "outputs": [{ "name": "id", "type": "uint256" }],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "markPickedUp",
    "inputs": [{ "name": "id", "type": "uint256" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "markDelivered",
    "inputs": [{ "name": "id", "type": "uint256" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "confirmDelivery",
    "inputs": [{ "name": "id", "type": "uint256" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "autoRelease",
    "inputs": [{ "name": "id", "type": "uint256" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "refundUndelivered",
    "inputs": [{ "name": "id", "type": "uint256" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "openDispute",
    "inputs": [
      { "name": "id", "type": "uint256" },
      { "name": "reason", "type": "string" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "resolveDispute",
    "inputs": [
      { "name": "id", "type": "uint256" },
      { "name": "carrierBps", "type": "uint256" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "escalateTimeout",
    "inputs": [{ "name": "id", "type": "uint256" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "cancel",
    "inputs": [{ "name": "id", "type": "uint256" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "transferArbiter",
    "inputs": [{ "name": "newArbiter", "type": "address" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "acceptArbiter",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "shipments",
    "inputs": [{ "name": "", "type": "uint256" }],
    "outputs": [
      { "name": "id", "type": "uint256" },
      { "name": "shipper", "type": "address" },
      { "name": "carrier", "type": "address" },
      { "name": "amount", "type": "uint256" },
      { "name": "pickupDeadline", "type": "uint256" },
      { "name": "deliveryDeadline", "type": "uint256" },
      { "name": "metadataURI", "type": "string" },
      { "name": "status", "type": "uint8" },
      { "name": "pickedUpAt", "type": "uint256" },
      { "name": "deliveredAt", "type": "uint256" },
      { "name": "disputeReason", "type": "string" },
      { "name": "disputedAt", "type": "uint256" }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "reputation",
    "inputs": [{ "name": "", "type": "address" }],
    "outputs": [
      { "name": "completed", "type": "uint256" },
      { "name": "disputed", "type": "uint256" },
      { "name": "late", "type": "uint256" }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "shipperDisputesLost",
    "inputs": [{ "name": "", "type": "address" }],
    "outputs": [{ "name": "", "type": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getShipperDisputesLost",
    "inputs": [{ "name": "shipper", "type": "address" }],
    "outputs": [{ "name": "", "type": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "shipmentCount",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "usdc",
    "inputs": [],
    "outputs": [{ "name": "", "type": "address" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "feeRecipient",
    "inputs": [],
    "outputs": [{ "name": "", "type": "address" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "arbiter",
    "inputs": [],
    "outputs": [{ "name": "", "type": "address" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pendingArbiter",
    "inputs": [],
    "outputs": [{ "name": "", "type": "address" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "PROTOCOL_FEE_BPS",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "AUTO_RELEASE_DELAY",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "ShipmentCreated",
    "inputs": [
      { "name": "id", "type": "uint256", "indexed": true },
      { "name": "shipper", "type": "address", "indexed": true },
      { "name": "carrier", "type": "address", "indexed": true },
      { "name": "amount", "type": "uint256", "indexed": false },
      { "name": "pickupDeadline", "type": "uint256", "indexed": false },
      { "name": "deliveryDeadline", "type": "uint256", "indexed": false },
      { "name": "metadataURI", "type": "string", "indexed": false }
    ]
  },
  {
    "type": "event",
    "name": "PickedUp",
    "inputs": [
      { "name": "id", "type": "uint256", "indexed": true },
      { "name": "timestamp", "type": "uint256", "indexed": false }
    ]
  },
  {
    "type": "event",
    "name": "MarkedDelivered",
    "inputs": [
      { "name": "id", "type": "uint256", "indexed": true },
      { "name": "timestamp", "type": "uint256", "indexed": false }
    ]
  },
  {
    "type": "event",
    "name": "DeliveryConfirmed",
    "inputs": [{ "name": "id", "type": "uint256", "indexed": true }]
  },
  {
    "type": "event",
    "name": "FundsReleased",
    "inputs": [
      { "name": "id", "type": "uint256", "indexed": true },
      { "name": "carrier", "type": "address", "indexed": true },
      { "name": "net", "type": "uint256", "indexed": false },
      { "name": "fee", "type": "uint256", "indexed": false }
    ]
  },
  {
    "type": "event",
    "name": "AutoReleased",
    "inputs": [
      { "name": "id", "type": "uint256", "indexed": true },
      { "name": "caller", "type": "address", "indexed": true }
    ]
  },
  {
    "type": "event",
    "name": "DisputeOpened",
    "inputs": [
      { "name": "id", "type": "uint256", "indexed": true },
      { "name": "opener", "type": "address", "indexed": true },
      { "name": "reason", "type": "string", "indexed": false }
    ]
  },
  {
    "type": "event",
    "name": "DisputeResolved",
    "inputs": [
      { "name": "id", "type": "uint256", "indexed": true },
      { "name": "carrierBps", "type": "uint256", "indexed": false },
      { "name": "carrierAmount", "type": "uint256", "indexed": false },
      { "name": "shipperAmount", "type": "uint256", "indexed": false }
    ]
  },
  {
    "type": "event",
    "name": "DisputeTimeoutResolved",
    "inputs": [
      { "name": "id", "type": "uint256", "indexed": true },
      { "name": "carrierAmount", "type": "uint256", "indexed": false },
      { "name": "shipperAmount", "type": "uint256", "indexed": false }
    ]
  },
  {
    "type": "event",
    "name": "ShipmentCancelled",
    "inputs": [{ "name": "id", "type": "uint256", "indexed": true }]
  },
  {
    "type": "event",
    "name": "ShipmentRefunded",
    "inputs": [{ "name": "id", "type": "uint256", "indexed": true }]
  },
  {
    "type": "event",
    "name": "ArbiterTransferStarted",
    "inputs": [
      { "name": "currentArbiter", "type": "address", "indexed": true },
      { "name": "pendingArbiter", "type": "address", "indexed": true }
    ]
  },
  {
    "type": "event",
    "name": "ArbiterChanged",
    "inputs": [
      { "name": "oldArbiter", "type": "address", "indexed": true },
      { "name": "newArbiter", "type": "address", "indexed": true }
    ]
  }
] as const;
