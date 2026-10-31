// Swap CELO -> USDT -> USA-T on Celo mainnet so the agent can actually settle
// an x402 payment. Every transaction carries the hackathon attribution tag.
//
//   route: CELO --500--> USDT --100--> USA-T   (Uniswap v3 on Celo)

import { createWalletClient, createPublicClient, http, getAddress, parseEther, formatUnits, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { defineChain } from 'viem';
import { toDataSuffix } from '@celo/attribution-tags';
import fs from 'node:fs';
import path from 'node:path';

const TAG = 'celo_73adba80892e';
const SUFFIX = toDataSuffix(TAG).replace(/^0x/, '');
const tagged = (data) => `${data}${SUFFIX}`;

const celo = defineChain({
  id: 42220, name: 'Celo',
  nativeCurrency: { name: 'CELO', symbol: 'CELO', decimals: 18 },
  rpcUrls: { default: { http: ['https://forno.celo.org'] } },
  blockExplorers: { default: { name: 'Celoscan', url: 'https://celoscan.io' } },
});

const T = {
  CELO: getAddress('0x471EcE3750Da237f93B8E339c536989b8978a438'),
  USAT: getAddress('0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771'),
  USDT: getAddress('0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e'),
};
const ROUTER = getAddress('0x5615CDAb10dc425a742d643d949a7F474C01abc4');
const QUOTER = getAddress('0x82825d0554fA07f7FC52Ab63c961F330fdEFa8E8');

const AMOUNT_IN = parseEther(process.argv[2] || '3');

const erc20Abi = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
];

const quoterAbi = [{
  name: 'quoteExactInput', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'path', type: 'bytes' }, { name: 'amountIn', type: 'uint256' }],
  outputs: [{ type: 'uint256' }, { type: 'uint160[]' }, { type: 'uint32[]' }, { type: 'uint256' }],
}];

const routerAbi = [{
  name: 'exactInput', type: 'function', stateMutability: 'nonpayable',
  inputs: [{
    name: 'params', type: 'tuple',
    components: [
      { name: 'path', type: 'bytes' },
      { name: 'recipient', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMinimum', type: 'uint256' },
    ],
  }],
  outputs: [{ type: 'uint256' }],
}];

const enc = (addr, fee) => addr.toLowerCase().replace(/^0x/, '') + fee.toString(16).padStart(6, '0');
const PATH = `0x${enc(T.CELO, 500)}${enc(T.USDT, 100)}${enc(T.USAT, 100)}`;

const W = JSON.parse(fs.readFileSync(path.join(process.cwd(), '..', '..', '_loops', 'agent-wallet.json'), 'utf8'));
const account = privateKeyToAccount(W.privateKey);

const pub = createPublicClient({ chain: celo, transport: http('https://forno.celo.org') });
const wallet = createWalletClient({ account, chain: celo, transport: http('https://forno.celo.org') });

const main = async () => {
  console.log('wallet:', account.address);
  console.log('swapping', formatUnits(AMOUNT_IN, 18), 'CELO');

  const q = await pub.readContract({ address: QUOTER, abi: quoterAbi, functionName: 'quoteExactInput', args: [PATH, AMOUNT_IN] });
  const expected = q[0];
  const minOut = (expected * 97n) / 100n; // 3% slippage guard
  console.log('quoted out:', formatUnits(expected, 6), 'USA-T  |  minOut:', formatUnits(minOut, 6));

  // 1) approve
  const allow = await pub.readContract({ address: T.CELO, abi: erc20Abi, functionName: 'allowance', args: [account.address, ROUTER] });
  if (allow < AMOUNT_IN) {
    const data = tagged(encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [ROUTER, AMOUNT_IN] }));
    const hash = await wallet.sendTransaction({ to: T.CELO, data });
    console.log('approve tx:', hash);
    const rc = await pub.waitForTransactionReceipt({ hash });
    console.log('approve', rc.status);
    if (rc.status !== 'success') throw new Error('approve failed');
  } else {
    console.log('allowance already sufficient');
  }

  // 2) swap
  const data = tagged(encodeFunctionData({
    abi: routerAbi, functionName: 'exactInput',
    args: [{ path: PATH, recipient: account.address, amountIn: AMOUNT_IN, amountOutMinimum: minOut }],
  }));
  const hash = await wallet.sendTransaction({ to: ROUTER, data });
  console.log('swap tx:', hash);
  const rc = await pub.waitForTransactionReceipt({ hash });
  console.log('swap', rc.status, 'gasUsed', rc.gasUsed?.toString());
  if (rc.status !== 'success') throw new Error('swap reverted');

  const bal = await pub.readContract({ address: T.USAT, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] });
  console.log('USA-T balance now:', formatUnits(bal, 6));
  fs.writeFileSync(path.join(process.cwd(), 'swap-receipt.json'), JSON.stringify({
    tag: TAG, amountInCELO: formatUnits(AMOUNT_IN, 18), usatBalance: formatUnits(bal, 6), swapTx: hash,
  }, null, 2));
};
main().catch(e => { console.error('FAILED:', e.shortMessage || e.message); process.exit(1); });
