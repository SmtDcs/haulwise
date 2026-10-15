import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { SettlementAgent } from './agent.js';
import { cfg } from './config.js';
import { DEFAULT_POLICY, type Policy } from './types.js';
import { loadWallets } from './wallets.js';

const TOKEN = process.env.AGENT_ADMIN_TOKEN ?? '';
const TICK_MS = Number(process.env.TICK_MS ?? 30_000);

async function body(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}
const ORIGINS = (process.env.ALLOWED_ORIGINS ?? '*').split(',').map(s => s.trim());
let reqOrigin = '';
function send(res: ServerResponse, code: number, data: unknown) {
  const allow = ORIGINS.includes('*') ? '*' : ORIGINS.includes(reqOrigin) ? reqOrigin : ORIGINS[0];
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': allow, vary: 'origin', 'access-control-allow-headers': 'content-type, authorization', 'access-control-allow-methods': 'GET, POST, PUT, OPTIONS' });
  res.end(JSON.stringify(data, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
}
const authorized = (req: IncomingMessage) => !TOKEN || req.headers.authorization === `Bearer ${TOKEN}`;

// First boot on an empty volume: start from the committed testnet run instead of a blank log.
import { cpSync, existsSync as exists } from 'node:fs';
const seedDir = new URL('../seed', import.meta.url).pathname;
if (!exists(`${cfg.dataDir}/decisions.jsonl`) && exists(seedDir)) { cpSync(seedDir, cfg.dataDir, { recursive: true }); console.log('seeded data dir from seed/'); }

const agent = new SettlementAgent(await loadWallets());
console.log(`Haulwise Settlement Agent · escrow ${cfg.escrow} · planner ${agent.planner} · ${agent.wallets.length} wallets`);

let lastTick: { at: number; scanned: number; acted: number } | null = null;
let ticking = false;
async function loop() {
  if (ticking) return;
  ticking = true;
  try { lastTick = { at: Date.now(), ...(await agent.tick()) }; } catch (e) { console.error('tick failed', e); } finally { ticking = false; }
}
setInterval(loop, TICK_MS); loop();

function metrics() {
  const d = agent.ledger.all();
  const count = (a: string) => d.filter(x => x.action === a).length;
  const settled = d.filter(x => (x.action === 'confirm' || x.action === 'auto_release' || (x.action === 'approved' && x.txHash)) && x.txHash);
  const decided = count('confirm') + count('dispute') + count('request_approval');
  const humanAgreed = agent.state.approvals.filter(a => a.status === 'approved').length;
  return {
    decisions: d.length, autoConfirmed: count('confirm'), disputed: count('dispute'), escalated: count('request_approval'), autoReleased: count('auto_release'),
    settledUSDC: settled.reduce((a, x) => a + (x.amountUSDC ?? 0), 0), autonomyRate: decided ? (count('confirm') + count('dispute')) / decided : 0,
    humanAgreedWithEscalation: humanAgreed, humanOverrode: agent.state.approvals.filter(a => a.status === 'rejected').length,
  };
}

createServer(async (req, res) => {
  try {
    reqOrigin = String(req.headers.origin ?? '');
    const url = new URL(req.url ?? '/', 'http://x');
    if (req.method === 'OPTIONS') return send(res, 204, {});
    if (req.method === 'GET' && url.pathname === '/api/status')
      return send(res, 200, { escrow: cfg.escrow, chainId: 5042002, planner: agent.planner, lastTick, ledger: agent.ledger.verify(), metrics: metrics(),
        wallets: agent.wallets.map(w => ({ label: w.label, role: w.role, address: w.address, provider: w.provider })), policy: agent.state.policy });
    if (req.method === 'GET' && url.pathname === '/api/decisions') return send(res, 200, agent.ledger.all().slice().reverse().slice(0, Number(url.searchParams.get('limit') ?? 100)));
    if (req.method === 'GET' && url.pathname === '/api/approvals') return send(res, 200, agent.state.approvals.slice().reverse());

    if (!authorized(req)) return send(res, 401, { error: 'unauthorized' });
    let m;
    if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/approvals\/([\w-]+)$/))) {
      const { decision, by, note } = JSON.parse((await body(req)).toString() || '{}');
      if (decision !== 'approve' && decision !== 'reject') return send(res, 400, { error: 'decision must be approve|reject' });
      return send(res, 200, await agent.resolveApproval(m[1], decision, by || 'finance', note));
    }
    if (req.method === 'PUT' && url.pathname === '/api/policy') {
      const patch = JSON.parse((await body(req)).toString() || '{}') as Partial<Policy>;
      for (const k of Object.keys(patch)) if (!(k in DEFAULT_POLICY)) return send(res, 400, { error: `unknown policy key ${k}` });
      agent.state.policy = { ...agent.state.policy, ...patch }; agent.save();
      agent.ledger.append({ action: 'observe', rationale: `Policy updated: ${JSON.stringify(patch)}`, planner: 'human' });
      return send(res, 200, agent.state.policy);
    }
    if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/documents\/(\d+)$/))) {
      const kind = url.searchParams.get('kind') === 'pod' ? 'pod' : 'invoice';
      agent.saveDocument(Number(m[1]), kind, url.searchParams.get('filename') ?? `${kind}.txt`, await body(req));
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/tick') { await loop(); return send(res, 200, lastTick); }
    send(res, 404, { error: 'not found' });
  } catch (e: any) { send(res, 500, { error: e?.message ?? String(e) }); }
}).listen(cfg.port, () => console.log(`API on :${cfg.port}`));
