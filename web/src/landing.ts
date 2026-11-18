import "./style.css";
import { CONFIG, LIVE } from "./config";
import { loadNet } from "./chain";
import { $, drawPlate, esc } from "./ui";
import { explodeStack, startMotion } from "./motion";
import sample from "./sample.json";   // 24 test-split wallets with verdicts from the v1 netlist

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

const unpack = (h: string) => Array.from({ length: 64 }, (_, i) => (parseInt(h.slice(2 + 2 * (i >> 3), 4 + 2 * (i >> 3)), 16) >> (i & 7)) & 1);
drawPlate(unpack(sample[0].bits));

// ticker: real wallets, real verdicts (duplicated once so the loop is seamless)
const item = (s: (typeof sample)[number]) =>
  `<span class="tk"><span class="dot ${s.v ? "flag" : ""}"></span>${esc(s.w)}<b>${s.v ? "FLAGGED" : "PASSED"}</b><em>${s.m > 0 ? "+" : ""}${s.m}</em><i>${s.bits}</i></span>`;
$("ticker").innerHTML = sample.map(item).join("") + sample.map(item).join("");

// pipeline visuals
const vb = $("viz-bits"); let vi = 0;
const paintBits = () => { const b = unpack(sample[vi++ % sample.length].bits); vb.innerHTML = b.map(x => `<i class="${x ? "on" : ""}"></i>`).join(""); drawPlate(b); };
paintBits(); setInterval(paintBits, 2200);

// numbers + pipeline: the real netlist
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
  $("viz-gates").innerHTML = Array.from({ length: 96 }, (_, i) => `<i style="--d:${(i * 37) % 23}"></i>`).join("");
}).catch(() => {});

startMotion();
explodeStack();
