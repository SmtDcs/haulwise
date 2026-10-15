import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { escrowAbi } from './abi.js';
import { chainNow, readAllShipments, readReputation, readShipment } from './chain.js';
import { cfg } from './config.js';
import { documentText, extractFields, parseTerms } from './invoice.js';
import { Ledger } from './ledger.js';
import { chat, detectLlm, type ChatMessage, type LlmConfig, type ToolSpec } from './llm.js';
import { clampBytes, disputeReason, invoiceFingerprint, reconcile } from './matcher.js';
import { evaluate, isAutoReleaseDue, REVIEW_DEADLINE_WARNING } from './policy.js';
import { DEFAULT_POLICY, Status, type Address, type Finding, type InvoiceFields, type Policy, type Shipment, type Verdict } from './types.js';
import type { AgentWallet } from './wallets.js';

export interface Approval {
  id: string;
  shipmentId: number;
  action: 'confirm' | 'dispute';
  amountUSDC: number;
  reasons: string[];
  draftDisputeReason?: string;
  agentRecommendation: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number;
  resolvedAt?: number;
  resolvedBy?: string;
  txHash?: string;
}

interface Reconciled { fields: InvoiceFields; findings: Finding[]; verdict: Verdict; at: number }

interface State {
  policy: Policy;
  seenInvoices: Record<string, number>;
  approvals: Approval[];
  reconciled: Record<number, Reconciled>;
  /** shipmentId -> status at which the agent last took a terminal decision */
  handled: Record<number, string>;
}

const usd = (v: bigint) => Number(v) / 1e6;

export class SettlementAgent {
  ledger: Ledger;
  state: State;
  llm: LlmConfig | null;
  private stateFile: string;

  constructor(public wallets: AgentWallet[], public escrow: Address = cfg.escrow, public dataDir = cfg.dataDir) {
    mkdirSync(join(dataDir, 'docs'), { recursive: true });
    this.ledger = new Ledger(join(dataDir, 'decisions.jsonl'));
    this.stateFile = join(dataDir, 'state.json');
    this.state = existsSync(this.stateFile)
      ? JSON.parse(readFileSync(this.stateFile, 'utf8'))
      : { policy: { ...DEFAULT_POLICY }, seenInvoices: {}, approvals: [], reconciled: {}, handled: {} };
    this.llm = detectLlm();
  }

  get planner() { return this.llm ? `llm:${this.llm.name}` : 'rules'; }
  save() { writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2)); }

  shipperWallets() {
    const want = cfg.shippers.map(a => a.toLowerCase());
    return this.wallets.filter(w => w.role === 'shipper' && (!want.length || want.includes(w.address.toLowerCase())));
  }
  walletFor(addr: Address) { return this.wallets.find(w => w.address.toLowerCase() === addr.toLowerCase()); }

  // ---------- documents ----------
  docDir(id: number) { return join(this.dataDir, 'docs', String(id)); }
  async documents(id: number): Promise<{ invoice?: string; pod?: string }> {
    const dir = this.docDir(id);
    if (!existsSync(dir)) return {};
    const out: { invoice?: string; pod?: string } = {};
    for (const f of readdirSync(dir)) {
      if (f.startsWith('invoice')) out.invoice = await documentText(join(dir, f));
      if (f.startsWith('pod')) out.pod = await documentText(join(dir, f));
    }
    return out;
  }
  saveDocument(id: number, kind: 'invoice' | 'pod', filename: string, body: Buffer) {
    mkdirSync(this.docDir(id), { recursive: true });
    const ext = filename.toLowerCase().endsWith('.pdf') ? 'pdf' : 'txt';
    writeFileSync(join(this.docDir(id), `${kind}.${ext}`), body);
  }

  confirmedLast24h(now = Date.now()) {
    return this.ledger.all()
      .filter(d => (d.action === 'confirm') && now - d.ts < 86_400_000 && d.txHash)
      .reduce((a, d) => a + (d.amountUSDC ?? 0), 0);
  }

  // ---------- tools (shared by LLM and rules planner) ----------
  async toolReconcile(s: Shipment, fields: InvoiceFields, hasPod: boolean): Promise<Reconciled> {
    const reputation = await readReputation(s.carrier, this.escrow);
    const findings = reconcile({
      shipment: s, terms: parseTerms(s.metadataURI), fields, reputation,
      amountTolerance: this.state.policy.amountTolerance, seenInvoices: this.state.seenInvoices, hasPod,
    });
    const verdict = evaluate(this.state.policy, { shipment: s, findings, reputation, confirmedLast24h: this.confirmedLast24h(), now: Date.now() / 1000 });
    if (fields.invoiceNumber) {
      const fp = invoiceFingerprint(s.carrier, fields);
      this.state.seenInvoices[fp] ??= s.id;
    }
    const r = { fields, findings, verdict, at: Date.now() };
    this.state.reconciled[s.id] = r;
    this.save();
    return r;
  }

  private async send(s: Shipment, fn: 'confirmDelivery' | 'openDispute' | 'autoRelease', args: readonly unknown[], caller?: AgentWallet) {
    const w = caller ?? this.walletFor(s.shipper);
    if (!w) throw new Error(`no agent wallet for shipper ${s.shipper}`);
    return w.call(this.escrow, escrowAbi, fn, args);
  }

  /** Gate: the model can ask, but only a 'confirm' verdict from policy lets money move. */
  async toolConfirm(s: Shipment, rationale: string, planner = this.planner) {
    const r = this.state.reconciled[s.id];
    if (!r) return { ok: false, error: 'Run reconcile first.' };
    if (r.verdict.kind !== 'confirm') return { ok: false, error: `Policy verdict is ${r.verdict.kind}; confirm is not allowed. Use request_approval or open_dispute.` };
    const txHash = await this.send(s, 'confirmDelivery', [BigInt(s.id)]);
    this.ledger.append({ shipmentId: s.id, shipper: s.shipper, action: 'confirm', amountUSDC: usd(s.amount), rationale, findings: r.findings, planner, txHash });
    this.state.handled[s.id] = 'confirmed'; this.save();
    return { ok: true, txHash };
  }

  async toolDispute(s: Shipment, reason: string, planner = this.planner) {
    const r = this.state.reconciled[s.id];
    if (!r || r.verdict.kind !== 'dispute') return { ok: false, error: 'Policy does not allow the agent to dispute this shipment on its own. Use request_approval with action=dispute.' };
    const txHash = await this.send(s, 'openDispute', [BigInt(s.id), clampBytes(reason)]);
    this.ledger.append({ shipmentId: s.id, shipper: s.shipper, action: 'dispute', amountUSDC: usd(s.amount), rationale: reason, findings: r.findings, planner, txHash });
    this.state.handled[s.id] = 'disputed'; this.save();
    return { ok: true, txHash };
  }

  toolRequestApproval(s: Shipment, action: 'confirm' | 'dispute', recommendation: string, draftDisputeReason?: string, planner = this.planner) {
    const r = this.state.reconciled[s.id];
    const reasons = r && r.verdict.kind !== 'confirm' ? r.verdict.reasons : ['Agent asked for a second opinion'];
    const a: Approval = {
      id: `apr-${s.id}-${Date.now().toString(36)}`, shipmentId: s.id, action, amountUSDC: usd(s.amount), reasons,
      draftDisputeReason, agentRecommendation: recommendation, status: 'pending', createdAt: Date.now(),
    };
    this.state.approvals.push(a);
    this.ledger.append({ shipmentId: s.id, shipper: s.shipper, action: 'request_approval', amountUSDC: a.amountUSDC, rationale: recommendation, findings: r?.findings, planner });
    this.state.handled[s.id] = 'awaiting_approval'; this.save();
    return { ok: true, approvalId: a.id };
  }

  toolHold(s: Shipment, rationale: string, planner = this.planner) {
    if (this.state.reconciled[s.id]?.verdict.kind === 'hold') { this.state.handled[s.id] = 'waiting_pod'; this.save(); }
    this.ledger.append({ shipmentId: s.id, shipper: s.shipper, action: 'hold', amountUSDC: usd(s.amount), rationale, planner });
    return { ok: true };
  }

  // ---------- human approvals ----------
  async resolveApproval(id: string, decision: 'approve' | 'reject', by: string, note = '') {
    const a = this.state.approvals.find(x => x.id === id);
    if (!a || a.status !== 'pending') throw new Error('approval not pending');
    const s = await readShipment(a.shipmentId, this.escrow);
    if (decision === 'approve') {
      if (s.status !== Status.Delivered) throw new Error(`shipment is ${Status[s.status]}, not Delivered`);
      a.txHash = a.action === 'confirm'
        ? await this.send(s, 'confirmDelivery', [BigInt(s.id)])
        : await this.send(s, 'openDispute', [BigInt(s.id), clampBytes(a.draftDisputeReason ?? a.reasons.join('; '))]);
    }
    a.status = decision === 'approve' ? 'approved' : 'rejected';
    a.resolvedAt = Date.now(); a.resolvedBy = by;
    this.ledger.append({ shipmentId: s.id, shipper: s.shipper, action: decision === 'approve' ? 'approved' : 'rejected', amountUSDC: a.amountUSDC, rationale: `${by}: ${a.action}${note ? ` (${note})` : ''}`, planner: 'human', txHash: a.txHash });
    this.state.handled[s.id] = decision === 'approve' ? a.action + 'ed_by_human' : 'rejected_by_human';
    this.save();
    return a;
  }

  // ---------- the loop ----------
  async tick(log: (m: string) => void = console.log) {
    const now = await chainNow();
    const mine = new Set(this.shipperWallets().map(w => w.address.toLowerCase()));
    const carriers = new Set(this.wallets.filter(w => w.role === 'carrier').map(w => w.address.toLowerCase()));
    const everything = await readAllShipments(this.escrow);
    const all = everything.filter(s => mine.has(s.shipper.toLowerCase()));
    let acted = 0;

    // Receivables side: for carrier wallets we manage, collect payouts the shipper never acted on.
    if (this.state.policy.triggerAutoRelease)
      for (const s of everything.filter(s => carriers.has(s.carrier.toLowerCase()) && isAutoReleaseDue(s, now)
        // Both sides run on this agent in the demo: never race a human who is still deciding.
        && !this.state.approvals.some(a => a.shipmentId === s.id && a.status === 'pending'))) {
        try {
          const txHash = await this.send(s, 'autoRelease', [BigInt(s.id)], this.walletFor(s.carrier));
          this.ledger.append({ shipmentId: s.id, shipper: s.shipper, action: 'auto_release', amountUSDC: usd(s.amount), rationale: 'Shipper did not confirm or dispute within the 48h review window; collecting payout per contract terms', planner: 'rules', txHash });
          this.state.handled[s.id] = 'auto_released'; this.save(); acted++;
        } catch (e: any) { log(`#${s.id}: autoRelease failed ${e?.shortMessage ?? e?.message}`); }
      }

    for (const s of all) {
      try {
        if (s.status !== Status.Delivered) continue;
        const h = this.state.handled[s.id];
        const docs = await this.documents(s.id);
        if (h && !(h === 'waiting_docs' && docs.invoice) && !(h === 'waiting_pod' && docs.pod)) {
          // Still waiting and the carrier's 48h auto-release is close: put it in front of a human.
          if ((h === 'waiting_docs' || h === 'waiting_pod') && now >= s.deliveredAt + REVIEW_DEADLINE_WARNING) {
            this.toolRequestApproval(s, 'dispute', `Auto-release in ${Math.max(0, Math.round((s.deliveredAt + 48 * 3600 - now) / 3600))}h and documents are still incomplete. Recommend disputing unless the carrier sends them.`,
              h === 'waiting_docs' ? 'Carrier invoice not received within 36h of delivery.' : 'Proof of delivery not received within 36h of delivery.', 'rules');
            acted++;
          }
          continue;
        }
        if (!docs.invoice) {
          if (!h) {
            this.toolHold(s, 'Delivered on-chain but no carrier invoice on file; waiting for documents before confirming', 'rules');
            this.state.handled[s.id] = 'waiting_docs'; this.save();
          }
          continue;
        }
        log(`#${s.id}: settling with ${this.planner}`);
        if (this.llm) await this.runLlm(s, docs); else await this.runRules(s, docs);
        acted++;
      } catch (e: any) {
        this.ledger.append({ shipmentId: s.id, shipper: s.shipper, action: 'error', rationale: String(e?.shortMessage ?? e?.message ?? e).slice(0, 300), planner: this.planner });
        log(`#${s.id}: error ${e?.message}`);
      }
    }
    return { scanned: all.length, acted };
  }

  /** Deterministic planner: what runs when no model is configured. */
  async runRules(s: Shipment, docs: { invoice?: string; pod?: string }) {
    const fields = extractFields(docs.invoice ?? '', docs.pod ?? '');
    const r = await this.toolReconcile(s, fields, !!docs.pod);
    const summary = r.findings.filter(f => f.severity !== 'ok').map(f => f.detail).join('; ') || 'all checks passed';
    if (r.verdict.kind === 'confirm') return this.toolConfirm(s, `Three-way match passed (escrow terms, invoice ${fields.invoiceNumber}, POD). ${summary}`, 'rules');
    if (r.verdict.kind === 'dispute') return this.toolDispute(s, disputeReason(fields.invoiceNumber, r.findings), 'rules');
    if (r.verdict.kind === 'hold') return this.toolHold(s, `Invoice ${fields.invoiceNumber ?? ''} matches but proof of delivery is missing; requested POD from carrier before release.`, 'rules');
    const draft = r.findings.some(f => f.severity === 'fail') ? disputeReason(fields.invoiceNumber, r.findings) : undefined;
    return this.toolRequestApproval(s, draft ? 'dispute' : 'confirm', `Documents match but policy needs a human: ${r.verdict.reasons.join('; ')}`, draft, 'rules');
  }

  /** LLM planner: reads raw documents, extracts fields itself, and decides inside the policy gate. */
  async runLlm(s: Shipment, docs: { invoice?: string; pod?: string }) {
    const tools: ToolSpec[] = [
      { name: 'reconcile', description: 'Run the three-way match (escrow terms vs invoice vs POD) and the spending policy on the fields you extracted. Returns findings and a policy verdict.',
        parameters: { type: 'object', properties: {
          invoiceNumber: { type: 'string' }, amountUSDC: { type: 'number' }, payee: { type: 'string', description: '0x wallet the invoice asks to be paid to' },
          poRef: { type: 'string' }, origin: { type: 'string' }, destination: { type: 'string' }, invoiceDate: { type: 'string', description: 'YYYY-MM-DD' },
          podSignedBy: { type: 'string' }, podDate: { type: 'string', description: 'YYYY-MM-DD' } } } },
      { name: 'confirm_delivery', description: 'Release escrow to the carrier. Only works if the last reconcile verdict was confirm.', parameters: { type: 'object', properties: { rationale: { type: 'string' } }, required: ['rationale'] } },
      { name: 'open_dispute', description: 'Freeze escrow and send the dispute to the arbiter. Only works if the verdict was dispute. The reason goes on-chain: be specific and cite evidence, max 256 bytes.', parameters: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] } },
      { name: 'request_approval', description: 'Escalate to the finance team. Use when policy says needs_approval or when the documents are ambiguous.', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['confirm', 'dispute'] }, recommendation: { type: 'string' }, draftDisputeReason: { type: 'string' } }, required: ['action', 'recommendation'] } },
      { name: 'hold', description: 'Take no action for now and record why (e.g. waiting for a corrected invoice).', parameters: { type: 'object', properties: { rationale: { type: 'string' } }, required: ['rationale'] } },
    ];
    const terms = parseTerms(s.metadataURI);
    const rep = await readReputation(s.carrier, this.escrow);
    const messages: ChatMessage[] = [
      { role: 'system', content: [
        'You are the accounts-payable settlement agent for a shipper. Escrowed USDC on Arc pays the carrier when you confirm delivery.',
        'Read the carrier invoice and proof of delivery, extract the fields exactly as written (do not correct the carrier\'s numbers), call reconcile, then take exactly one action.',
        'Policy is enforced by the tools; you cannot override it. If a check fails, explain the evidence plainly. Do not pay on ambiguity; escalate instead.',
        'Your rationale is written to an audit log a controller will read. One or two plain sentences, no filler.',
      ].join(' ') },
      { role: 'user', content: JSON.stringify({
        shipment: { id: s.id, carrier: s.carrier, escrowUSDC: usd(s.amount), terms, pickupDeadline: new Date(s.pickupDeadline * 1000).toISOString(), deliveryDeadline: new Date(s.deliveryDeadline * 1000).toISOString(),
          pickedUpAt: new Date(s.pickedUpAt * 1000).toISOString(), deliveredAt: new Date(s.deliveredAt * 1000).toISOString() },
        carrierReputation: rep, invoice: docs.invoice?.slice(0, 6000), proofOfDelivery: docs.pod?.slice(0, 3000) ?? null,
      }) },
    ];
    for (let step = 0; step < 6; step++) {
      const msg = await chat(this.llm!, messages, tools);
      messages.push(msg);
      if (!msg.tool_calls?.length) break;
      for (const call of msg.tool_calls) {
        const args = JSON.parse(call.function.arguments || '{}');
        let result: unknown;
        switch (call.function.name) {
          case 'reconcile': { const r = await this.toolReconcile(s, args, !!docs.pod); result = { findings: r.findings, verdict: r.verdict }; break; }
          case 'confirm_delivery': result = await this.toolConfirm(s, args.rationale); break;
          case 'open_dispute': result = await this.toolDispute(s, args.reason); break;
          case 'request_approval': result = this.toolRequestApproval(s, args.action, args.recommendation, args.draftDisputeReason); break;
          case 'hold': result = this.toolHold(s, args.rationale); break;
          default: result = { error: 'unknown tool' };
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
        if (['confirm_delivery', 'open_dispute', 'request_approval', 'hold'].includes(call.function.name) && (result as any)?.ok) return;
      }
    }
    // Model never reached a terminal action: escalate rather than guess.
    if (!this.state.handled[s.id]) this.toolRequestApproval(s, 'confirm', 'Model did not reach a decision within 6 steps; escalating.', undefined);
  }
}
