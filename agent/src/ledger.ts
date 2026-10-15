import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface Decision {
  seq: number;
  ts: number;
  shipmentId?: number;
  shipper?: string;
  action: 'confirm' | 'dispute' | 'auto_release' | 'request_approval' | 'approved' | 'rejected' | 'hold' | 'observe' | 'error';
  amountUSDC?: number;
  rationale: string;
  findings?: { check: string; severity: string; detail: string }[];
  planner: string;
  txHash?: string;
  prevHash: string;
  hash: string;
}

/**
 * Append-only decision log. Each line commits to the previous one (sha256), so a
 * reviewer can detect an edited or deleted entry by replaying the chain.
 */
export class Ledger {
  private entries: Decision[] = [];
  constructor(private file: string) {
    mkdirSync(dirname(file), { recursive: true });
    if (existsSync(file))
      this.entries = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  }
  all() { return this.entries; }
  append(d: Omit<Decision, 'seq' | 'ts' | 'prevHash' | 'hash'> & { ts?: number }): Decision {
    const prevHash = this.entries.at(-1)?.hash ?? '0'.repeat(64);
    const body = { ...d, seq: this.entries.length + 1, ts: d.ts ?? Date.now(), prevHash };
    const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const entry = { ...body, hash } as Decision;
    appendFileSync(this.file, JSON.stringify(entry) + '\n');
    this.entries.push(entry);
    return entry;
  }
  verify(): { ok: boolean; brokenAt?: number } {
    let prev = '0'.repeat(64);
    for (const e of this.entries) {
      const { hash, ...body } = e;
      if (body.prevHash !== prev || createHash('sha256').update(JSON.stringify(body)).digest('hex') !== hash)
        return { ok: false, brokenAt: e.seq };
      prev = hash;
    }
    return { ok: true };
  }
}
