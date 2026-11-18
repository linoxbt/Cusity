import { client } from "../data/chain";
import { parseAbi, formatEther } from "viem";
const F = "0x1f09daefa827f02cbb40967cc91b259763760761";
const fab = parseAbi(["function cpuCount() view returns (uint256)", "function cpuAt(uint256) view returns (address)"]);
const pab = parseAbi(["function transistorsContract() view returns (address)", "function TAPEOUT_FEE() view returns (uint256)"]);
const tab = parseAbi(["function mintPrice() view returns (uint256)", "function protocolFee() view returns (uint256)", "function minted() view returns (uint256)", "function supplyCap() view returns (uint256)"]);
const GATES = 807n;
const n = Number(await client.readContract({ address: F, abi: fab, functionName: "cpuCount" }));
const rows: any[] = [];
for (let i = 0; i < n; i += 20) {
  const part = await Promise.all(Array.from({ length: Math.min(20, n - i) }, async (_, k) => {
    try {
      const cpu = await client.readContract({ address: F, abi: fab, functionName: "cpuAt", args: [BigInt(i + k)] });
      const t = await client.readContract({ address: cpu, abi: pab, functionName: "transistorsContract" });
      const [price, pfee, minted, cap, tfee] = await Promise.all([
        client.readContract({ address: t, abi: tab, functionName: "mintPrice" }), client.readContract({ address: t, abi: tab, functionName: "protocolFee" }),
        client.readContract({ address: t, abi: tab, functionName: "minted" }), client.readContract({ address: t, abi: tab, functionName: "supplyCap" }),
        client.readContract({ address: cpu, abi: pab, functionName: "TAPEOUT_FEE" })]);
      return { i: i + k, cpu, price, pfee, left: cap - minted, total: GATES * (price + pfee) + tfee };
    } catch { return undefined; }
  }));
  rows.push(...part.filter(Boolean));
}
const ok = rows.filter(r => r.left >= GATES).sort((a, b) => (a.total < b.total ? -1 : 1));
console.log(`scanned ${rows.length}/${n} processors; ${ok.length} have >= 807 transistors left`);
for (const r of ok.slice(0, 12)) console.log(`#${r.i} ${r.cpu}  price ${formatEther(r.price)}  fee ${formatEther(r.pfee)}  left ${r.left}  total for 807 gates: ${formatEther(r.total)} OKB`);
