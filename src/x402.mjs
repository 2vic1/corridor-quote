// x402 v2 wire helpers for Celo.
// Spec: https://github.com/coinbase/x402  ·  Facilitator: https://x402.celo.org
//
// The flow is three HTTP hops:
//   1. client asks for a resource              -> 402 + `accepts[]`
//   2. client signs an EIP-3009 authorization  -> retries with `X-PAYMENT`
//   3. server asks the facilitator to /verify  -> then /settle  -> serves the body
//
// Nothing here holds funds. The facilitator sponsors gas and moves the token
// straight from the buyer to `payTo`.

export const FACILITATORS = {
  // Celo mainnet
  'eip155:42220': 'https://api.x402.celo.org',
  // Celo Sepolia (testnet)
  'eip155:11142220': 'https://api.x402.sepolia.celo.org',
};

/** Base URL for a network, with an env override so the demo can run offline. */
export function facilitatorBase(network) {
  const override = process.env.X402_FACILITATOR_BASE;
  if (override) return override.replace(/\/+$/, '');
  const base = FACILITATORS[network];
  if (!base) throw new Error(`no facilitator configured for network ${network}`);
  return base;
}

export const b64encode = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
export const b64decode = (str) => JSON.parse(Buffer.from(str, 'base64').toString('utf8'));

/**
 * Build one entry of the `accepts` array. `asset` must be the token contract
 * discovered from the facilitator — never hardcode it.
 */
export function paymentRequirements({
  network,
  asset,
  payTo,
  amount,
  resource,
  description,
  mimeType = 'application/json',
  maxTimeoutSeconds = 60,
  extra = {},
}) {
  return {
    scheme: 'exact',
    network,
    maxAmountRequired: String(amount),
    resource,
    description,
    mimeType,
    payTo,
    maxTimeoutSeconds,
    asset,
    extra,
  };
}

/** The 402 body a seller returns when the resource has not been paid for. */
export function paymentRequiredBody(accepts, error = 'X-PAYMENT header is required') {
  return { x402Version: 2, error, accepts };
}

async function facilitatorPost(network, path, body, apiKey) {
  const base = facilitatorBase(network);
  const res = await fetch(base + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'X-API-Key': apiKey } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`facilitator ${path} returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
  }
  return { status: res.status, json };
}

/**
 * Ask the facilitator whether a signed payload is good, without moving funds.
 * Returns { isValid, invalidReason }.
 */
export async function verify({ network, paymentPayload, requirements, apiKey }) {
  const { status, json } = await facilitatorPost(
    network,
    '/verify',
    { x402Version: 2, paymentPayload, paymentRequirements: requirements },
    apiKey,
  );
  if (status >= 400) return { isValid: false, invalidReason: json.error || `http ${status}` };
  return json;
}

/**
 * Submit the authorization on-chain. Returns { success, transaction, errorReason }.
 * A settlement the facilitator cannot confirm is refunded in full, so this is
 * safe to retry — pass an idempotency key if you do.
 */
export async function settle({ network, paymentPayload, requirements, apiKey, idempotencyKey }) {
  const base = facilitatorBase(network);
  const res = await fetch(base + '/settle', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'X-API-Key': apiKey } : {}),
      ...(idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify({ x402Version: 2, paymentPayload, paymentRequirements: requirements }),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { success: false, errorReason: `non-JSON (${res.status}): ${text.slice(0, 200)}` };
  }
}

/** Header the buyer receives back, so it can prove the payment on its side. */
export function paymentResponseHeader({ success, transaction, network, payer }) {
  return b64encode({ success, transaction, network, payer });
}

/**
 * Ask the facilitator which assets it can settle. This is the only correct way
 * to get a token address: the facilitator asserts every address, decimals and
 * EIP-712 signing domain against the chain in CI.
 */
export async function supportedAssets(network, apiKey) {
  const base = facilitatorBase(network);
  const res = await fetch(base + '/supported', {
    headers: apiKey ? { 'X-API-Key': apiKey } : {},
  });
  if (!res.ok) throw new Error(`/supported failed: ${res.status}`);
  return res.json();
}

/**
 * Pull one asset out of a /supported response. Tolerates both the flat
 * `{ kinds: [...] }` and the nested `{ supported: {...} }` shapes so a
 * facilitator upgrade does not break the seller.
 */
export function findAsset(supported, network, symbol) {
  const kinds =
    supported?.kinds ||
    supported?.supported?.[network] ||
    supported?.supported ||
    [];
  const list = Array.isArray(kinds) ? kinds : Object.values(kinds).flat();
  const match = list.find(
    (k) =>
      String(k.symbol || k.assetSymbol || '').toUpperCase() === symbol.toUpperCase() &&
      (!k.network || k.network === network),
  );
  if (!match) return null;
  return {
    address: match.asset || match.address || match.token,
    decimals: match.decimals ?? 6,
    name: match.extra?.name || match.name || symbol,
    version: match.extra?.version || match.version || '1',
    raw: match,
  };
}
