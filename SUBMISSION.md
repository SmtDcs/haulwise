# Tameion submission draft: Haulwise Settlement Agent

**Project name:** Haulwise

**One-liner:** An accounts-payable agent for freight. It reads carrier invoices and proofs of delivery, matches them against USDC escrow on Arc, then pays, disputes, or escalates within a spending policy enforced in code.

**Repo:** https://github.com/SmtDcs/haulwise
**Live app:** https://haulwise-arc.vercel.app (Agent tab reads the hosted agent)
**Agent API:** https://haulwise-agent-production.up.railway.app/api/status (decision log: https://haulwise-agent-production.up.railway.app/api/decisions)
**Video:** TODO (Loom/YouTube, under 3 min)

**RFB:** 2 (AP/AR automation) and 3 (contractor/vendor network: milestone escrow and reputation).

## What it does
Haulwise escrows freight payments in USDC on Arc. Its Settlement Agent does a shipper's freight AP work:
- Reads each carrier's invoice and POD (PDF or text). With an LLM configured, the model extracts the fields itself.
- Three-way match: escrow terms (PO) vs invoice vs POD. It checks amount, payout wallet (catches invoice redirection), PO reference, lane, POD signature and date against the on-chain pickup and delivery timestamps, duplicate invoice numbers across loads, and carrier dispute history.
- Policy gate in code: per-shipment and rolling 24h auto-confirm limits, a lower limit for new carriers, escalation for late deliveries, blocked carriers.
- Actions: confirm delivery (release), open a dispute with the evidence written on-chain (256-byte reason), hold while the POD is missing, or escalate to finance with a recommendation. It escalates before the carrier's 48h auto-release window closes, and on the receivables side it calls autoRelease for carriers it manages.
- Hash-chained, append-only decision log. Every action carries its findings, its rationale, which planner made it, and the tx hash.

## Agency
The agent decides when to pay and explains why. The limit sits somewhere the agent can't reach: the model proposes, and `policy.ts` decides what's allowed before anything is signed. `confirm_delivery` only goes through after `reconcile` has returned a `confirm` verdict.

## Circle tools
- **Arc + USDC:** escrow, settlement and gas, all in USDC (testnet for the agent: escrow 0x8975c51D4891C8aa44B6f4C6D377ca6081866E79, Sourcify exact match; the escrow is also live on Arc mainnet at 0xc63caf75a63b53Cf0d30f599766824223ecb653E).
- **Circle developer-controlled wallets:** one wallet per shipper, per carrier and for the treasury on ARC-TESTNET, sending through `createContractExecutionTransaction`. Funded from the Circle testnet faucet.
- **CCTP V2:** treasury top-up from Base, Ethereum or Arbitrum Sepolia (burn, Iris attestation, receiveMessage on Arc domain 26).
- **Contracts:** the Haulwise escrow (Solidity, 81 Foundry tests including an invariant test, Sourcify-verified on mainnet).

## Traction (Arc testnet, 15 Oct 2026, real transactions)
- Escrow: [0x8975c51D4891C8aa44B6f4C6D377ca6081866E79](https://explorer.testnet.arc.io/address/0x8975c51D4891C8aa44B6f4C6D377ca6081866E79), deploy tx [0x5903c6b8…c5e9](https://explorer.testnet.arc.io/tx/0x5903c6b8cd2ca65cd4c828dc1daf0d27309af1cd3b6f4f8d7eaf820e2320c5e9)
- 6 Circle developer-controlled wallets (treasury, 2 shippers, 3 carriers); treasury [0xa5ef…d392](https://explorer.testnet.arc.io/address/0xa5ef79da33cffc5eba6404ff42b9c9cc0f66d392)
- 24 shipments created, picked up and delivered on-chain; 32.84 USDC escrowed
- 99 transactions from the agent wallets: 78 for funding, approvals and shipment lifecycle, 21 agent settlement actions
- Agent decisions (planner: deepseek-chat inside the policy gate): 24 total
  - 14 released (14.16 USDC), e.g. [#1](https://explorer.testnet.arc.io/tx/0x8097c41e44f317d86f1a157871559a8000452450820ef3b42834a22356aa49bf)
  - 7 disputed with the reason on-chain (8.72 USDC frozen): 2 over-billed, 2 wrong payout wallet, 2 duplicate invoice numbers, 1 wrong lane, e.g. wrong payee [#8](https://explorer.testnet.arc.io/tx/0x6829221f6891e0a5d0eb6f5047b49f6699066b8b53a33cb3ce512cb6f82fe19b), duplicate [#10](https://explorer.testnet.arc.io/tx/0x1084beea0c9df2bdfe4730e5fa13cc2a471164cf0c784286dddd37427f0e3d96)
  - 2 escalated to finance (4.50 USDC each, above the auto-confirm limit)
  - 1 on hold (POD missing)
  - 24 of 24 matched the expected outcome for its scenario; 0 wrong payouts
- Businesses: the testnet flows run between demo wallets we control. No outside shipper or carrier yet.
- Mainnet: shipment #1, a 0.10 USDC end-to-end run (create, pickup, deliver, confirm), https://explorer.arc.io/tx/0x478af24abeb662276fe17060f617cbe43d1b4899e7f3885ac9adf4059feb00db

## Before Tameion vs now (the delta)
- Before (Oct 14): an escrow contract on Arc mainnet and a React app with shipper, carrier and arbiter views, plus one mainnet test shipment.
- During Tameion: the Settlement Agent service (matching, policy, LLM planner, ledger, API), Circle wallet integration, CCTP funding, the testnet deployment with scripted traffic, the Agent tab, and 22 agent tests including a live-model test with a prompt-injection invoice.

## After the event
Next: a carrier-side agent (invoice factoring against escrow), EURC for EU lanes, and Gateway for a unified balance across shipper entities.
