# CargoBill — Freight Settlement dApp

USDC-native freight escrow dApp built for the Arc network. Shippers deposit USDC into escrow, carriers haul and deliver freight under on-chain deadlines and SLA reputation tracking, and fair dispute resolution is enforced with 14-day timeout safeguards and two-step governance.

---

## Architecture & Contract Rules (`contracts/CargoBill.sol`)

### 1. Dual Deadlines (`pickupDeadline` and `deliveryDeadline`)
- When creating a shipment via `createShipment(carrier, amountUSDC, pickupDeadline, deliveryDeadline, metadataURI)`:
  - Requires `carrier != msg.sender` and `carrier != address(0)`.
  - Requires `pickupDeadline > block.timestamp`.
  - Requires `deliveryDeadline > pickupDeadline`.
  - `metadataURI` is restricted to a maximum of 256 bytes.
- Carrier confirms pickup via `markPickedUp(id)` which requires `block.timestamp <= pickupDeadline`.

### 2. Cancellation
- Shipper can call `cancel(id)` **only** when `status == Created` and `block.timestamp >= pickupDeadline`.
- Shipper receives a 100% refund.
- No carrier late penalty is assessed on cancellation.

### 3. Delivery & Late SLA Reputation
- Carrier marks shipment delivered via `markDelivered(id)`.
- If delivered late (`deliveredAt > deliveryDeadline`), `reputation[carrier].late` is incremented upon release.
- Shipper confirms delivery with `confirmDelivery(id)`: releases net funds to carrier (minus 0.5% protocol fee to `feeRecipient`) and increments `reputation[carrier].completed`.
- Auto-release: Anyone can trigger `autoRelease(id)` 48 hours after delivery if the shipper has not yet confirmed.

### 4. Refund for Undelivered Cargo (`refundUndelivered`)
- If a shipment has been picked up (`status == PickedUp`) and has not been delivered within 7 days past the delivery deadline (`block.timestamp > deliveryDeadline + 7 days`):
  - Only the shipper can call `refundUndelivered(id)`.
  - Shipper receives a 100% refund of escrowed USDC.
  - Carrier receives a late strike: `reputation[carrier].late++`.
  - Shipment transitions to `ShipmentStatus.Refunded` and emits `ShipmentRefunded(id)`.

### 5. Dispute Resolution & Escalation Timeout
- Either party can call `openDispute(id, reason)` during `PickedUp` or `Delivered` status. Dispute reasons are restricted to a maximum of 256 bytes. `disputedAt` timestamp is recorded.
- Arbiter resolves via `resolveDispute(id, carrierBps)`:
  - Carrier disputed counter `reputation[carrier].disputed` increments **only if** `carrierBps < 5000` (carrier lost).
  - Shipper disputed counter `shipperDisputesLost[shipper]` increments **if** `carrierBps >= 5000` (shipper lost), and is exposed via `getShipperDisputesLost(shipper)`.
- Escalation Timeout: If a dispute remains unresolved for 14 days (`block.timestamp >= disputedAt + 14 days`), **anyone** can call `escalateTimeout(id)`:
  - Funds are automatically split 50/50 between carrier and shipper (consistent with `resolveDispute` fee logic).
  - Shipment transitions to `ShipmentStatus.Resolved` and emits `DisputeResolved` & `DisputeTimeoutResolved`.

### 6. Two-Step Arbiter Transfer
- Arbiter rotation requires a safe two-step handshake:
  1. `transferArbiter(newArbiter)`: Called by the current arbiter to set `pendingArbiter`.
  2. `acceptArbiter()`: Called by `pendingArbiter` to claim the arbiter role.

---

## Contract Function Reference

| Function | Caller | Description |
|---|---|---|
| `createShipment(carrier, amount, pickupDeadline, deliveryDeadline, metadataURI)` | Shipper | Deposits USDC into escrow with dual deadlines |
| `markPickedUp(id)` | Carrier | Confirms pickup before `pickupDeadline` |
| `markDelivered(id)` | Carrier | Confirms delivery |
| `confirmDelivery(id)` | Shipper | Releases funds (net to carrier, 0.5% fee to `feeRecipient`) |
| `autoRelease(id)` | Anyone | Releases funds 48h after delivery |
| `refundUndelivered(id)` | Shipper | Full refund if undelivered 7 days past delivery deadline |
| `openDispute(id, reason)` | Shipper / Carrier | Freezes escrow and starts dispute period |
| `resolveDispute(id, carrierBps)` | Arbiter | Resolves dispute by basis points and updates loser reputation |
| `escalateTimeout(id)` | Anyone | Splits escrow 50/50 if dispute is unresolved after 14 days |
| `cancel(id)` | Shipper | Refunds shipper if carrier failed to pick up by `pickupDeadline` |
| `transferArbiter(newArbiter)` | Arbiter | Proposes a new arbiter address |
| `acceptArbiter()` | Pending Arbiter | Claims the arbiter role |
| `getShipperDisputesLost(shipper)` | Anyone | Returns count of disputes lost by shipper |

---

## Local Setup

### Prerequisites
- Node.js 20+
- Foundry (`forge`)

### Install Dependencies
```bash
npm install
```

### Run Local Development Server
```bash
npm run dev
```

### Typecheck & Build
```bash
npx tsc --noEmit -p .
npm run build
```

---

## Smart Contract Tests

Run the Foundry test suite:

```bash
forge test
```

The suite covers:
- Complete happy paths and revert cases for all functions.
- Pickup deadline constraints and post-pickup deadline cancellation.
- Undelivered shipment 7-day refund mechanism and carrier reputation penalties.
- Dispute resolution with carrier/shipper loss accounting.
- 14-day dispute escalation timeout with 50/50 split.
- 256-byte limit checks for metadata URI and dispute reasons.
- Two-step arbiter transfer.
- Fuzz suites for protocol fee math and dispute split conservation.
- Invariant testing (`CargoBillInvariantTest`) ensuring contract balance equals open escrow balances across randomized actions.

---

## Deployment

Deploy using the Forge script `contracts/script/DeployCargoBill.s.sol`.

### Arc Mainnet (Chain ID: 5042)

```bash
USDC=0x3600000000000000000000000000000000000000 \
FEE_RECIPIENT=<FEE_RECIPIENT_ADDRESS> \
ARBITER=<ARBITER_ADDRESS> \
forge script contracts/script/DeployCargoBill.s.sol \
  --rpc-url https://rpc.mainnet.arc.io \
  --broadcast
```

### Arc Testnet (Chain ID: 5042002)

```bash
USDC=0x3600000000000000000000000000000000000000 \
FEE_RECIPIENT=<FEE_RECIPIENT_ADDRESS> \
ARBITER=<ARBITER_ADDRESS> \
forge script contracts/script/DeployCargoBill.s.sol \
  --rpc-url https://rpc.testnet.arc.io \
  --broadcast
```

---

## Frontend Configuration (`.env`)

Configure the frontend environment in `.env`:

```env
# Deployed CargoBill contract address
VITE_CARGOBILL_ADDRESS=0x016e722f13bde933a31e2ee281e76a8419a14567

# Network selection: 'arc' (Mainnet) or 'arcTestnet' (Testnet, default)
VITE_CHAIN=arcTestnet
```

- When `VITE_CHAIN=arc`: Frontend connects to Arc Mainnet (Chain ID 5042, RPC `https://rpc.mainnet.arc.io`).
- When `VITE_CHAIN=arcTestnet` (or omitted): Frontend connects to Arc Testnet (Chain ID 5042002, RPC `https://rpc.testnet.arc.io`).
