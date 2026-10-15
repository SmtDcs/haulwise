import { createWalletClient, encodeFunctionData, http, type Abi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { arcTestnet, cfg } from './config.js';
import { publicClient } from './chain.js';
import type { Address, Hex } from './types.js';

export type Role = 'shipper' | 'carrier' | 'treasury';

/** Anything that can sign and send a contract call on Arc for one account. */
export interface AgentWallet {
  label: string;
  role: Role;
  address: Address;
  provider: 'circle' | 'local';
  call(to: Address, abi: Abi, functionName: string, args: readonly unknown[]): Promise<Hex>;
}

/** Circle developer-controlled wallet: keys live in Circle's MPC, the agent only holds an API key + entity secret. */
export class CircleWallet implements AgentWallet {
  provider = 'circle' as const;
  constructor(public label: string, public role: Role, public address: Address, private walletId: string, private client: any) {}
  async call(to: Address, abi: Abi, functionName: string, args: readonly unknown[]): Promise<Hex> {
    const callData = encodeFunctionData({ abi, functionName, args } as any);
    const res = await this.client.createContractExecutionTransaction({
      walletId: this.walletId,
      contractAddress: to,
      callData,
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
      idempotencyKey: randomUUID(),
    });
    const id = res.data?.id as string;
    for (let i = 0; i < 90; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const tx = (await this.client.getTransaction({ id })).data?.transaction;
      if (tx?.state === 'FAILED' || tx?.state === 'CANCELLED' || tx?.state === 'DENIED')
        throw new Error(`Circle tx ${id} ${tx.state}: ${tx.errorReason ?? ''}`);
      if (tx?.txHash && (tx.state === 'CONFIRMED' || tx.state === 'COMPLETE')) return tx.txHash as Hex;
    }
    throw new Error(`Circle tx ${id} not confirmed in 90s`);
  }
}

/** Local fallback: a private key on disk (chmod 600), used when no Circle API key is configured. */
export class LocalWallet implements AgentWallet {
  provider = 'local' as const;
  address: Address;
  private wc;
  constructor(public label: string, public role: Role, pk: Hex) {
    const account = privateKeyToAccount(pk);
    this.address = account.address;
    this.wc = createWalletClient({ account, chain: arcTestnet, transport: http() });
  }
  async call(to: Address, abi: Abi, functionName: string, args: readonly unknown[]): Promise<Hex> {
    const hash = await this.wc.writeContract({ address: to, abi, functionName, args } as any);
    const rc = await publicClient.waitForTransactionReceipt({ hash });
    if (rc.status !== 'success') throw new Error(`tx ${hash} reverted`);
    return hash;
  }
}

interface WalletRecord { label: string; role: Role; address: Address; privateKey?: Hex; circleWalletId?: string }
export interface WalletsFile { circleWalletSetId?: string; wallets: WalletRecord[] }

export function readWalletsFile(path = cfg.walletsFile): WalletsFile {
  if (!existsSync(path)) return { wallets: [] };
  return JSON.parse(readFileSync(path, 'utf8'));
}

let circleClient: any;
export async function getCircleClient() {
  if (!process.env.CIRCLE_API_KEY || !process.env.CIRCLE_ENTITY_SECRET) return null;
  if (!circleClient) {
    const { initiateDeveloperControlledWalletsClient } = await import('@circle-fin/developer-controlled-wallets');
    circleClient = initiateDeveloperControlledWalletsClient({
      apiKey: process.env.CIRCLE_API_KEY,
      entitySecret: process.env.CIRCLE_ENTITY_SECRET,
    });
  }
  return circleClient;
}

/** Circle wallets when a Circle record + API key exist, local keys otherwise. */
export async function loadWallets(path = cfg.walletsFile): Promise<AgentWallet[]> {
  const file = readWalletsFile(path);
  const circle = await getCircleClient();
  return file.wallets.map(w => {
    if (w.circleWalletId && circle) return new CircleWallet(w.label, w.role, w.address, w.circleWalletId, circle);
    if (w.privateKey) return new LocalWallet(w.label, w.role, w.privateKey);
    throw new Error(`wallet ${w.label} has no usable signer (Circle record without CIRCLE_API_KEY?)`);
  });
}
