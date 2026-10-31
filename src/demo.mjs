// One command, the whole loop:  npm run demo
//
// Starts a mock facilitator, starts the seller against it, and lets a buyer
// agent purchase a quote with a throwaway wallet. No keys, no funds, no network.
// This is what you record for the submission video.

import { spawn } from 'node:child_process';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { randomBytes } from 'node:crypto';

const MOCK = 'http://localhost:4022';
const SELLER = 'http://localhost:4021';

const children = [];
const run = (args, env) => {
  const p = spawn(process.execPath, args, { env: { ...process.env, ...env }, stdio: 'inherit' });
  children.push(p);
  return p;
};

const wait = async (url, tries = 60) => {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${url} never came up`);
};

const shutdown = () => {
  for (const c of children) c.kill();
};
process.on('exit', shutdown);
process.on('SIGINT', () => process.exit(0));

console.log('1/3  mock facilitator');
run(['src/mock-facilitator.mjs']);
await wait(`${MOCK}/supported`);

console.log('2/3  seller (price 0.002 USA₮ per quote)');
const sellerWallet = privateKeyToAccount(generatePrivateKey()).address;
run(['src/server.mjs'], {
  PORT: '4021',
  X402_FACILITATOR_BASE: MOCK,
  PAY_TO: sellerWallet,
  PUBLIC_URL: SELLER,
  PRICE: '2000',
  ASSET_SYMBOL: 'USA₮',
});
await wait(`${SELLER}/health`);

console.log('3/3  buyer agent');
const buyerKey = generatePrivateKey();
const buyer = run(['src/buyer.mjs', 'ARS', 'BRL', '250000'], {
  PRIVATE_KEY: buyerKey,
  TARGET: `${SELLER}/api/quote`,
});

buyer.on('exit', async (code) => {
  console.log('\n--- second purchase, same agent ---');
  const again = run(['src/buyer.mjs', 'COP', 'USD', '1000000'], {
    PRIVATE_KEY: buyerKey,
    TARGET: `${SELLER}/api/quote`,
  });
  again.on('exit', (c2) => {
    console.log(`\ndemo finished (buyer exit ${code}/${c2})`);
    shutdown();
    process.exit(0);
  });
});
