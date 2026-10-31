// Mint an x402 facilitator API key without the dashboard: nonce -> sign -> create.
import { privateKeyToAccount } from 'viem/accounts';
import fs from 'node:fs';

const API = 'https://api.x402.celo.org';
const DOMAIN = 'x402.celo.org';
const account = privateKeyToAccount(process.env.PRIVATE_KEY);

const { nonce } = await (await fetch(`${API}/api/keys/nonce`)).json();

const message = `${DOMAIN} wants you to create an x402 API key.

Address: ${account.address}
Nonce: ${nonce}

Signing this message proves you control this wallet. It costs no gas and sends no transaction.`;

const signature = await account.signMessage({ message });
const r = await fetch(`${API}/api/keys`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ address: account.address, nonce, signature }),
});
const text = await r.text();
console.log('status', r.status, text.slice(0, 500));
if (r.ok) { fs.writeFileSync('x402-key.json', text); console.log('key saved'); }
