// Arc network constants. Arc uses USDC as its gas token (18 decimals at the
// native layer) and also exposes it as an ERC-20 at 0x3600…0000 with 6 decimals.
// All amounts in this app go through the ERC-20 interface, so 6 decimals.

export const USDC_DECIMALS = 6;

export interface ArcNetwork {
  key: 'arc' | 'arcTestnet';
  chainId: number;
  name: string;
  rpcUrl: string;
  explorerBase: string;
  usdc: `0x${string}`;
  /** Haulwise escrow (contract name: CargoBill). Empty if not deployed. */
  escrow: `0x${string}` | '';
}

export const ARC_MAINNET: ArcNetwork = {
  key: 'arc',
  chainId: 5042,
  name: 'Arc',
  rpcUrl: 'https://rpc.mainnet.arc.io',
  explorerBase: 'https://explorer.arc.io',
  usdc: '0x3600000000000000000000000000000000000000',
  escrow: '0xc63caf75a63b53Cf0d30f599766824223ecb653E',
};

export const ARC_TESTNET: ArcNetwork = {
  key: 'arcTestnet',
  chainId: 5042002,
  name: 'Arc Testnet',
  rpcUrl: 'https://rpc.testnet.arc.io',
  explorerBase: 'https://explorer.testnet.arc.io',
  usdc: '0x3600000000000000000000000000000000000000',
  escrow: '0x016e722f13bde933a31e2ee281e76a8419a14567',
};

const NETWORKS = [ARC_MAINNET, ARC_TESTNET];

export function getNetwork(chainId: number): ArcNetwork | undefined {
  return NETWORKS.find(n => n.chainId === chainId);
}

export function buildTxExplorerUrl(chainId: number, txHash: string): string {
  const n = getNetwork(chainId);
  if (!n) throw new Error(`Unknown chain ${chainId}`);
  return `${n.explorerBase}/tx/${txHash}`;
}

export function buildAddressExplorerUrl(chainId: number, address: string): string {
  const n = getNetwork(chainId);
  if (!n) throw new Error(`Unknown chain ${chainId}`);
  return `${n.explorerBase}/address/${address}`;
}
