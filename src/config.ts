/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { arc, arcTestnet } from 'viem/chains'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'

export const selectedChainName = (import.meta.env.VITE_CHAIN === 'arc' ? 'arc' : 'arcTestnet') as 'arc' | 'arcTestnet'
export const selectedChain = selectedChainName === 'arc' ? arc : arcTestnet
export const CHAIN_ID = selectedChain.id
export const USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as `0x${string}`

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(arc.id, arc.rpcUrls.default.http[0])
registerChain(arcTestnet.id, arcTestnet.rpcUrls.default.http[0])

export const config = createConfig({
  chains: [selectedChain, mainnet], // mainnet needed for ENS resolution
  connectors: [injected()],
  transports: {
    [arc.id]: http(),
    [arcTestnet.id]: http(),
    [mainnet.id]: http(), // ENS resolution uses mainnet
  },
})
