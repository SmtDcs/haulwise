import { useEffect, useState } from 'react';
import { createPublicClient, http, parseAbi } from 'viem';
import { Leaf, ExternalLink } from 'lucide-react';

// Green Lane runs on Arc Testnet (read-only here); the mainnet escrow is unchanged.
const RPC = 'https://rpc.testnet.arc.io';
const EXPLORER = 'https://explorer.testnet.arc.io';
export const GREENLANE_ADDRESS = '0xc84b618f6a2cc37c1c5daa60e9314d8dfcdf2569' as const;

const ABI = parseAbi([
  'function shipmentCount() view returns (uint256)',
  'function shipments(uint256) view returns (uint256 id, address shipper, address carrier, uint256 amount, uint256 pickupDeadline, uint256 deliveryDeadline, string metadataURI, uint8 status, uint256 pickedUpAt, uint256 deliveredAt, string disputeReason, uint256 disputedAt)',
  'function green(uint256) view returns (uint8 declaredMode, uint32 declaredDistanceKm, uint32 weightKg, bool attested, uint8 actualMode, uint32 actualDistanceKm, bool routeMatched, bool settled, uint256 bonus, uint256 co2eGrams)',
  'function greenScore(address) view returns (uint256)',
  'function intensityMgPerTkm(address) view returns (uint256)',
  'function factorMgPerTkm(uint8) view returns (uint256)',
]);

const MODES = ['Road', 'Rail', 'Sea', 'Air'];
const client = createPublicClient({ transport: http(RPC) });

interface Row {
  id: number;
  carrier: string;
  meta: string;
  declared: string;
  actual: string;
  matched: boolean;
  settled: boolean;
  bonus: number;
  kg: number;
}

export default function GreenLaneView() {
  const [rows, setRows] = useState<Row[]>([]);
  const [factors, setFactors] = useState<number[]>([]);
  const [carriers, setCarriers] = useState<{ addr: string; score: number; intensity: number }[]>([]);
  const [err, setErr] = useState('');
  const [calc, setCalc] = useState({ mode: 0, km: 450, t: 20 });

  useEffect(() => {
    (async () => {
      try {
        const n = Number(await client.readContract({ address: GREENLANE_ADDRESS, abi: ABI, functionName: 'shipmentCount' }));
        const f = await Promise.all([0, 1, 2, 3].map(m => client.readContract({ address: GREENLANE_ADDRESS, abi: ABI, functionName: 'factorMgPerTkm', args: [m] })));
        setFactors(f.map(Number));
        const out: Row[] = [];
        for (let i = n; i >= 1 && out.length < 20; i--) {
          const [s, g] = await Promise.all([
            client.readContract({ address: GREENLANE_ADDRESS, abi: ABI, functionName: 'shipments', args: [BigInt(i)] }),
            client.readContract({ address: GREENLANE_ADDRESS, abi: ABI, functionName: 'green', args: [BigInt(i)] }),
          ]);
          if (g[2] === 0) continue;
          out.push({
            id: i,
            carrier: s[2],
            meta: s[6],
            declared: `${MODES[g[0]]} · ${g[1]} km · ${(g[2] / 1000).toLocaleString()} t`,
            actual: g[3] ? `${MODES[g[4]]} · ${g[5]} km` : 'not attested',
            matched: g[6],
            settled: g[7],
            bonus: Number(g[8]) / 1e6,
            kg: Number(g[9]) / 1000,
          });
        }
        setRows(out);
        const uniq = [...new Set(out.map(r => r.carrier))];
        setCarriers(await Promise.all(uniq.map(async a => ({
          addr: a,
          score: Number(await client.readContract({ address: GREENLANE_ADDRESS, abi: ABI, functionName: 'greenScore', args: [a as `0x${string}`] })),
          intensity: Number(await client.readContract({ address: GREENLANE_ADDRESS, abi: ABI, functionName: 'intensityMgPerTkm', args: [a as `0x${string}`] })) / 1000,
        }))));
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  const est = factors.length ? (calc.t * calc.km * factors[calc.mode]) / 1e6 : 0;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="flex items-center gap-2 font-600 text-[var(--ink)]"><Leaf size={16} className="text-[var(--success)]" /> Green Lane (Arc Testnet)</div>
        <p className="text-sm text-[var(--muted)] mt-1">
          Each released shipment gets a CO2e estimate written on-chain (tonne-km × mode factor, DEFRA 2025 freighting-goods factors).
          Carriers build an emissions-intensity record, and an optional USDC green bonus is paid only when the attested route matches the declared mode within +10% distance.
        </p>
        <a className="inline-flex items-center gap-1 text-xs mono mt-2 text-[var(--ink-2)]" href={`${EXPLORER}/address/${GREENLANE_ADDRESS}`} target="_blank" rel="noopener noreferrer">
          {GREENLANE_ADDRESS} <ExternalLink size={12} />
        </a>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="font-500 text-[var(--ink)] mb-2 text-sm">Estimate (same formula as the contract)</div>
        <div className="flex flex-wrap gap-2 items-center text-sm">
          <select className="border border-[var(--border)] rounded px-2 py-1" value={calc.mode} onChange={e => setCalc({ ...calc, mode: Number(e.target.value) })}>
            {MODES.map((m, i) => <option key={m} value={i}>{m}</option>)}
          </select>
          <input type="number" min={1} className="w-24 border border-[var(--border)] rounded px-2 py-1" value={calc.km} onChange={e => setCalc({ ...calc, km: Number(e.target.value) })} /> km
          <input type="number" min={0} className="w-24 border border-[var(--border)] rounded px-2 py-1" value={calc.t} onChange={e => setCalc({ ...calc, t: Number(e.target.value) })} /> t
          <span className="font-600 text-[var(--ink)]">≈ {est.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg CO2e</span>
          {factors.length > 0 && <span className="text-xs text-[var(--subtle)]">factor {(factors[calc.mode] / 1e6).toFixed(5)} kg/tkm</span>}
        </div>
      </div>

      {err && <div className="text-sm text-[var(--danger)]">{err}</div>}

      {carriers.length > 0 && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 text-sm">
          <div className="font-500 text-[var(--ink)] mb-2">Carrier green scores</div>
          {carriers.map(c => (
            <div key={c.addr} className="flex justify-between mono text-xs py-1">
              <span>{c.addr.slice(0, 8)}…{c.addr.slice(-6)}</span>
              <span>score {c.score}/100 · {c.intensity.toFixed(1)} g CO2e/tkm</span>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 text-sm overflow-x-auto">
        <div className="font-500 text-[var(--ink)] mb-2">Green shipments</div>
        <table className="w-full text-xs">
          <thead className="text-[var(--subtle)] text-left">
            <tr><th className="py-1">#</th><th>Declared</th><th>Attested</th><th>CO2e</th><th>Bonus</th></tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-t border-[var(--border)]">
                <td className="py-1.5">{r.id}</td>
                <td>{r.declared}<div className="text-[var(--subtle)]">{r.meta}</div></td>
                <td>{r.actual}</td>
                <td>{r.settled ? `${r.kg.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg` : 'pending'}</td>
                <td>{r.bonus > 0 ? `${r.bonus} USDC → ${!r.settled ? 'held' : r.matched ? 'carrier' : 'returned to shipper'}` : '-'}</td>
              </tr>
            ))}
            {rows.length === 0 && !err && <tr><td colSpan={5} className="py-2 text-[var(--muted)]">Loading…</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
