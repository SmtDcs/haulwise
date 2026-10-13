import { useReadContract, useReadContracts } from 'wagmi';
import { CARGOBILL_ABI, CARGOBILL_ADDRESS } from '../lib/cargobill';
import { Shipment, Reputation, ShipmentStatus } from '../types/cargo';

function parseShipment(
  raw: readonly [bigint, string, string, bigint, bigint, bigint, string, number, bigint, bigint, string, bigint] | undefined
): Shipment | null {
  if (!raw) return null;
  return {
    id: raw[0],
    shipper: raw[1] as `0x${string}`,
    carrier: raw[2] as `0x${string}`,
    amount: raw[3],
    pickupDeadline: raw[4],
    deliveryDeadline: raw[5],
    metadataURI: raw[6],
    status: raw[7] as ShipmentStatus,
    pickedUpAt: raw[8],
    deliveredAt: raw[9],
    disputeReason: raw[10],
    disputedAt: raw[11],
  };
}

export function useShipmentCount() {
  return useReadContract({
    address: CARGOBILL_ADDRESS || undefined,
    abi: CARGOBILL_ABI,
    functionName: 'shipmentCount',
    query: { enabled: !!CARGOBILL_ADDRESS },
  });
}

export function useShipment(id: number) {
  const result = useReadContract({
    address: CARGOBILL_ADDRESS || undefined,
    abi: CARGOBILL_ABI,
    functionName: 'shipments',
    args: [BigInt(id)],
    query: { enabled: !!CARGOBILL_ADDRESS && id > 0 },
  });
  return {
    ...result,
    shipment: parseShipment(result.data as readonly [bigint, string, string, bigint, bigint, bigint, string, number, bigint, bigint, string, bigint] | undefined),
  };
}

export function useAllShipments(count: number) {
  const contracts = Array.from({ length: count }, (_, i) => ({
    address: CARGOBILL_ADDRESS,
    abi: CARGOBILL_ABI,
    functionName: 'shipments' as const,
    args: [BigInt(i + 1)] as const,
  }));

  const results = useReadContracts({
    contracts,
    query: { enabled: !!CARGOBILL_ADDRESS && count > 0 },
  });

  const shipments: Shipment[] = [];
  if (results.data) {
    for (const r of results.data) {
      if (r.status === 'success' && r.result) {
        const s = parseShipment(r.result as readonly [bigint, string, string, bigint, bigint, bigint, string, number, bigint, bigint, string, bigint]);
        if (s) shipments.push(s);
      }
    }
  }

  return { ...results, shipments };
}

export function useReputation(address: `0x${string}` | undefined) {
  const result = useReadContract({
    address: CARGOBILL_ADDRESS || undefined,
    abi: CARGOBILL_ABI,
    functionName: 'reputation',
    args: address ? [address] : undefined,
    query: { enabled: !!CARGOBILL_ADDRESS && !!address },
  });

  const raw = result.data;
  const reputation: Reputation | null = raw
    ? { completed: raw[0], disputed: raw[1], late: raw[2] }
    : null;

  return { ...result, reputation };
}

export function useShipperDisputesLost(address: `0x${string}` | undefined) {
  const result = useReadContract({
    address: CARGOBILL_ADDRESS || undefined,
    abi: CARGOBILL_ABI,
    functionName: 'shipperDisputesLost',
    args: address ? [address] : undefined,
    query: { enabled: !!CARGOBILL_ADDRESS && !!address },
  });

  return {
    ...result,
    disputesLost: result.data ? BigInt(result.data) : 0n,
  };
}
