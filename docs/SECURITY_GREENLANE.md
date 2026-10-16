# Security & data integrity: Green Lane

## Trust model
| Role | Can do | Cannot do |
|---|---|---|
| Shipper | create shipments, lock rate + bonus, confirm delivery, cancel/refund per CargoBill rules | change emissions data after creation |
| Carrier | pickup / delivered | attest its own route (the attestor is a separate address) |
| Attestor (settlement agent) | `attestRoute` while the shipment is PickedUp/Delivered | move funds; attest before pickup or after settlement |
| Arbiter | resolve disputes, `setFactor`, `setAttestor` | take escrowed funds (CargoBill rules unchanged) |

## Properties checked by tests (`contracts/test/HaulwiseGreenLane.t.sol`)
- The bonus is always either paid to the carrier or returned to the shipper. It is never stranded: the contract balance is 0 after release and after dispute.
- Emissions are recorded only on real release (confirm/autoRelease). Cancel, refund and disputes record none and return the bonus.
- `_afterSettle` runs at most once per shipment (`settled` flag), and plain CargoBill shipments are untouched.
- Access control on `attestRoute`, `setFactor` and `setAttestor`; factor bounds (0 < f ≤ 10 kg/tkm); input bounds on distance (≤ 40,000 km) and weight (≤ 100,000 t), which keep `weightKg × km × factor` far below uint256 overflow.
- A fuzz test checks the CO2e formula.
- All 81 original CargoBill tests, including the invariant test, still pass with the hook added.

## Reentrancy and token handling
Every settlement path that reaches the hook is `nonReentrant` in CargoBill. The hook sets state (`settled`, reputation) before transfers and uses OpenZeppelin `SafeERC20`. The only token is Arc USDC.

## Known risks / not yet done
- **Attestor honesty.** A dishonest or compromised attestor could approve a mismatched route and pay the bonus. Mitigations: arbiter can rotate the attestor, every attestation is an event, and the next step is to require signed telematics evidence (hash in the attestation).
- **Self-declared weight/distance** when no attestation exists. Reputation shows the attested share, so unattested history is visible.
- **Factor governance.** A single arbiter key; should become a multisig.
- **Not audited.** Testnet only for Green Lane. The mainnet Haulwise escrow (`0xc63c…653E`) is a separate, unchanged deployment.
- **Privacy.** Distance, weight and mode are public on-chain. Route geometry is not stored, only km.
