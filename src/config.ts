import { http, createConfig } from 'wagmi'
import { defineChain } from 'viem'
import { injected } from 'wagmi/connectors'
import { ARC_MAINNET, ARC_TESTNET, type ArcNetwork } from './onchain-facts'

// Mainnet by default. Set VITE_CHAIN=arcTestnet to run against Arc Testnet.
export const NETWORK: ArcNetwork = import.meta.env.VITE_CHAIN === 'arcTestnet' ? ARC_TESTNET : ARC_MAINNET

export const selectedChain = defineChain({
  id: NETWORK.chainId,
  name: NETWORK.name,
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [NETWORK.rpcUrl] } },
  blockExplorers: { default: { name: 'Arc Explorer', url: NETWORK.explorerBase } },
  testnet: NETWORK.key === 'arcTestnet',
})

export const CHAIN_ID = NETWORK.chainId
export const USDC_ADDRESS = NETWORK.usdc

export const config = createConfig({
  chains: [selectedChain],
  connectors: [injected()],
  transports: { [selectedChain.id]: http(NETWORK.rpcUrl) },
})
