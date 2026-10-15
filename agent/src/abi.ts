import { parseAbi } from 'viem';
export const escrowAbi = parseAbi([
  'function shipmentCount() view returns (uint256)',
  'function shipments(uint256) view returns (uint256 id, address shipper, address carrier, uint256 amount, uint256 pickupDeadline, uint256 deliveryDeadline, string metadataURI, uint8 status, uint256 pickedUpAt, uint256 deliveredAt, string disputeReason, uint256 disputedAt)',
  'function reputation(address) view returns (uint256 completed, uint256 disputed, uint256 late)',
  'function createShipment(address carrier, uint256 amountUSDC, uint256 pickupDeadline, uint256 deliveryDeadline, string metadataURI) returns (uint256)',
  'function markPickedUp(uint256 id)',
  'function markDelivered(uint256 id)',
  'function confirmDelivery(uint256 id)',
  'function autoRelease(uint256 id)',
  'function openDispute(uint256 id, string reason)',
  'function cancel(uint256 id)',
]);
export const erc20Abi = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
]);
