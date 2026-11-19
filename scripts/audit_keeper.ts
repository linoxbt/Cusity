// Audit keeper (audit M-1): seals every round requested for the bound model as soon as its block exists, then
// finalizes it in 4-row batches. With it running, nobody (owner or griefer) can let a round lapse after seeing
// its draw: every requested round gets scored. Sealing costs ~50k gas, each batch ~11M gas (≈ 0.0002 OKB).
//
// It signs automatically, so it needs a DEDICATED hot wallet holding only a little OKB (never the deployer):
//   KEEPER_KEY=0x… AUDIT=0x… CAMPAIGN=0x… CAMPAIGN_ID=0 npx tsx scripts/audit_keeper.ts
import { createPublicClient, createWalletClient, defineChain, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";

const RPC = process.env.XLAYER_RPC ?? "https://rpc.xlayer.tech";
const chain = defineChain({ id: 196, name: "X Layer", nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const AUDIT = process.env.AUDIT as Hex, CAMPAIGN = process.env.CAMPAIGN as Hex, CID = BigInt(process.env.CAMPAIGN_ID ?? "0");
if (!process.env.KEEPER_KEY || !AUDIT || !CAMPAIGN) { console.error("set KEEPER_KEY, AUDIT, CAMPAIGN (and CAMPAIGN_ID)"); process.exit(1); }
const account = privateKeyToAccount(process.env.KEEPER_KEY as Hex);
const pub = createPublicClient({ chain, transport: http(RPC, { retryCount: 3 }) });
const wal = createWalletClient({ chain, account, transport: http(RPC) });
const audit = parseAbi([
  "function roundsOfModel(uint256) view returns (uint256[])", "function status(uint256) view returns (uint8)",
  "function rounds(uint256) view returns (uint256, address, uint64, bytes32, bool, uint16, uint16, uint16)",
  "function sampleIndices(uint256) view returns (uint32[])", "function seal(uint256)",
  "function finalizeAudit(uint256, (uint32 index, address wallet, bytes8 bits, bool label)[], bytes32[][]) returns (uint16, uint16)",
]);
const campaign = parseAbi(["function campaign(uint256 id) view returns ((address owner, bytes32 netlistHash, bytes32 extractorHash, uint64 snapshotBlock, uint64 commitBlock, uint256 testCommitId, bytes32 vectorsRoot, uint32 vectorsCount, uint8 vectorsDepth, string vectorsURI, uint256 modelId, bool bound, bool invalid))"]);
const leaves = JSON.parse(readFileSync(process.env.TEST_LEAVES ?? "data/test_leaves.json", "utf8")).leaves as { wallet: Hex; bits: Hex; label: number; proof: Hex[] }[];
const send = async (fn: "seal" | "finalizeAudit", args: readonly unknown[]) => {
  const h = await wal.writeContract({ chain, account, address: AUDIT, abi: audit, functionName: fn, args: args as never });
  const rc = await pub.waitForTransactionReceipt({ hash: h });
  if (rc.status !== "success") throw new Error(`${fn} reverted: ${h}`);
};

for (;;) {
  try {
    const c = await pub.readContract({ address: CAMPAIGN, abi: campaign, functionName: "campaign", args: [CID] });
    if (c.bound) for (const r of await pub.readContract({ address: AUDIT, abi: audit, functionName: "roundsOfModel", args: [c.modelId] })) {
      if ((await pub.readContract({ address: AUDIT, abi: audit, functionName: "status", args: [r] })) !== 2) continue;   // only Ready rounds
      const [, , , seed, , , , scored] = await pub.readContract({ address: AUDIT, abi: audit, functionName: "rounds", args: [r] });
      if (seed === `0x${"0".repeat(64)}`) { await send("seal", [r]); console.log(`sealed round ${r}`); }
      const idx = await pub.readContract({ address: AUDIT, abi: audit, functionName: "sampleIndices", args: [r] });
      for (let j = scored; j < idx.length; j += 4) {
        const part = idx.slice(j, j + 4);
        await send("finalizeAudit", [r, part.map(i => ({ index: i, wallet: leaves[i].wallet, bits: leaves[i].bits, label: leaves[i].label === 1 })), part.map(i => leaves[i].proof)]);
        console.log(`round ${r}: scored ${Math.min(j + 4, idx.length)}/${idx.length}`);
      }
    }
  } catch (e) { console.error(String((e as Error).message ?? e).slice(0, 200)); }
  await new Promise(r => setTimeout(r, 15_000));   // well inside the 256-block (~4 min) sealing window
}
