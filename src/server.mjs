// The seller. A plain node:http server with one paywalled route.
//
// No framework, no build step, one dependency for the buyer only — a judge can
// `node src/server.mjs` and read every line that touches money.

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  paymentRequirements,
  paymentRequiredBody,
  b64decode,
  paymentResponseHeader,
  verify,
  settle,
  supportedAssets,
  findAsset,
} from './x402.mjs';
import { quote, corridorList } from './quote.mjs';

const PORT = Number(process.env.PORT || 4021);
const NETWORK = process.env.X402_NETWORK || 'eip155:42220';
const PAY_TO = process.env.PAY_TO;
const API_KEY = process.env.X402_API_KEY;
const PRICE = process.env.PRICE || '2000'; // 0.002 USA₮ at 6 decimals
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
const ASSET_SYMBOL = process.env.ASSET_SYMBOL || 'USA₮';

if (!PAY_TO) {
  console.error('PAY_TO is not set. Copy .env.example to .env and set your address.');
  process.exit(1);
}

// Discover the token once at boot. The facilitator is the source of truth for
// address, decimals and signing domain — hardcoding them is how sellers get
// their settlements rejected after a token upgrade.
let ASSET = null;
async function loadAsset() {
  if (process.env.ASSET_ADDRESS) {
    ASSET = {
      address: process.env.ASSET_ADDRESS,
      decimals: Number(process.env.ASSET_DECIMALS || 6),
      name: process.env.ASSET_NAME || 'USA₮',
      version: process.env.ASSET_VERSION || '1',
    };
    console.log(`asset: ${ASSET.address} (from env, ${ASSET.decimals} dp)`);
    return;
  }
  try {
    const supported = await supportedAssets(NETWORK, API_KEY);
    ASSET = findAsset(supported, NETWORK, ASSET_SYMBOL);
    if (!ASSET?.address) throw new Error(`${ASSET_SYMBOL} not listed by facilitator`);
    console.log(`asset: ${ASSET.address} (from /supported, ${ASSET.decimals} dp)`);
  } catch (err) {
    console.error('could not discover asset:', err.message);
    console.error('set ASSET_ADDRESS in .env to continue offline.');
    process.exit(1);
  }
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, PUBLIC_URL);

  if (url.pathname === '/health') {
    return send(res, 200, { ok: true, network: NETWORK, asset: ASSET?.address, price: PRICE });
  }

  if (url.pathname === '/corridors') {
    return send(res, 200, { corridors: corridorList() });
  }

  if (url.pathname !== '/api/quote') {
    return send(res, 404, { error: 'not found', routes: ['/api/quote', '/corridors', '/health'] });
  }

  const from = (url.searchParams.get('from') || '').toUpperCase();
  const to = (url.searchParams.get('to') || '').toUpperCase();
  const amount = Number(url.searchParams.get('amount') || 0);
  const resource = `${PUBLIC_URL}/api/quote?from=${from}&to=${to}&amount=${amount}`;

  const requirements = paymentRequirements({
    network: NETWORK,
    asset: ASSET.address,
    payTo: PAY_TO,
    amount: PRICE,
    resource,
    description: `FX quote ${from}->${to} for ${amount}`,
    extra: { name: ASSET.name, version: ASSET.version },
  });

  // ---- hop 1: no payment yet -------------------------------------------------
  const header = req.headers['x-payment'];
  if (!header) {
    console.log(`402  ${from}->${to} ${amount}`);
    return send(res, 402, paymentRequiredBody([requirements]));
  }

  // ---- hop 2: the buyer signed something. Check it, then move money. ---------
  let paymentPayload;
  try {
    paymentPayload = b64decode(header);
  } catch {
    return send(res, 402, paymentRequiredBody([requirements], 'X-PAYMENT is not valid base64 JSON'));
  }

  const check = await verify({ network: NETWORK, paymentPayload, requirements, apiKey: API_KEY });
  if (!check.isValid) {
    console.log(`402  invalid payment: ${check.invalidReason}`);
    return send(res, 402, paymentRequiredBody([requirements], check.invalidReason || 'invalid payment'));
  }

  const settlement = await settle({
    network: NETWORK,
    paymentPayload,
    requirements,
    apiKey: API_KEY,
    idempotencyKey: randomUUID(),
  });
  if (!settlement.success) {
    console.log(`402  settlement failed: ${settlement.errorReason}`);
    return send(res, 402, paymentRequiredBody([requirements], settlement.errorReason || 'settlement failed'));
  }

  // ---- hop 3: paid. Serve the thing that was bought. -------------------------
  let body;
  try {
    body = quote({ from, to, amount });
  } catch (err) {
    // Paid but unpriceable: refund path. The facilitator refunds failed
    // settlements, and this is the case worth logging loudly.
    return send(res, 400, { error: err.message, settled: settlement.transaction });
  }

  body.paidWith = {
    asset: ASSET_SYMBOL,
    amount: PRICE,
    decimals: ASSET.decimals,
    network: NETWORK,
    transaction: settlement.transaction,
    payer: settlement.payer,
  };

  console.log(`200  ${from}->${to} ${amount}  tx=${settlement.transaction}`);
  return send(res, 200, body, {
    'X-PAYMENT-RESPONSE': paymentResponseHeader({
      success: true,
      transaction: settlement.transaction,
      network: NETWORK,
      payer: settlement.payer,
    }),
  });
});

await loadAsset();
server.listen(PORT, () => {
  console.log(`corridor-quote listening on ${PUBLIC_URL}`);
  console.log(`network ${NETWORK} · price ${PRICE} (${ASSET_SYMBOL}) · payTo ${PAY_TO}`);
});
