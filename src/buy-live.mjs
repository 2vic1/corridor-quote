// One real, paid call against the deployed seller, through the live Celo
// facilitator. The sharecode is required by the hosting proxy on every request.
import { buy } from './buyer.mjs';
import fs from 'node:fs';

const BASE = process.env.BASE || 'https://corridor-quote.apps.workbuddy.host/api/quote?sharecode=QJB5SHSDQ3';
const url = `${BASE}&from=ARS&to=BRL&amount=1000`;

const r = await buy(url);
console.log('status:', r.status, '| paid:', r.paid);
console.log('receipt:', JSON.stringify(r.receipt, null, 2));
console.log('body:', JSON.stringify(r.body, null, 2).slice(0, 1200));
fs.writeFileSync('live-receipt.json', JSON.stringify({ url, status: r.status, receipt: r.receipt, body: r.body }, null, 2));
