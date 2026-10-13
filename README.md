# CargoBill — Freight Settlement dApp

USDC-native escrow for freight carriers and shippers, deployed on Arc Testnet.

## Contract

| Field | Value |
|---|---|
| Network | Arc Testnet (chain ID 5042002) |
| Address | `0x016e722f13bde933a31e2ee281e76a8419a14567` |
| Explorer | https://explorer.testnet.arc.io/address/0x016e722f13bde933a31e2ee281e76a8419a14567 |
| USDC | `0x3600000000000000000000000000000000000000` |
| Protocol fee | 0.5% on release |
| Auto-release delay | 48 hours after carrier marks delivered |

## Architecture

### Smart Contract (`contracts/CargoBill.sol`)

- Shippers deposit USDC via `createShipment(carrier, amount, deadline, metadataURI)`.
- Carrier picks up with `markPickedUp(id)`, then marks delivered with `markDelivered(id)`.
- Shipper confirms with `confirmDelivery(id)` — releases net amount to carrier + 0.5% fee to protocol.
- `autoRelease(id)` — anyone can release 48h after carrier marks delivered.
- `openDispute(id, reason)` by either party freezes funds.
- `resolveDispute(id, carrierBps)` by arbiter splits funds by basis points.
- `cancel(id)` — shipper refunds if carrier hasn't picked up.
- On-chain carrier reputation: `completed`, `disputed`, `late` counters.
- Full OpenZeppelin SafeERC20 + ReentrancyGuard protection.

### Frontend (`src/`)

- **Header**: wallet connect, Shipper / Carrier role toggle.
- **Shipper view**: create shipment form (USDC approve + createShipment), shipment list, confirm / dispute / cancel actions.
- **Carrier view**: incoming jobs, mark picked up / delivered, earnings total, reputation badge.
- **Shipment detail**: status timeline, countdown, action buttons, dispute form, tx explorer links.
- **Settlement Agent panel**: AI monitor that flags overdue shipments, risky carriers, and available auto-releases; maintains an audit log of all suggestions and on-chain actions.
- **Demo seeder**: creates 3 shipments with your wallet as both shipper and carrier for a self-contained demo.

## Setup

```bash
bun install
```

Copy the contract address to `.env`:
```
VITE_CARGOBILL_ADDRESS=0x016e722f13bde933a31e2ee281e76a8419a14567
```

Start the dev server:
```bash
bun run dev
```

## 2-Minute Demo Flow

1. Connect your wallet (MetaMask or any EVM wallet) and switch to Arc Testnet (chain ID 5042002).
2. Get test USDC from the "Get test USDC" button in the Arc Studio sidebar.
3. Click **Seed Demo Data** — creates 3 shipments where your address is both shipper and carrier.
4. In **Shipper** mode, open a shipment → it shows `Created`.
5. Switch to **Carrier** mode → click **Mark Picked Up**. Confirm in wallet.
6. Click **Mark Delivered**. Confirm in wallet.
7. Switch back to **Shipper** → the shipment shows `Delivered` with a countdown.
8. Click **Confirm Delivery & Release Funds** → USDC releases to carrier minus 0.5% fee.
9. Watch the Settlement Agent panel log each action and flag any overdue or risky shipments.
10. Create a second shipment, mark picked up, then open a dispute to see the dispute flow.

## Tests

```bash
cd /home/user/app && forge test
```

69 tests covering all functions, happy paths, revert cases, fuzz suites (fee arithmetic, bps splits), and an invariant (contract balance = sum of open escrow).

## Contract Functions

| Function | Who | Description |
|---|---|---|
| `createShipment(carrier, amountUSDC, deadline, metadataURI)` | Shipper | Deposits USDC into escrow |
| `markPickedUp(id)` | Carrier | Confirms pickup before deadline |
| `markDelivered(id)` | Carrier | Confirms delivery |
| `confirmDelivery(id)` | Shipper | Releases funds (net to carrier + 0.5% fee) |
| `autoRelease(id)` | Anyone | Releases 48h after delivery if shipper hasn't confirmed |
| `openDispute(id, reason)` | Shipper or Carrier | Freezes funds, sets dispute reason |
| `resolveDispute(id, carrierBps)` | Arbiter | Splits funds by basis points |
| `cancel(id)` | Shipper | Refunds shipper if carrier hasn't picked up |
| `changeArbiter(newArbiter)` | Arbiter | Rotates the arbiter address |
