import { createPublicClient, http } from 'viem';
import { escrowAbi } from './abi.js';
import { arcTestnet, cfg } from './config.js';
import type { Address, Reputation, Shipment } from './types.js';

export const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });

export async function readShipment(id: number, escrow: Address = cfg.escrow): Promise<Shipment> {
  const r = await publicClient.readContract({ address: escrow, abi: escrowAbi, functionName: 'shipments', args: [BigInt(id)] });
  return {
    id: Number(r[0]), shipper: r[1], carrier: r[2], amount: r[3],
    pickupDeadline: Number(r[4]), deliveryDeadline: Number(r[5]), metadataURI: r[6], status: r[7],
    pickedUpAt: Number(r[8]), deliveredAt: Number(r[9]), disputeReason: r[10], disputedAt: Number(r[11]),
  };
}

export async function readAllShipments(escrow: Address = cfg.escrow): Promise<Shipment[]> {
  const n = Number(await publicClient.readContract({ address: escrow, abi: escrowAbi, functionName: 'shipmentCount' }));
  const ids = Array.from({ length: n }, (_, i) => i + 1);
  const out: Shipment[] = [];
  for (let i = 0; i < ids.length; i += 20) out.push(...(await Promise.all(ids.slice(i, i + 20).map(id => readShipment(id, escrow)))));
  return out;
}

export async function readReputation(a: Address, escrow: Address = cfg.escrow): Promise<Reputation> {
  const [completed, disputed, late] = await publicClient.readContract({ address: escrow, abi: escrowAbi, functionName: 'reputation', args: [a] });
  return { completed: Number(completed), disputed: Number(disputed), late: Number(late) };
}

export async function chainNow(): Promise<number> {
  return Number((await publicClient.getBlock()).timestamp);
}
