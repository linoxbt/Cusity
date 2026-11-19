import "./style.css";
import { LIVE } from "./config";
import { $, drawPlate, esc, short } from "./ui";
import { explodeStack, startMotion } from "./motion";
import { parse } from "./tap02";
import { FEATURES, FLAGS } from "../../data/features";
import card from "../public/model/model_card.json";
import netlistJson from "../../build/cusity.netlist.json";
import sample from "./sample.json";   // 24 held-out wallets with verdicts from the current netlist
import type { Hex } from "viem";

// ---- every number on the page comes from the model card and the feature layout
const t = card.test, pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const set = (k: string, v: string) => document.querySelectorAll<HTMLElement>(`[data-k="${k}"]`).forEach(e => (e.textContent = v));
const count = (k: string, v: number) => document.querySelectorAll<HTMLElement>(`[data-k="${k}"]`).forEach(e => (e.dataset.to = String(v)));
set("hash", short(card.netlistSha256, 4));
set("gates", String(card.gates));
set("gates-note", `NAND gates in the v${card.version} circuit`);
set("layout", `bits per wallet: ${FEATURES.length} thermometer features + ${FLAGS.length} flags`);
set("parity", "mismatches, trained gate list vs NAND netlist, on every labelled wallet + 20,000 random inputs");
set("summary", `The v${card.version} circuit, tested once on ${t.n} held-out wallets frozen before training: ${pct(t.balanced_accuracy)} balanced accuracy ` +
  `(95% CI ${pct(t.balanced_accuracy_ci95[0], 0)}–${pct(t.balanced_accuracy_ci95[1], 0)}), ${pct(t.human_false_positive_rate)} of humans flagged.`);
set("faq-acc", `On ${t.n} held-out wallets it caught ${pct(t.bot_recall, 0)} of bots and wrongly flagged ${pct(t.human_false_positive_rate, 0)} of humans. ` +
  `That's why a flag comes with its reasons and an appeal, and why accuracy is re-scored on chain.`);
count("gates-count", card.gates);
count("bal", Math.round(t.balanced_accuracy * 1000) / 10);
fetch("./snapshot/index.json").then(r => r.json()).then((i: { count: number; block: number }) => {
  count("labelled", i.count);
  document.querySelectorAll<HTMLElement>('[data-k="labelled"]').forEach(e => (e.textContent = i.count.toLocaleString("en-US")));
  set("block", `block ${i.block.toLocaleString("en-US")}`);
}).catch(() => set("block", ""));

$("band-mode").textContent = LIVE ? "LIVE" : "DEMO";
$("foot-ids").textContent = LIVE ? `${card.name} · netlist ${short(card.netlistSha256, 6)}`
  : "Demo mode: the circuit runs in your browser on real X Layer wallets until the on-chain campaign goes live.";
if (!LIVE) { const n = $("mode-note"); n.hidden = false; n.textContent = "Demo: verdicts are computed in your browser until the on-chain campaign goes live."; }

// ---- hero: layer accordion (one open at a time)
const layerBtns = [...document.querySelectorAll<HTMLButtonElement>(".layers > li > button")];
const syncAcc = () => layerBtns.forEach(b => b.setAttribute("aria-expanded", String(b.parentElement!.classList.contains("open"))));
layerBtns.forEach(b => b.addEventListener("click", () => {
  const li = b.parentElement!, open = li.classList.contains("open");
  document.querySelectorAll(".layers > li").forEach(x => x.classList.remove("open"));
  if (!open) li.classList.add("open");
  syncAcc();
}));
syncAcc();

const unpack = (h: string) => Array.from({ length: 64 }, (_, i) => (parseInt(h.slice(2 + 2 * (i >> 3), 4 + 2 * (i >> 3)), 16) >> (i & 7)) & 1);
drawPlate(unpack(sample[0].bits));

// ---- ticker: real wallets, real verdicts (duplicated once so the loop is seamless), with a pause control
const item = (s: (typeof sample)[number]) =>
  `<span class="tk"><span class="dot ${s.v ? "flag" : ""}"></span>${esc(s.w)}<b>${s.v ? "FLAGGED" : "PASSED"}</b><em>${s.m > 0 ? "+" : ""}${s.m}</em><i>${s.bits}</i></span>`;
$("ticker").innerHTML = sample.map(item).join("") + sample.map(item).join("");
const pause = $<HTMLButtonElement>("tk-pause");
pause.onclick = () => {
  const p = pause.getAttribute("aria-pressed") !== "true";
  pause.setAttribute("aria-pressed", String(p)); pause.textContent = p ? "Play" : "Pause";
  $("ticker").classList.toggle("paused", p);
};

// ---- pipeline visual: repaint only while visible and the tab is shown
const vb = $("viz-bits"); let vi = 0, timer = 0, seen = false;
const paintBits = () => { const b = unpack(sample[vi++ % sample.length].bits); vb.innerHTML = b.map(x => `<i class="${x ? "on" : ""}"></i>`).join(""); drawPlate(b); };
const tick = () => { clearInterval(timer); timer = 0; if (seen && !document.hidden) timer = window.setInterval(paintBits, 2200); };
paintBits();
new IntersectionObserver(es => { seen = es[0].isIntersecting; tick(); }).observe(vb);
document.addEventListener("visibilitychange", tick);

// ---- numbers: the real netlist's depth profile
const net = parse(netlistJson.netlist as Hex, netlistJson.nIn, netlistJson.nOut);
{
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
}

startMotion();
explodeStack();
