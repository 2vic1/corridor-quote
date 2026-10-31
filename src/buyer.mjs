// The buyer. An agent with a wallet, no human in the loop.
//
// It asks for a quote, is told the price, signs an EIP-3009 authorization for
// exactly that amount, retries, and keeps the receipt. It never approves a
// contract and never pays gas — the facilitator sponsors both.
//
//   PRIVATE_KEY=0x... node src/buyer.mjs ARS BRL 250000
//
// Run it against a mock facilitator first:  npm run demo

import { createWalletClient, http, defineChain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { b64encode, b64decode } from './x402.mjs';

const RPC = {
  'eip155:42220': process.env.CELO_RPC || 'https://forno.celo.org',
  'eip155:11142220': process.env.CELO_SEPOLIA_RPC || 'https://forno.celo-sepolia.celo.org',
};

const TARGET = process.env.TARGET || 'http://localhost:4021/api/quote';
const PRIVATE_KEY = process.env.PRIVATE_KEY;

const [from = 'ARS', to = 'BRL', amountArg = '250000'] = process.argv.slice(2);

if (!PRIVATE_KEY) {
  console.error('PRIVATE_KEY is not set. Use a throwaway key with a few cents on it.');
  process.exit(1);
}

const account = privateKeyToAccount(PRIVATE_KEY);

/** One purchase: ask, pay, retry, verify. */
export async function buy(url) {
  // ---- ask ---------------------------------------------------------------
  const first = await fetch(url);
  if (first.status !== 402) {
    return { ok: first.ok, status: first.status, body: await first.json(), paid: false };
  }

  const challenge = await first.json();
  const accepts = challenge.accepts || [];
  if (!accepts.length) throw new Error('402 with no accepts[] — the seller is misconfigured');

  // A real agent shops: cheapest acceptable route wins.
  const terms = accepts
    .filter((a) => a.scheme === 'exact')
    .sort((a, b) => Number(a.maxAmountRequired) - Number(b.maxAmountRequired))[0];
  if (!terms) throw new Error('no exact-scheme route offered');

  console.log(`  price: ${terms.maxAmountRequired} of ${terms.asset} on ${terms.network}`);

  // ---- sign --------------------------------------------------------------
  const chainId = Number(terms.network.split(':')[1]);
  const chain = defineChain({
    id: chainId,
    name: `chain-${chainId}`,
    nativeCurrency: { name: 'CELO', symbol: 'CELO', decimals: 18 },
    rpcUrls: { default: { http: [RPC[terms.network] || 'https://forno.celo.org'] } },
  });

  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: account.address,
    to: terms.payTo,
    value: String(terms.maxAmountRequired),
    validAfter: String(now - 60),
    validBefore: String(now + (terms.maxTimeoutSeconds || 60)),
    nonce: `0x${randomBytes(32).toString('hex')}`,
  };

  const signature = await createWalletClient({ account, chain, transport: http() }).signTypedData({
    account,
    domain: {
      name: terms.extra?.name || 'USA₮',
      version: terms.extra?.version || '1',
      chainId,
      verifyingContract: terms.asset,
    },
    types: {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
      ],
    },
    primaryType: 'TransferWithAuthorization',
    message: authorization,
  });

  const paymentPayload = {
    x402Version: 2,
    scheme: 'exact',
    network: terms.network,
    payload: { signature, authorization },
  };

  // ---- retry -------------------------------------------------------------
  const second = await fetch(url, { headers: { 'X-PAYMENT': b64encode(paymentPayload) } });
  const body = await second.json();
  const receiptHeader = second.headers.get('x-payment-response');
  const receipt = receiptHeader ? b64decode(receiptHeader) : null;

  return { ok: second.ok, status: second.status, body, paid: true, receipt, terms };
}

// ---- CLI -------------------------------------------------------------------
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = `${TARGET}?from=${from}&to=${to}&amount=${amountArg}`;
  console.log(`buyer ${account.address}`);
  console.log(`GET ${url}`);
  const r = await buy(url);
  if (!r.paid) {
    console.log('no payment was needed:', r.status);
  } else {
    console.log('receipt:', JSON.stringify(r.receipt, null, 2));
  }
  console.log(JSON.stringify(r.body, null, 2));
  if (!r.ok) process.exit(1);
}
