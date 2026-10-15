import { readFile } from 'node:fs/promises';
import type { InvoiceFields, Terms } from './types.js';

export function parseTerms(metadataURI: string): Terms | null {
  const parts = metadataURI.split('|');
  if (parts[0] !== 'hw1' || parts.length < 5) return null;
  const [, poRef, origin, destination, cargo] = parts;
  return { poRef, origin, destination, cargo };
}

export function encodeTerms(t: Terms): string {
  const s = ['hw1', t.poRef, t.origin, t.destination, t.cargo].join('|');
  if (s.length > 256) throw new Error('terms exceed 256 bytes');
  return s;
}

/** Extract plain text from a .pdf or text document. */
export async function documentText(path: string): Promise<string> {
  const buf = await readFile(path);
  if (path.toLowerCase().endsWith('.pdf')) {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  }
  return buf.toString('utf8');
}

const grab = (text: string, re: RegExp) => text.match(re)?.[1]?.trim();

function toIsoDate(raw?: string): string | undefined {
  if (!raw) return undefined;
  let m = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = raw.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/); // DD.MM.YYYY (TR / EU)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return undefined;
}

function toAmount(raw?: string): number | undefined {
  if (!raw) return undefined;
  let s = raw.replace(/[^\d.,]/g, '');
  // "1.250,50" (EU) vs "1,250.50" (US)
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Deterministic first pass over invoice + POD text. The LLM planner sees the raw
 * text too and can override any field; this pass is what runs without a model.
 */
export function extractFields(invoiceText: string, podText = ''): InvoiceFields {
  const t = invoiceText;
  return {
    invoiceNumber: grab(t, /^\s*invoice\s*(?:no|number|#)\.?\s*[:#]\s*([A-Z0-9][A-Z0-9-/]{2,})/im),
    amountUSDC: toAmount(grab(t, /^\s*(?:total\s*due|amount\s*due|total)\s*:\s*(?:USDC|USD|EURC|EUR|TRY|[$€₺])?\s*([\d.,]+)/im)),
    payee: grab(t, /^\s*(?:pay\s*to|payee|remit\s*to)(?:\s*wallet)?\s*:\s*(0x[0-9a-fA-F]{40})/im),
    poRef: grab(t, /^\s*(?:PO|P\.O\.|purchase\s*order|shipment\s*ref(?:erence)?)\s*(?:no|#|number)?\.?\s*[:#]\s*([A-Z0-9][A-Z0-9-]{2,})/im),
    origin: grab(t, /^\s*(?:origin|ship\s*from|pickup)\s*:\s*([^\n]+)/im),
    destination: grab(t, /^\s*(?:destination|ship\s*to|deliver\s*to)\s*:\s*([^\n]+)/im),
    invoiceDate: toIsoDate(grab(t, /^\s*(?:invoice\s*date|date)\s*:\s*([^\n]+)/im)),
    podSignedBy: grab(podText, /^\s*(?:received\s*by|signed\s*by|consignee\s*signature)\s*:\s*([^\n]+)/im),
    podDate: toIsoDate(grab(podText, /^\s*(?:delivery\s*date|delivered\s*on|date)\s*:\s*([^\n]+)/im)),
  };
}
