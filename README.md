# CorridorQuote

**An agent that sells FX quotes for LatAm corridors and gets paid 0.002 USA₮ per call, over x402 on Celo. No accounts, no API keys for the buyer, no human in the loop.**

Track: **USA₮ with x402** — *Agents on Open Rails Hackathon* (Celo Core Co.)
Deadline: **Mon 9 Nov 2026, 09:00 GMT**

---

## The problem

A business in Buenos Aires holding pesos that needs reais does two trades, pays two spreads, and lets a counter set the rate. A *casa de cambio* takes 5–10% for the same trip. The cost is not the currency — it is the number of hops and the fact that somebody has to quote you a price by hand.

An agent cannot fix that if getting a price requires an account, a KYC, a monthly plan and an invoice. A price is worth a fraction of a cent. It should cost a fraction of a cent.

## What this is

A pay-per-call endpoint:

```
GET /api/quote?from=ARS&to=BRL&amount=250000
```

* No payment → **HTTP 402** with the exact price and asset.
* Buyer signs an EIP-3009 authorization for exactly that amount → retries.
* The facilitator verifies, sponsors the gas, and settles USA₮ straight from the buyer to the merchant.
* The buyer gets the quote **and a receipt it can verify later** without calling us again.

The buyer never approves a contract, never holds CELO, never pays gas, never signs up.

```
$ npm run demo

402  ARS->BRL 250000
  price: 2000 of USA₮ on eip155:42220
200  ARS->BRL 250000  tx=0xc5289705…9f4b
{ "amountOut": 1143.14, "spreadBps": 45, "legs": 2, "receipt": "b95d1c0d…" }
```

## Why this is a product and not a demo

| | |
|---|---|
| **Real unit of value** | One quote, priced at $0.002. Cheap enough that an agent can buy a thousand and still save money against a 5% counter spread. |
| **Real buyer** | The buyer in `src/buyer.mjs` is autonomous: it reads `accepts[]`, picks the cheapest route, signs, retries, keeps the receipt. No human step. |
| **Verifiable afterwards** | Every quote carries an HMAC receipt and the settlement transaction hash. An auditor can check the payment on-chain and the quote offline. |
| **Honest economics** | One spread charged once (`spreadBps`), not once per leg. `legs` is in the response so the saving is checkable. |

## Architecture

```
buyer agent ──GET /api/quote──────────────▶ seller
            ◀──402 + accepts[]─────────────
            ──GET + X-PAYMENT (signed)────▶ seller ──POST /verify──▶ facilitator
                                           seller ◀──isValid───────
                                           seller ──POST /settle──▶ facilitator
            ◀──200 + quote + receipt───────         (gas sponsored, USA₮ moves)
```

Three files, no framework, one dependency (`viem`, for the buyer's signature only):

| file | what it does |
|---|---|
| `src/server.mjs` | the seller — plain `node:http`, one paywalled route |
| `src/x402.mjs` | the wire format: 402 body, `X-PAYMENT`, verify/settle, asset discovery |
| `src/quote.mjs` | the product — deterministic corridor pricing + HMAC receipt |
| `src/buyer.mjs` | the agent — shops, signs, retries, keeps the receipt |
| `src/mock-facilitator.mjs` | local facilitator so the whole loop runs with no keys and no funds |
| `src/demo.mjs` | `npm run demo` — starts all three and buys two quotes |

## Run it

```bash
npm install
npm run demo          # offline: mock facilitator, throwaway wallets, two purchases
```

Against Celo mainnet:

```bash
cp .env.example .env  # set PAY_TO and X402_API_KEY
npm run server
PRIVATE_KEY=0x… npm run buyer -- ARS BRL 250000
```

The seller calls the facilitator's `/supported` at boot and takes the token address, decimals and EIP-712 domain from there. **Nothing about the token is hardcoded** — that is how you avoid a rejected settlement after a token upgrade.

## Going live (the part that needs a human)

1. Get a key at `x402.celo.org` — sign a message with a wallet, no gas. Key is shown once.
2. Fund the facilitator balance with USA₮ (free mainnet grant via the Celo faucet, gated by Self).
3. `PAY_TO` = merchant wallet. Deploy, set `PUBLIC_URL` to the real host.
4. Run the buyer with a throwaway key holding a few cents.

## Status

- [x] 402 → sign → verify → settle → serve, end to end
- [x] asset discovery from `/supported`
- [x] idempotency key on settle, refund path on unpriceable request
- [x] offline demo that a judge can re-run in one command
- [ ] mainnet deployment + on-chain settlement history
- [ ] live rate feed behind `quote.mjs` (same interface, swap `source`)

## Next

The corridor engine is deliberately swappable: `REFERENCE` in `quote.mjs` becomes a Ripio or Textile feed and the endpoint keeps its shape. The same seller can then price a real corridor and be paid for it per call — which is the whole argument: **a price should be a commodity you buy by the unit, not a service you subscribe to.**
