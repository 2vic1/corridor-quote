// A local stand-in for https://api.x402.celo.org.
//
// It implements the three endpoints a seller actually calls — /supported,
// /verify, /settle — with the same shapes as the real facilitator, so the whole
// flow can be demonstrated and tested with no API key, no funds and no network.
//
// It is NOT a payment system. /settle returns a fake hash. Point
// X402_FACILITATOR_BASE at the real URL to move real money.

import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

const PORT = Number(process.env.MOCK_PORT || 4022);

const SUPPORTED = {
  kinds: [
    {
      x402Version: 2,
      scheme: 'exact',
      network: 'eip155:42220',
      asset: '0x0000000000000000000000000000000000000a01',
      symbol: 'USA₮',
      decimals: 6,
      extra: { name: 'USA₮', version: '1' },
    },
    {
      x402Version: 2,
      scheme: 'exact',
      network: 'eip155:42220',
      asset: '0x0000000000000000000000000000000000000a02',
      symbol: 'wARS',
      decimals: 18,
      extra: { name: 'wARS', version: '1' },
    },
  ],
};

function body(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const json = (res, status, obj) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
};

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/supported') {
    return json(res, 200, SUPPORTED);
  }

  if (req.method === 'POST' && req.url === '/verify') {
    const { paymentPayload, paymentRequirements } = await body(req);
    const auth = paymentPayload?.payload?.authorization;
    const sig = paymentPayload?.payload?.signature;
    if (!auth || !sig) return json(res, 200, { isValid: false, invalidReason: 'malformed payload' });
    if (auth.to?.toLowerCase() !== paymentRequirements.payTo?.toLowerCase())
      return json(res, 200, { isValid: false, invalidReason: 'payTo mismatch' });
    if (BigInt(auth.value) < BigInt(paymentRequirements.maxAmountRequired))
      return json(res, 200, { isValid: false, invalidReason: 'amount too low' });
    if (BigInt(auth.validBefore) < BigInt(Math.floor(Date.now() / 1000)))
      return json(res, 200, { isValid: false, invalidReason: 'expired' });
    return json(res, 200, { isValid: true, payer: auth.from });
  }

  if (req.method === 'POST' && req.url === '/settle') {
    const { paymentPayload } = await body(req);
    const auth = paymentPayload?.payload?.authorization;
    return json(res, 200, {
      success: true,
      transaction: `0x${randomBytes(32).toString('hex')}`,
      network: paymentPayload?.network,
      payer: auth?.from,
    });
  }

  return json(res, 404, { error: 'not found', routes: ['GET /supported', 'POST /verify', 'POST /settle'] });
});

server.listen(PORT, () => console.log(`mock facilitator on http://localhost:${PORT}`));
