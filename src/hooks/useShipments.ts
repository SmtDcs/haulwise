import { useReadContract, useReadContracts } from 'wagmi';
import { CARGOBILL_ABI, CARGOBILL_ADDRESS } from '../lib/cargobill';
import { Shipment, Reputation, ShipmentStatus } from '../types/cargo';

function parseShipment(raw: readonly [bigint, string, string, bigint, bigint, string, number, bigint, bigint, string] | undefined): Shipment | null {
  if (!raw) return null;
  return {
    id: raw[0],
    shipper: raw[1] as `0x${string}`,
    carrier: raw[2] as `0x${string}`,
    amount: raw[3],
    deadline: raw[4],
    metadataURI: raw[5],
    status: raw[6] as ShipmentStatus,
    pickedUpAt: raw[7],
    deliveredAt: raw[8],
    disputeReason: raw[9],
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
    shipment: parseShipment(result.data),
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
        const s = parseShipment(r.result);
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
