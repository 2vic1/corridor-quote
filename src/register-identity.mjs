// Register the agent's ERC-8004 identity on Celo mainnet, with the hackathon
// attribution tag (ERC-8021) appended to every transaction's calldata.
//
//   1. register()            -> mints the agent NFT, returns agentId
//   2. setAgentURI(agentId)  -> points it at the registration-v1 document
//
// The tag must be in the calldata of every transaction or the work is not
// credited, and there is no backfill.

import { createWalletClient, createPublicClient, http, encodeFunctionData, decodeEventLog } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { defineChain } from 'viem';
import { toDataSuffix } from '@celo/attribution-tags';
import fs from 'node:fs';
import path from 'node:path';

const TAG = 'celo_73adba80892e';
const REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const SUFFIX = toDataSuffix(TAG).replace(/^0x/, '');

const celo = defineChain({
  id: 42220,
  name: 'Celo',
  nativeCurrency: { name: 'CELO', symbol: 'CELO', decimals: 18 },
  rpcUrls: { default: { http: ['https://forno.celo.org'] } },
  blockExplorers: { default: { name: 'Celoscan', url: 'https://celoscan.io' } },
});

const ABI = [
  { name: 'register', type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [{ type: 'uint256' }] },
  {
    name: 'register',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'agentURI', type: 'string' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'setAgentURI',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'newURI', type: 'string' },
    ],
    outputs: [],
  },
  {
    name: 'Registered',
    type: 'event',
    inputs: [
      { indexed: true, name: 'agentId', type: 'uint256' },
      { name: 'agentURI', type: 'string' },
      { indexed: true, name: 'owner', type: 'address' },
    ],
  },
  {
    name: 'Transfer',
    type: 'event',
    inputs: [
      { indexed: true, name: 'from', type: 'address' },
      { indexed: true, name: 'to', type: 'address' },
      { indexed: true, name: 'tokenId', type: 'uint256' },
    ],
  },
];

const walletPath = path.resolve('../../_loops/agent-wallet.json');
const { privateKey } = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
const account = privateKeyToAccount(privateKey);

const wallet = createWalletClient({ account, chain: celo, transport: http() });
const pub = createPublicClient({ chain: celo, transport: http() });

const tagged = (data) => `${data}${SUFFIX}`;

const registrationDoc = (agentId) => ({
  type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
  name: 'CorridorQuote',
  description:
    'An agent that sells LatAm FX quotes per call, priced at 0.002 USA₮ and settled over x402 on Celo. ' +
    'It quotes a corridor, returns a verifiable receipt, and gets paid without an account, an invoice or a human in the loop.',
  image:
    'data:image/svg+xml;base64,' +
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#0b1220"/><text x="200" y="180" font-family="monospace" font-size="42" fill="#e8eefc" text-anchor="middle">ARS→BRL</text><text x="200" y="230" font-family="monospace" font-size="20" fill="#7f8ea8" text-anchor="middle">0.002 USA₮ / quote</text></svg>`,
    ).toString('base64'),
  services: [
    { name: 'web', endpoint: 'https://github.com/2vic1/corridor-quote' },
    { name: 'email', endpoint: 'esorvand@gmail.com' },
  ],
  x402Support: true,
  active: true,
  registrations: [
    { agentId, agentRegistry: `eip155:42220:${REGISTRY}` },
  ],
});

(async () => {
  console.log('account', account.address);
  const bal = await pub.getBalance({ address: account.address });
  console.log('balance', Number(bal) / 1e18, 'CELO');

  // ---- 1. register() -------------------------------------------------------
  const data = tagged(encodeFunctionData({ abi: ABI, functionName: 'register' }));
  const hash = await wallet.sendTransaction({ to: REGISTRY, data });
  console.log('register tx', hash);
  const rc = await pub.waitForTransactionReceipt({ hash });
  console.log('status', rc.status, 'gas', rc.gasUsed);

  let agentId = null;
  for (const log of rc.logs) {
    if (log.address.toLowerCase() !== REGISTRY.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics });
      if (ev.eventName === 'Registered') agentId = ev.args.agentId;
      if (ev.eventName === 'Transfer') agentId = ev.args.tokenId;
    } catch {}
  }
  if (agentId === null) throw new Error('could not read agentId from logs');
  console.log('AGENT ID', agentId.toString());

  // ---- 2. setAgentURI ------------------------------------------------------
  const doc = registrationDoc(Number(agentId));
  const uri = 'data:application/json;base64,' + Buffer.from(JSON.stringify(doc)).toString('base64');
  const data2 = tagged(
    encodeFunctionData({ abi: ABI, functionName: 'setAgentURI', args: [agentId, uri] }),
  );
  const hash2 = await wallet.sendTransaction({ to: REGISTRY, data: data2 });
  console.log('setAgentURI tx', hash2);
  const rc2 = await pub.waitForTransactionReceipt({ hash: hash2 });
  console.log('status', rc2.status);

  const out = {
    agentId: agentId.toString(),
    agentRegistry: `eip155:42220:${REGISTRY}`,
    address: account.address,
    registerTx: hash,
    setUriTx: hash2,
    tag: TAG,
    doc,
  };
  fs.writeFileSync('../../_loops/agent-identity.json', JSON.stringify(out, null, 2));
  console.log('saved _loops/agent-identity.json');
})();
