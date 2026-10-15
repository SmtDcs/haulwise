/** Requests Arc testnet USDC for every agent wallet through Circle's faucet API (needs CIRCLE_API_KEY). */
import { getCircleClient, readWalletsFile } from '../src/wallets.js';
const circle = await getCircleClient();
if (!circle) { console.error('CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET are required'); process.exit(1); }
for (const w of readWalletsFile().wallets) {
  try { await circle.requestTestnetTokens({ address: w.address, blockchain: 'ARC-TESTNET', usdc: true }); console.log('dripped', w.address); }
  catch (e: any) { if (e?.response?.status === 403) { console.log('faucet API is mainnet-only for this key; use the Developer Console faucet or faucet.circle.com'); break; } console.log('faucet failed', w.address, e?.response?.data?.message ?? e.message); }
}
