// One-time check once OKX_API_KEY / OKX_SECRET_KEY / OKX_PASSPHRASE are set: prints a raw response
// and the mapped transactions.   npx tsx --env-file=.env scripts/okx_probe.ts [address]
import { signHeaders, toTx } from "../data/history_okx";

const a = process.argv[2] ?? "0xea7ce095ff982b0c4e3af0567595e9ac2fe75e25";
const pq = `/api/v5/xlayer/address/normal-transaction-list?chainShortName=XLAYER&address=${a}&limit=3&page=1`;
const r = await fetch("https://web3.okx.com" + pq, { headers: signHeaders(pq) });
const j = await r.json();
console.log("HTTP", r.status, JSON.stringify(j, null, 1).slice(0, 2500));
const rows = j.data?.[0]?.transactionList ?? j.data?.[0]?.transactionLists ?? [];
console.log("\nmapped:", rows.map(toTx));
