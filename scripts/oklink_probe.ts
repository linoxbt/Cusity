// One-time check once the OKLink key is set: prints a raw response and the mapped transactions.
//   npx tsx scripts/oklink_probe.ts [address]
import { toTx } from "../data/history_oklink";

const a = process.argv[2] ?? "0xea7ce095ff982b0c4e3af0567595e9ac2fe75e25";
const url = `https://www.oklink.com/api/v5/explorer/address/transaction-list?chainShortName=XLAYER&address=${a}&protocolType=transaction&limit=3&page=1`;
const r = await fetch(url);
const j = await r.json();
console.log("HTTP", r.status, JSON.stringify(j, null, 1).slice(0, 2500));
const rows = j.data?.[0]?.transactionLists ?? j.data?.[0]?.transactionList ?? [];
console.log("\nmapped:", rows.map(toTx));
