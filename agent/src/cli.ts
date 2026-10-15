import { SettlementAgent } from './agent.js';
import { loadWallets } from './wallets.js';

const agent = new SettlementAgent(await loadWallets());
const cmd = process.argv[2];
if (cmd === 'tick') console.log(await agent.tick());
else if (cmd === 'verify') console.log(agent.ledger.verify());
else if (cmd === 'approvals') console.log(agent.state.approvals.filter(a => a.status === 'pending'));
else if (cmd === 'approve' || cmd === 'reject') console.log(await agent.resolveApproval(process.argv[3], cmd, process.argv[4] ?? 'cli'));
else console.log('usage: cli.ts tick|verify|approvals|approve <id>|reject <id>');
