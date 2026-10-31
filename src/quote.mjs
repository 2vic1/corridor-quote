// The product being sold: a corridor quote.
//
// An agent that moves money between LatAm currencies needs a rate it can act on
// and a receipt it can show afterwards. This module produces both from a
// deterministic table, so the demo works with no network and no API keys — and
// so a judge can re-run it and get the same number.
//
// In production you would swap `REFERENCE` for a live feed (Ripio, Textile,
// Chainlink). The interface is the same; only `source` changes.

import { createHmac, randomBytes } from 'node:crypto';

export const CORRIDORS = {
  ARS: { name: 'Argentine peso', symbol: 'wARS', perUsd: 1180.0, spreadBps: 45 },
  BRL: { name: 'Brazilian real', symbol: 'wBRL', perUsd: 5.42, spreadBps: 30 },
  MXN: { name: 'Mexican peso', symbol: 'wMXN', perUsd: 17.35, spreadBps: 25 },
  COP: { name: 'Colombian peso', symbol: 'wCOP', perUsd: 4120.0, spreadBps: 55 },
  PEN: { name: 'Peruvian sol', symbol: 'wPEN', perUsd: 3.72, spreadBps: 35 },
  CLP: { name: 'Chilean peso', symbol: 'wCLP', perUsd: 942.0, spreadBps: 40 },
  USD: { name: 'US dollar', symbol: 'USA₮', perUsd: 1.0, spreadBps: 0 },
};

const SECRET = process.env.QUOTE_SECRET || 'dev-only-secret-change-me';

/**
 * Price one corridor.
 * @param {string} from  ISO code the caller holds, e.g. 'ARS'
 * @param {string} to    ISO code the caller wants, e.g. 'BRL'
 * @param {number} amount units of `from`
 */
export function quote({ from, to, amount }) {
  const a = CORRIDORS[from];
  const b = CORRIDORS[to];
  if (!a) throw new Error(`unsupported source currency: ${from}`);
  if (!b) throw new Error(`unsupported target currency: ${to}`);
  if (!(amount > 0)) throw new Error('amount must be a positive number');

  // Cross rate via USD. This is exactly the step the corridor is trying to skip.
  const usd = amount / a.perUsd;
  const gross = usd * b.perUsd;

  // One spread, charged once — not once per leg.
  const bps = Math.max(a.spreadBps, b.spreadBps);
  const fee = (gross * bps) / 10_000;
  const net = gross - fee;

  const id = randomBytes(9).toString('hex');
  const issuedAt = new Date().toISOString();
  const body = {
    id,
    from,
    to,
    amountIn: round(amount, 2),
    amountOut: round(net, 2),
    rate: round(net / amount, 8),
    spreadBps: bps,
    legs: a.symbol === 'USA₮' || b.symbol === 'USA₮' ? 1 : 2,
    issuedAt,
    expiresInSeconds: 30,
    source: 'reference-table/v1',
  };

  // A receipt the buyer can verify later without calling us again.
  body.receipt = createHmac('sha256', SECRET).update(JSON.stringify(body)).digest('hex').slice(0, 32);
  return body;
}

function round(n, d) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

export const corridorList = () =>
  Object.entries(CORRIDORS).map(([code, c]) => ({
    code,
    name: c.name,
    token: c.symbol,
    spreadBps: c.spreadBps,
  }));
