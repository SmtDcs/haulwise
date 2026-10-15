import type { Finding, Policy, Reputation, Shipment, Verdict } from './types.js';

export interface PolicyContext {
  shipment: Shipment;
  findings: Finding[];
  reputation: Reputation;
  /** USDC the agent already confirmed on its own in the last 24h */
  confirmedLast24h: number;
  now: number;
}

/**
 * The hard boundary. The planner (LLM or rules) proposes; this function decides
 * what the agent is allowed to do without a human. It never reads model output.
 */
export function evaluate(p: Policy, c: PolicyContext): Verdict {
  const s = c.shipment;
  const amount = Number(s.amount) / 1e6;
  const fails = c.findings.filter(f => f.severity === 'fail').map(f => `${f.check}: ${f.detail}`);
  const warns = c.findings.filter(f => f.severity === 'warn').map(f => `${f.check}: ${f.detail}`);

  if (p.blockedCarriers.map(a => a.toLowerCase()).includes(s.carrier.toLowerCase()))
    return { kind: 'needs_approval', reasons: ['Carrier is on the blocked list'] };

  // Missing POD alone is a paperwork gap, not a dispute: wait for it.
  if (fails.length && c.findings.filter(f => f.severity === 'fail').every(f => f.check === 'pod'))
    return { kind: 'hold', reasons: fails };
  if (fails.length) return p.autoDispute ? { kind: 'dispute', reasons: fails } : { kind: 'needs_approval', reasons: fails };

  const reasons: string[] = [];
  if (amount > p.autoConfirmMaxUSDC) reasons.push(`Amount ${amount} USDC is above the ${p.autoConfirmMaxUSDC} USDC auto-confirm limit`);
  if (c.confirmedLast24h + amount > p.dailyAutoConfirmCapUSDC)
    reasons.push(`Would take 24h auto-confirmed volume to ${c.confirmedLast24h + amount} USDC (cap ${p.dailyAutoConfirmCapUSDC})`);
  if (c.reputation.completed < p.newCarrierMinCompleted && amount > p.newCarrierMaxUSDC)
    reasons.push(`Carrier has ${c.reputation.completed} completed jobs; new-carrier limit is ${p.newCarrierMaxUSDC} USDC`);
  if (s.deliveredAt > s.deliveryDeadline && (s.deliveredAt - s.deliveryDeadline) / 3600 > p.maxLateHours)
    reasons.push(`Delivered more than ${p.maxLateHours}h late; late-delivery penalty is a commercial call`);
  if (warns.length >= 2) reasons.push(`Unresolved document warnings: ${warns.join('; ')}`);

  return reasons.length ? { kind: 'needs_approval', reasons } : { kind: 'confirm' };
}

export const AUTO_RELEASE_DELAY = 48 * 3600;
export const isAutoReleaseDue = (s: Shipment, now: number) => s.status === 2 && s.deliveredAt > 0 && now >= s.deliveredAt + AUTO_RELEASE_DELAY;
export const REVIEW_DEADLINE_WARNING = 36 * 3600;
