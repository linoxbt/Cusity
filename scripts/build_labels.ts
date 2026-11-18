// Plan A labels: published sybil lists (label 1) and Hop's surviving bridge users (label 0), kept only
// if the wallet has ever sent a transaction on X Layer. Resumable: activity checks are cached in
// data/raw/activity.jsonl. Read-only (eth_getTransactionCount), spends nothing.
//
//   npx tsx scripts/build_labels.ts [--lz-target 1200]
//
// Sources (downloaded to data/raw/sources/):
//   Hop airdrop (ISC): eliminatedSybilAttackers.csv -> 1; finalDistribution.csv with hopUserTokens > 0 -> 0
//   LayerZero initialList.txt (published for bounty hunting, no licence stated) -> 1
// Wallets on both a sybil list and the human list are dropped.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { client } from "../data/chain";

const SRC = "data/raw/sources", ACT = "data/raw/activity.jsonl";
const URLS = {
  hopSybil: "https://raw.githubusercontent.com/hop-protocol/hop-airdrop/master/src/data/eliminatedSybilAttackers.csv",
  hopFinal: "https://raw.githubusercontent.com/hop-protocol/hop-airdrop/master/src/data/finalDistribution.csv",
  lz: "https://raw.githubusercontent.com/DanielOneSinger/sybil-report/main/initialList.txt",   // mirror of LayerZero-Labs/sybil-report
};
const argv = process.argv.slice(2);
const LZ_TARGET = Number(argv[argv.indexOf("--lz-target") + 1] || 1200);

async function fetchSrc(name: keyof typeof URLS) {
  const f = `${SRC}/${name}.txt`;
  if (!existsSync(f)) {
    const r = await fetch(URLS[name]); if (!r.ok) throw new Error(`${URLS[name]}: ${r.status}`);
    writeFileSync(f, await r.text());
  }
  return readFileSync(f, "utf8").trim().split("\n");
}
const addr = (s: string) => s.split(",")[0].trim().toLowerCase();
const isAddr = (s: string) => /^0x[0-9a-f]{40}$/.test(s);

async function main() {
  mkdirSync(SRC, { recursive: true });
  const hopSybil = new Set((await fetchSrc("hopSybil")).map(addr).filter(isAddr));
  const hopUsers = new Set((await fetchSrc("hopFinal")).slice(1).map(l => l.split(","))
    .filter(c => c[2] && c[2] !== "0").map(c => c[0].toLowerCase()).filter(isAddr));
  const lzAll = (await fetchSrc("lz")).map(addr).filter(isAddr);
  const lz = new Set(lzAll);
  const conflict = new Set([...hopUsers].filter(a => hopSybil.has(a) || lz.has(a)));
  console.log({ hopSybil: hopSybil.size, hopUsers: hopUsers.size, lz: lz.size, conflictsDropped: conflict.size });

  const seen = new Map<string, number>();
  if (existsSync(ACT)) for (const l of readFileSync(ACT, "utf8").split("\n")) if (l) { const [a, n] = JSON.parse(l); seen.set(a, n); }
  const nonce = async (xs: string[]) => {
    const todo = xs.filter(a => !seen.has(a));
    for (let i = 0; i < todo.length; i += 25) {
      const part = todo.slice(i, i + 25);
      const r = await Promise.all(part.map(a => client.getTransactionCount({ address: a as `0x${string}` }).catch(() => -1)));
      const lines = part.map((a, j) => { if (r[j] >= 0) seen.set(a, r[j]); return r[j] >= 0 ? JSON.stringify([a, r[j]]) : ""; }).filter(Boolean);
      if (lines.length) appendFileSync(ACT, lines.join("\n") + "\n");
      if ((i / 25) % 40 === 0) console.log(`  checked ${Math.min(i + 25, todo.length)}/${todo.length}`);
    }
  };

  const rows: string[] = ["address,label,source,note"];
  const keep = (a: string, label: number, source: string) => { if ((seen.get(a) ?? 0) > 0 && !conflict.has(a)) rows.push(`${a},${label},${source},`); };

  const hs = [...hopSybil], hu = [...hopUsers].filter(a => !conflict.has(a));
  console.log("checking Hop lists on X Layer…"); await nonce(hs); await nonce(hu);
  hs.forEach(a => keep(a, 1, "hop-sybil")); hu.forEach(a => keep(a, 0, "hop-user"));

  // LayerZero: walk a fixed stride through the list until LZ_TARGET active wallets are found
  console.log(`checking LayerZero list until ${LZ_TARGET} active…`);
  const stride = 7, order: string[] = [];
  for (let s = 0; s < stride; s++) for (let i = s; i < lzAll.length; i += stride) order.push(lzAll[i]);
  let found = 0;
  for (let i = 0; i < order.length && found < LZ_TARGET; i += 2000) {
    const chunk = order.slice(i, i + 2000).filter(a => !hopSybil.has(a));
    await nonce(chunk);
    for (const a of chunk) if (found < LZ_TARGET && (seen.get(a) ?? 0) > 0 && !conflict.has(a)) { rows.push(`${a},1,layerzero-sybil,`); found++; }
    console.log(`  LayerZero: ${i + chunk.length} checked, ${found} active`);
  }
  writeFileSync("data/labels.csv", rows.join("\n") + "\n");
  const n1 = rows.filter(r => r.includes(",1,")).length, n0 = rows.length - 1 - n1;
  console.log(`wrote data/labels.csv: ${rows.length - 1} wallets (${n1} bot, ${n0} human)`);
}
main().catch(e => { console.error(e); process.exit(1); });
