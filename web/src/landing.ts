import "./style.css";
import { CONFIG, LIVE } from "./config";
import { loadNet } from "./chain";
import { $, drawPlate } from "./ui";

$("band-mode").textContent = LIVE ? "LIVE" : "DEMO";
$("foot-ids").textContent = LIVE
  ? `processor ${CONFIG.processor} · circuit #${CONFIG.circuitId} · campaign #${CONFIG.campaignId}`
  : "Demo mode: the v1 circuit runs locally in your browser on real X Layer wallets.";

// hero: layer accordion
document.querySelectorAll<HTMLButtonElement>(".layers > li > button").forEach(b => b.addEventListener("click", () => {
  const li = b.parentElement!, open = li.classList.contains("open");
  document.querySelectorAll(".layers > li").forEach(x => x.classList.remove("open"));
  if (!open) li.classList.add("open");
}));

drawPlate(Array.from({ length: 64 }, (_, i) => ((i * 37) % 5 === 0 ? 1 : 0)));

// numbers: depth profile of the real netlist (one column per logic level, outputs in lime)
loadNet().then(net => {
  const n = net.a.length, off = 2 + net.nIn, depth = new Uint16Array(n), cols: number[][] = [];
  $("n-gates").textContent = String(n); $("band-gates").textContent = String(n);
  for (let g = 0; g < n; g++) {
    const da = net.a[g] >= off ? depth[net.a[g] - off] : 0, db = net.b[g] >= off ? depth[net.b[g] - off] : 0;
    depth[g] = 1 + Math.max(da, db); (cols[depth[g]] ??= []).push(g);
  }
  $("dither").innerHTML = cols.slice(1).map((c, i) => `<div class="col" title="level ${i + 1}: ${c?.length ?? 0} gates">${(c ?? [])
    .map(g => `<i class="${g >= n - net.nOut ? "out" : "on"}"></i>`).join("")}</div>`).join("");
  $("dither-note").textContent = `${n} gates across ${cols.length - 1} logic levels · outputs in lime`;
}).catch(() => {});
