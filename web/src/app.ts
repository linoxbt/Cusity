// The app: six independent pages (check, explain, audit, appeal, campaign, model) sharing one shell.
// The last checked wallet carries across pages (sessionStorage), and ?w=0x… makes any page shareable.
import "./style.css";
import { CONFIG, LIVE } from "./config";
import { auditInfo, checkWallet, client, loadNet, merkleRoot, runAudit, sampleWallets, shard, snapshotIndex, type CheckResult } from "./chain";
import { encodePacked, keccak256, type Hex } from "viem";
import extCfg from "../../data/extractor.config.json";
import { decidingGates, flips, readings } from "./explain";
import { $, bitsGrid, esc, marginBar, short } from "./ui";
import { startMotion } from "./motion";
import card from "../public/model/model_card.json";
import fstats from "../public/model/feature_stats.json";
import { runStages, layerSizes, GROUP, liveNeurons, decidingNeurons, inputsOf, opsOf, OP_NAMES } from "./stages";
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, type SimulationNodeDatum } from "d3-force";
import { decide } from "./tap02";
import { SLOTS, levelOf, withLevel, describeLevel, unpack, type Slot } from "../../data/features";

type Page = "check" | "explain" | "cluster" | "audit" | "appeal" | "campaign" | "model" | "feature" | "stage" | "step";
type Ok = Extract<CheckResult, { status: "ok" }>;
const PAGES: [Page, string][] = [["check", "Check"], ["explain", "Explain"], ["cluster", "Cluster"], ["audit", "Audit"], ["appeal", "Appeal"], ["campaign", "Campaign"], ["model", "Model"]];
const page = (document.body.dataset.page ?? "check") as Page;
const KEY = "cusity:wallet";

const wallet = () => new URLSearchParams(location.search).get("w") ?? sessionStorage.getItem(KEY) ?? "";
const remember = (w: string) => sessionStorage.setItem(KEY, w);
const link = (p: Page, w = wallet()) => `${p}.html${w ? `?w=${encodeURIComponent(w)}` : ""}`;

// ------------------------------------------------------------------ shell

function shell(title: string) {
  const nav = PAGES.map(([p, label], i) =>
    `<a href="${link(p)}" class="${p === page || ((page === "feature" || page === "stage") && p === "check") || (page === "step" && p === "campaign") ? "on" : ""}"><span>0${i + 1}</span>${label}</a>`).join("");
  document.body.innerHTML = `
    <header class="app-bar">
      <a class="bar-brand" href="index.html" aria-label="Cusity home"><img src="./logo.svg" alt="cusity" height="24" /></a>
      <button class="menu-btn" id="menu" aria-label="Toggle menu" aria-controls="rail" aria-expanded="true"><i></i><i></i><i></i></button>
    </header>
    <aside class="rail" id="rail">
      <nav class="rail-nav">${nav}</nav>
      <a class="rail-home mono" href="index.html">← Home</a>
      <div class="rail-status mono"><span class="lbl">Circuit</span><span class="val">${LIVE ? `#${CONFIG.circuitId} live` : "demo"}</span></div>
    </aside>
    <div class="app-main">
      <section class="sheet app-sheet">
        <h1 class="app-title">${title}</h1>
        <div id="page"></div>
      </section>
    </div>
    <div class="scrim" id="scrim"></div>`;
  // ☰ toggles the sidebar: on desktop it collapses/expands (remembered), on phones it slides over as a drawer
  const phone = () => matchMedia("(max-width: 980px)").matches;
  const KEY_RAIL = "cusity:rail";
  if (localStorage.getItem(KEY_RAIL) === "closed") document.body.classList.add("rail-collapsed");
  const sync = () => $("menu").setAttribute("aria-expanded", String(phone()
    ? document.body.classList.contains("drawer-open") : !document.body.classList.contains("rail-collapsed")));
  const drawer = (v: boolean) => { document.body.classList.toggle("drawer-open", v); sync(); };
  $("menu").onclick = () => {
    if (phone()) return drawer(!document.body.classList.contains("drawer-open"));
    const closed = document.body.classList.toggle("rail-collapsed");
    localStorage.setItem(KEY_RAIL, closed ? "closed" : "open"); sync();
  };
  $("scrim").onclick = () => drawer(false);
  addEventListener("keydown", e => { if (e.key === "Escape") drawer(false); });
  sync();
}

const copyRow = (label: string, v: string) =>
  `<div class="hashrow"><span class="k mono">${label}</span><code class="mono" title="${esc(v)}">${short(v, 10)}</code><button class="ghost" data-copy="${esc(v)}">Copy</button></div>`;
const wireCopy = () => document.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach(b =>
  b.onclick = () => { navigator.clipboard.writeText(b.dataset.copy!); b.textContent = "Copied"; setTimeout(() => (b.textContent = "Copy"), 1200); });

const pill = (r: Ok) => `<span class="pill ${r.verdict ? "flag" : ""}"><span class="dot"></span>${r.verdict ? "Flagged" : "Passed"}</span>`;
const fail = (el: HTMLElement, e: unknown) => { el.innerHTML = `<div class="card warn">${esc(String((e as Error).message ?? e))}</div>`; };

async function lookup(w: string): Promise<CheckResult | undefined> {
  if (!w) return undefined;
  const r = await checkWallet(w);
  if (r.status === "ok") remember(r.wallet);
  return r;
}

function needWallet(el: HTMLElement) {
  el.innerHTML = `<div class="empty"><a class="btn-dark mono" href="check.html">Check a wallet first</a></div>`;
}


// ------------------------------------------------------------------ stages + inputs

const featParam = (s: Slot) => s.kind === "flag" ? s.name : s.feature.name;
const slotLabel = (s: Slot) => s.kind === "flag" ? s.label : s.feature.label;

function inputRows(bits: number[], w: string) {
  return `<div class="bits">${SLOTS.map(s => `
    <a class="feat feat-link" href="feature.html?f=${featParam(s)}&w=${encodeURIComponent(w)}">
      <span class="name">${esc(slotLabel(s))}</span>
      <span class="cells">${bits.slice(s.start, s.start + s.count).map((b, j) =>
        `<span class="cell ${b ? "on" : ""}" title="bit ${s.start + j}">${b}</span>`).join("")}</span>
      <span class="go" aria-hidden="true">→</span></a>`).join("")}</div>`;
}

function stagesCard(bits: number[]) {
  const st = runStages(bits), sizes = layerSizes(), last = st.layers[st.layers.length - 1];
  const grid = (arr: ArrayLike<number>, cls = "") => `<div class="sg ${cls}">${Array.from(arr, v => `<i class="${v ? "on" : ""}"></i>`).join("")}</div>`;
  const on = (a: Uint8Array) => a.reduce((x, y) => x + y, 0);
  const w = encodeURIComponent(wallet());
  const stage = (n: string, title: string, body: string, foot: string) =>
    `<a class="stage" href="stage.html?s=${Number(n)}&w=${w}"><span class="mono st-n">${n} <span class="go">→</span></span><b>${title}</b>${body}<span class="mono st-f">${foot}</span></a>`;
  const parts = [
    stage("01", "Read", grid(bits, "s-in"), `${bits.reduce((a, b) => a + b, 0)}/64 on`),
    ...st.layers.slice(0, -1).map((l, i) => stage(`0${i + 2}`, `Layer ${i + 1}`, grid(l), `${on(l)}/${sizes[i]} fired`)),
    stage(`0${st.layers.length + 1}`, "Vote", `<div class="vote">
        <div><span class="mono">human</span>${grid(last.slice(0, GROUP), "s-vote")}<b>${st.human}</b></div>
        <div><span class="mono">bot</span>${grid(last.slice(GROUP), "s-vote bot")}<b>${st.bot}</b></div></div>`,
      `${st.bot} − ${st.human} = ${st.margin > 0 ? "+" : ""}${st.margin}`),
    stage(`0${st.layers.length + 2}`, "Verdict", `<div class="st-verdict ${st.verdict ? "flag" : ""}"><span class="dot"></span>${st.verdict ? "Flagged" : "Passed"}</div>`, "bot > human"),
  ];
  return `<div class="card"><h2>Filter stages <span class="count mono">tap a stage</span></h2><div class="stages">${parts.join('<span class="arrow mono">→</span>')}</div></div>`;
}

// ------------------------------------------------------------------ feature detail

async function featurePage() {
  const f = new URLSearchParams(location.search).get("f") ?? "";
  const slot = SLOTS.find(s => featParam(s) === f);
  shell(slot ? slotLabel(slot) : "Input");
  const el = $("page");
  if (!slot) return needWallet(el);
  try {
    const r = await lookup(wallet());
    if (!r || r.status !== "ok") return needWallet(el);
    const net = await loadNet(), isFlag = slot.kind === "flag";
    const cur = isFlag ? r.bits[slot.start] : levelOf(r.bits, slot), levels = isFlag ? 2 : slot.count + 1;
    const fmtT = (x: number) => slot.kind === "feature"
      ? (slot.feature.unit === "%" ? `${x}%` : slot.feature.unit === "USD" ? `$${x.toLocaleString("en-US")}` : x.toLocaleString("en-US")) : String(x);
    const rangeOf = (L: number) => slot.kind === "flag" ? (L ? "yes" : "no")
      : L === 0 ? `≤ ${fmtT(slot.feature.thresholds[0])}`
      : L === slot.count ? `> ${fmtT(slot.feature.thresholds[L - 1])}`
      : `${fmtT(slot.feature.thresholds[L - 1])}–${fmtT(slot.feature.thresholds[L])}`;
    const whatIf = Array.from({ length: levels }, (_, L) => {
      const b = isFlag ? (() => { const x = r.bits.slice(); x[slot.start] = L; return x; })() : withLevel(r.bits, slot, L);
      return { L, ...decide(net, b) };
    });
    const st = (fstats.features as Record<string, { readers: number; bot: number[]; human: number[] }>)[featParam(slot)];
    const botN = st.bot.reduce((a, b) => a + b, 0), humN = st.human.reduce((a, b) => a + b, 0);
    const maxShare = Math.max(...st.bot.map(v => v / botN), ...st.human.map(v => v / humN), 0.01);
    el.innerHTML = `
      <div class="card"><div class="verdict">${pill(r)}<span class="mono muted">${short(r.wallet)}</span>
        <span class="actions"><a href="${link("check", r.wallet)}">← Back</a></span></div>
        <p class="now">${esc(slot.kind === "flag" ? `${slot.label}: ${cur ? "yes" : "no"}` : describeLevel(slot.feature, cur))}</p>
        ${slot.kind === "flag" ? "" : `<div class="ladder">${slot.feature.thresholds.map((t, i) => `<div class="rung ${i < cur ? "on" : ""}"><i></i><span class="mono">&gt; ${fmtT(t)}</span></div>`).join("")}</div>`}
      </div>
      <div class="card">
        <h2>What if <span class="count mono">everything else unchanged</span></h2>
        <div class="whatif">${whatIf.map(w => `<div class="wi ${w.L === cur ? "cur" : ""} ${w.verdict ? "flag" : "pass"}">
          <span class="mono lvl">${esc(rangeOf(w.L))}</span><span class="dot"></span><b>${w.verdict ? "Flagged" : "Passed"}</b><span class="mono m">${w.margin > 0 ? "+" : ""}${w.margin}</span></div>`).join("")}</div>
      </div>
      <div class="card">
        <h2>Labelled wallets <span class="count mono">${botN} bots · ${humN} humans</span></h2>
        <div class="dist">${Array.from({ length: levels }, (_, L) => `<div class="dl-col ${L === cur ? "cur" : ""}">
          <div class="bars2"><i class="b" style="height:${(st.bot[L] / botN / maxShare * 100).toFixed(1)}%"></i><i class="h" style="height:${(st.human[L] / humN / maxShare * 100).toFixed(1)}%"></i></div>
          <span class="mono">${esc(rangeOf(L))}</span></div>`).join("")}</div>
        <div class="legend mono"><span><i class="b"></i>bots</span><span><i class="h"></i>humans</span><span>share of each class</span></div>
      </div>
      <div class="card"><h2>Wiring</h2><div class="facts mono"><span>${st.readers} first-stage gates read this</span><span>bits ${slot.start}–${slot.start + slot.count - 1}</span></div></div>`;
  } catch (e) { fail(el, e); }
}

// ------------------------------------------------------------------ check

function checkPage() {
  shell("Check");
  $("page").innerHTML = `
    <form id="f" class="row">
      <input id="w" class="mono" placeholder="0x… wallet" autocomplete="off" spellcheck="false" value="${esc(wallet())}" />
      <button class="btn-dark mono">Check</button>
    </form>
    <div id="samples" class="samples mono"></div>
    <div id="out" class="out"></div>`;
  const out = $("out");
  const go = async (w: string) => {
    out.innerHTML = `<div class="skeleton"><i></i><i></i><i></i></div>`;
    try {
      const r = await lookup(w);
      if (!r) return void (out.innerHTML = "");
      if (r.status === "invalid") return void (out.innerHTML = `<div class="card warn">Not a valid address.</div>`);
      if (r.status === "not-in-snapshot") return void (out.innerHTML = `<div class="card">Not in this campaign's snapshot.</div>`);
      history.replaceState(null, "", `?w=${r.wallet}`);
      const agree = r.localVerdict === r.verdict;
      out.innerHTML = `
        <div class="card">
          <div class="verdict">${pill(r)}<span class="mono muted">${short(r.wallet)}</span>
            <span class="actions"><a href="${link("explain", r.wallet)}">Why →</a><a href="${link("cluster", r.wallet)}">Cluster →</a><a href="${link("appeal", r.wallet)}">Appeal →</a></span></div>
          ${marginBar(r.margin, r.verdict)}
          <div class="facts mono">
            <span class="ok">Snapshot proof</span>
            <span class="${agree ? "ok" : "warn"}">Browser re-run</span>
            <span>${LIVE ? "eth_call" : "local"}</span>
          </div>
        </div>
        ${stagesCard(r.bits)}
        <div class="card">
          <h2>64 inputs <span class="count mono">tap a row</span></h2>
          ${inputRows(r.bits, r.wallet)}
          <div class="hex"><code class="mono">${r.bitsHex}</code><button class="ghost" id="copy">Copy</button></div>
        </div>`;
      $("copy").onclick = () => navigator.clipboard.writeText(r.bitsHex);
    } catch (e) { fail(out, e); }
  };
  $("f").addEventListener("submit", e => { e.preventDefault(); go($<HTMLInputElement>("w").value.trim()); });
  $("w").addEventListener("input", () => { const v = $<HTMLInputElement>("w").value.trim(); if (/^0x[0-9a-fA-F]{2}/.test(v)) shard(v).catch(() => {}); });
  loadNet().catch(() => {});   // warm the circuit while the page is idle
  sampleWallets().then(ws => {
    ws.slice(0, 4).forEach(w => shard(w).catch(() => {}));
    $("samples").innerHTML = ws.slice(0, 4).map(w => `<button type="button" data-w="${esc(w)}">${short(w, 4)}</button>`).join("");
    $("samples").querySelectorAll<HTMLButtonElement>("button").forEach(b => b.onclick = () => {
      $<HTMLInputElement>("w").value = b.dataset.w!; go(b.dataset.w!);
    });
  }).catch(() => {});
  if (wallet()) go(wallet());
}

// ------------------------------------------------------------------ explain

async function explainPage() {
  shell("Explain");
  const el = $("page");
  try {
    const r = await lookup(wallet());
    if (!r || r.status !== "ok") return needWallet(el);
    const net = await loadNet(), fl = flips(net, r.bits);
    el.innerHTML = `
      <div class="card"><div class="verdict">${pill(r)}<span class="mono muted">${short(r.wallet)}</span></div>${marginBar(r.margin, r.verdict)}</div>
      <div class="card">
        <h2>Flips the result</h2>
        ${fl.length ? `<ul class="reasons">${fl.map(c => `<li><span>${esc(c.from)}</span><span class="arrow">→</span><span class="to">${esc(c.to)}</span></li>`).join("")}</ul>`
          : `<p class="muted">Nothing on its own.</p>`}
      </div>
      <div class="card">
        <h2>Read</h2>
        <table><tbody>${readings(r.bits).map(x => `<tr><td>${esc(x.text)}</td><td class="mono muted">${x.bits.join("")}</td></tr>`).join("")}</tbody></table>
      </div>
      <div class="card">
        <h2>Gates <span class="count mono" id="gcount">…</span></h2>
        <div class="gatemap" id="gmap"><div class="skeleton"><i></i><i></i></div></div>
      </div>`;
    // the gate map is the heaviest part: paint the page first, then fill it in
    requestAnimationFrame(() => setTimeout(() => {
      const dgs = new Set(decidingGates(net, r.bits));
      $("gcount").textContent = `${dgs.size} / ${net.a.length} deciding`;
      $("gmap").innerHTML = Array.from(net.a, (_, g) => `<i class="${dgs.has(g) ? "d" : ""}" title="gate ${g}"></i>`).join("");
    }, 0));
  } catch (e) { fail(el, e); }
}

// ------------------------------------------------------------------ audit

async function auditPage() {
  shell("Audit");
  const el = $("page");
  el.innerHTML = `<div id="a"></div><div class="row"><button id="run" class="btn-dark mono">Run audit</button></div><pre id="log" class="log mono" hidden></pre>`;
  const render = async () => {
    try {
      const a = await auditInfo();
      const done = a.rounds.filter(r => r.status === "done"), expired = a.rounds.filter(r => r.status === "expired").length;
      const c = done.reduce((s, r) => s + r.correct, 0), t = done.reduce((s, r) => s + r.total, 0);
      const bound = a.netlistHash && a.committedHash && a.netlistHash.toLowerCase() === a.committedHash.toLowerCase() && a.bound;
      $("a").innerHTML = `
        <div class="stats">
          <div><span class="k mono">Score</span><span class="v">${t ? `${(100 * c / t).toFixed(0)}%` : "–"}</span><span class="s mono">${t ? `${c}/${t}` : "no rounds"}</span></div>
          <div><span class="k mono">Rounds</span><span class="v">${done.length}</span><span class="s mono">${a.k} rows each</span></div>
          <div><span class="k mono">Expired</span><span class="v ${expired ? "warn" : ""}">${expired}</span><span class="s mono">unfinished</span></div>
          <div><span class="k mono">Test set</span><span class="v">${a.testSize}</span><span class="s mono" title="${a.testRoot}">${short(a.testRoot, 4)}</span></div>
        </div>
        ${LIVE ? `<div class="facts mono"><span class="${bound ? "ok" : "warn"}">${bound ? "Commit bound" : "Not bound"}</span></div>` : ""}
        ${a.rounds.length ? `<div class="card"><table><thead><tr><th>Round</th><th>Status</th><th>Score</th></tr></thead><tbody>${a.rounds.map(r =>
          `<tr><td class="mono">#${r.id}</td><td class="${r.status === "expired" ? "warn" : ""}">${r.status}</td><td>${r.status === "done" ? `${r.correct}/${r.total}` : "–"}</td></tr>`).join("")}</tbody></table></div>` : ""}`;
    } catch (e) { fail($("a"), e); }
  };
  $("run").addEventListener("click", async () => {
    const btn = $<HTMLButtonElement>("run"), log = $("log");
    btn.disabled = true; log.hidden = false; log.textContent = "";
    try {
      const r = await runAudit(s => { log.textContent += s + "\n"; log.scrollTop = log.scrollHeight; });
      log.textContent += `\nround #${r.id}: ${r.correct}/${r.total}\n`;
      await render();
    } catch (e) { log.textContent += `\nerror: ${(e as Error).message ?? e}\n`; }
    finally { btn.disabled = false; }
  });
  await render();
}

// ------------------------------------------------------------------ appeal

async function appealPage() {
  shell("Appeal");
  $("page").innerHTML = `
    <form id="f" class="stack-form">
      <label><span class="mono">Wallet</span><input id="aw" class="mono" spellcheck="false" placeholder="0x…" /></label>
      <label><span class="mono">Bits</span><input id="ab" class="mono" spellcheck="false" placeholder="0x…" /></label>
      <label><span class="mono">What's wrong</span><textarea id="an" rows="3" maxlength="600"></textarea></label>
      <div class="row"><button class="btn-dark mono">Prepare</button></div>
    </form>
    <div id="out" class="out"></div>`;
  try {
    const r = await lookup(wallet());
    if (r?.status === "ok") { $<HTMLInputElement>("aw").value = r.wallet; $<HTMLInputElement>("ab").value = r.bitsHex; }
  } catch { /* the form still works without a prefill */ }
  $("f").addEventListener("submit", e => {
    e.preventDefault();
    const msg = `Cusity appeal\ncampaign: #${CONFIG.campaignId}\nwallet: ${$<HTMLInputElement>("aw").value.trim()}\nbits: ${$<HTMLInputElement>("ab").value.trim()}\nnote: ${$<HTMLTextAreaElement>("an").value.trim()}`;
    $("out").innerHTML = `<div class="card"><div class="msg mono" id="m"></div>
      <div class="row" style="margin-top:12px"><button class="btn-dark mono" id="cp">Copy</button>
      ${CONFIG.containerId ? `<span class="mono muted">TapeSend → ${esc(CONFIG.containerId)}</span>` : `<span class="mono muted">TapeSend opens at launch</span>`}</div></div>`;
    $("m").textContent = msg;   // user text goes in as text, never HTML
    $("cp").onclick = () => navigator.clipboard.writeText(msg);
  });
}



// ------------------------------------------------------------------ stage detail

const FEATURE_OF_BIT = (bit: number) => SLOTS.find(s => bit >= s.start && bit < s.start + s.count)!;

async function stagePage() {
  const sIdx = Number(new URLSearchParams(location.search).get("s") ?? "1");
  const sizes = layerSizes(), nL = sizes.length;   // 5 logic layers; the last one is the vote
  const title = sIdx === 1 ? "Stage 01 · Read" : sIdx <= nL ? `Stage 0${sIdx} · Layer ${sIdx - 1}` : sIdx === nL + 1 ? `Stage 0${sIdx} · Vote` : `Stage 0${sIdx} · Verdict`;
  shell(title);
  const el = $("page");
  try {
    const r = await lookup(wallet());
    if (!r || r.status !== "ok") return needWallet(el);
    const st = runStages(r.bits), w = r.wallet;
    const nav = `<div class="stage-nav mono">${sIdx > 1 ? `<a href="stage.html?s=${sIdx - 1}&w=${encodeURIComponent(w)}">← Stage 0${sIdx - 1}</a>` : "<span></span>"}
      <a href="${link("check", w)}">All stages</a>
      ${sIdx < nL + 2 ? `<a href="stage.html?s=${sIdx + 1}&w=${encodeURIComponent(w)}">Stage 0${sIdx + 1} →</a>` : "<span></span>"}</div>`;
    const head = `<div class="card"><div class="verdict">${pill(r)}<span class="mono muted">${short(w)}</span></div>${nav}</div>`;
    const featTable = (counts: Map<number, number>, total: number) => {
      const per = new Map<string, { slot: Slot; n: number }>();
      for (const [bit, n] of counts) { const s = FEATURE_OF_BIT(bit), k = featParam(s); const e = per.get(k) ?? { slot: s, n: 0 }; e.n += n; per.set(k, e); }
      const rows = [...per.values()].sort((a, b) => b.n - a.n);
      const max = Math.max(1, ...rows.map(x => x.n));
      return rows.length ? `<div class="drivers">${rows.map(x => `<a class="drv" href="feature.html?f=${featParam(x.slot)}&w=${encodeURIComponent(w)}">
        <span>${esc(slotLabel(x.slot))}</span><i style="width:${(x.n / max * 100).toFixed(0)}%"></i><span class="mono">${x.n}</span></a>`).join("")}</div>
        <p class="muted mono small">${total} deciding neuron${total === 1 ? "" : "s"} traced back to the inputs they read</p>` : `<p class="muted">No single neuron here decides this wallet's result.</p>`;
    };

    if (sIdx === 1) {
      const on = r.bits.reduce((a, b) => a + b, 0);
      el.innerHTML = head + `
        <div class="stats"><div><span class="k mono">Bits</span><span class="v">64</span><span class="s mono">inputs</span></div>
          <div><span class="k mono">On</span><span class="v">${on}</span><span class="s mono">${(on / 64 * 100).toFixed(0)}%</span></div>
          <div><span class="k mono">Features</span><span class="v">10</span><span class="s mono">+ 4 flags</span></div>
          <div><span class="k mono">Packed</span><span class="v small-v mono">${r.bitsHex.slice(0, 10)}…</span><span class="s mono">8 bytes, LSB first</span></div></div>
        <div class="card"><h2>Inputs <span class="count mono">tap a row</span></h2>${inputRows(r.bits, w)}</div>`;
    } else if (sIdx <= nL + 1) {
      const li = sIdx - 2, layer = st.layers[li], live = liveNeurons()[li], dec = decidingNeurons(r.bits, li), decS = new Set(dec);
      const fired = layer.reduce((a, b) => a + b, 0), ops = opsOf(li, live);
      const opRows = ops.map((n, o) => ({ n, o })).filter(x => x.n).sort((a, b) => b.n - a.n);
      const isVote = sIdx === nL + 1;
      const grid = (from: number, to: number) => `<div class="ngrid">${Array.from({ length: to - from }, (_, k) => {
        const j = from + k; return `<i class="${layer[j] ? "on" : ""} ${decS.has(j) ? "d" : ""} ${live.has(j) ? "" : "dead"}" title="neuron ${j}${decS.has(j) ? " · deciding" : ""}${live.has(j) ? "" : " · pruned"}"></i>`; }).join("")}</div>`;
      el.innerHTML = head + `
        <div class="stats">
          <div><span class="k mono">${isVote ? "Voters" : "Neurons"}</span><span class="v">${sizes[li]}</span><span class="s mono">${live.size} live</span></div>
          <div><span class="k mono">Fired</span><span class="v">${fired}</span><span class="s mono">${(fired / sizes[li] * 100).toFixed(0)}%</span></div>
          <div><span class="k mono">Deciding</span><span class="v">${dec.length}</span><span class="s mono">flip one, verdict flips</span></div>
          <div><span class="k mono">${isVote ? "Margin" : "Reads"}</span><span class="v">${isVote ? (st.margin > 0 ? "+" : "") + st.margin : (li === 0 ? 64 : sizes[li - 1])}</span><span class="s mono">${isVote ? `${st.bot} bot − ${st.human} human` : "from previous stage"}</span></div>
        </div>
        ${isVote ? `<div class="card"><h2>The vote</h2><div class="votes">
            <div><span class="mono">human · ${st.human}</span>${grid(0, GROUP)}</div>
            <div><span class="mono">bot · ${st.bot}</span>${grid(GROUP, 2 * GROUP)}</div></div>
            <div class="legend mono"><span><i class="on"></i>fired</span><span><i class="d"></i>deciding</span></div></div>`
          : `<div class="card"><h2>Neurons <span class="count mono">${fired} fired · ${dec.length} deciding · ${sizes[li] - live.size} pruned</span></h2>${grid(0, sizes[li])}
            <div class="legend mono"><span><i class="on"></i>fired</span><span><i class="d"></i>deciding</span><span><i class="dead"></i>pruned</span></div></div>`}
        <div class="card"><h2>Driven by</h2>${featTable(inputsOf(li, dec), dec.length)}</div>
        <div class="card"><h2>Logic used <span class="count mono">live neurons</span></h2><div class="ops">${opRows.map(x =>
          `<div class="op"><span class="mono">${OP_NAMES[x.o]}</span><i style="width:${(x.n / opRows[0].n * 100).toFixed(0)}%"></i><span class="mono">${x.n}</span></div>`).join("")}</div></div>`;
    } else {
      el.innerHTML = head + `
        <div class="card"><div class="final ${st.verdict ? "flag" : ""}"><span class="dot"></span><div><b>${st.verdict ? "Flagged" : "Passed"}</b>
          <span class="mono">${st.bot} bot votes ${st.verdict ? ">" : "≤"} ${st.human} human votes · margin ${st.margin > 0 ? "+" : ""}${st.margin}</span></div></div>
          ${marginBar(st.margin, st.verdict)}
          <p class="muted small">A tie goes to human. The same rule runs on chain: output bit 0 is the verdict, bits 1–6 the margin + 32.</p></div>
        <div class="card"><h2>Next</h2><div class="dl mono">
          <a href="${link("explain", w)}">Why</a><a href="${link("cluster", w)}">Cluster</a><a href="${link("appeal", w)}">Appeal</a></div></div>`;
    }
  } catch (e) { fail(el, e); }
}

// ------------------------------------------------------------------ cluster

type GNode = SimulationNodeDatum & { id: string; kind: string; label?: number; src?: string; v?: number; m?: number };
type GEdge = { s: string; t: string; k: string };
type Cluster = { stats: { id: number; size: number; bots: number; flagged: number; funders: number; collectors: number; direct: number; window24h: number }; nodes: GNode[]; edges: GEdge[] };

type GIndex = { wallets: Record<string, number>; clusters: Cluster["stats"][]; hubDegree: number };
let gIndex: Promise<GIndex> | undefined;
const graphIndex = (): Promise<GIndex> => (gIndex ??= fetch("./graph/index.json").then(r => r.json()));

function drawGraph(c: Cluster, focus: string) {
  const W = 640, H = 420;
  const nodes = c.nodes.map(n => ({ ...n })) as GNode[];
  const byId = new Map(nodes.map(n => [n.id, n]));
  const links = c.edges.filter(e => byId.has(e.s) && byId.has(e.t)).map(e => ({ source: e.s, target: e.t, k: e.k }));
  const sim = forceSimulation(nodes).force("link", forceLink(links).id((d: any) => d.id).distance(l => (l as any).k === "direct" ? 50 : 70))
    .force("charge", forceManyBody().strength(-220)).force("center", forceCenter(W / 2, H / 2)).force("collide", forceCollide(16)).stop();
  for (let i = 0; i < 320; i++) sim.tick();
  const xs = nodes.map(n => n.x!), ys = nodes.map(n => n.y!), pad = 30;
  const [x0, x1, y0, y1] = [Math.min(...xs) - pad, Math.max(...xs) + pad, Math.min(...ys) - pad, Math.max(...ys) + pad];
  const edge = (l: any) => `<line x1="${l.source.x.toFixed(1)}" y1="${l.source.y.toFixed(1)}" x2="${l.target.x.toFixed(1)}" y2="${l.target.y.toFixed(1)}" class="e-${l.k}"/>`;
  const node = (n: GNode) => {
    const x = n.x!.toFixed(1), y = n.y!.toFixed(1);
    if (n.kind !== "wallet") return `<g class="n-${n.kind}"><title>${n.kind}: ${n.id}</title><rect x="${+x - 9}" y="${+y - 9}" width="18" height="18" transform="rotate(45 ${x} ${y})"/></g>`;
    const cls = `${n.v ? "flag" : "pass"} ${n.id === focus ? "focus" : ""}`;
    return `<a href="${link("check", n.id)}"><g class="n-wallet ${cls}"><title>${n.id} · ${n.v ? "flagged" : "passed"} (${(n.m ?? 0) > 0 ? "+" : ""}${n.m}) · labelled ${n.label ? "bot" : "human"} (${n.src})</title>
      <circle cx="${x}" cy="${y}" r="${n.id === focus ? 12 : 9}"/>${n.label ? `<circle cx="${x}" cy="${y}" r="3" class="lbl"/>` : ""}</g></a>`;
  };
  return `<svg class="graph" viewBox="${x0} ${y0} ${x1 - x0} ${y1 - y0}" role="img" aria-label="Cluster map">${links.map(edge).join("")}${nodes.map(node).join("")}</svg>`;
}

async function clusterPage() {
  shell("Cluster");
  const el = $("page");
  try {
    const gi = await graphIndex(), w = wallet().toLowerCase(), cid = w ? gi.wallets[w] : undefined;
    const list = `<div class="card"><h2>Largest clusters <span class="count mono">${gi.clusters.length} found · hubs over ${gi.hubDegree} wallets excluded</span></h2>
      <table><thead><tr><th>#</th><th>Wallets</th><th>Labelled bots</th><th>Flagged</th><th>Funded in 24 h</th></tr></thead><tbody>${gi.clusters.slice(0, 12).map(c =>
        `<tr class="row-link" data-c="${c.id}"><td class="mono">${c.id}</td><td>${c.size}</td><td>${c.bots}</td><td>${c.flagged}</td><td>${c.window24h}</td></tr>`).join("")}</tbody></table></div>`;
    const cParam = new URLSearchParams(location.search).get("c");
    const show = cParam !== null ? Number(cParam) : cid;
    if (show === undefined) {
      el.innerHTML = (w ? `<div class="card"><p class="now">This wallet has no shared funder, shared collection address or direct transfers with other labelled wallets.</p></div>` : "") + list;
    } else {
      const c: Cluster = await (await fetch(`./graph/c/${show}.json`)).json(), s = c.stats;
      el.innerHTML = `
        <div class="stats">
          <div><span class="k mono">Wallets</span><span class="v">${s.size}</span><span class="s mono">cluster #${s.id}</span></div>
          <div><span class="k mono">Flagged</span><span class="v">${s.flagged}</span><span class="s mono">by the circuit</span></div>
          <div><span class="k mono">Labelled bots</span><span class="v">${s.bots}</span><span class="s mono">from Sybil lists</span></div>
          <div><span class="k mono">Funded in 24 h</span><span class="v">${s.window24h}</span><span class="s mono">of ${s.size} wallets</span></div>
        </div>
        <div class="card"><h2>Map <span class="count mono">${s.funders} funders · ${s.collectors} collectors · ${s.direct} direct links</span></h2>
          ${drawGraph(c, w)}
          <div class="legend mono"><span><i class="lg-flag"></i>flagged</span><span><i class="lg-pass"></i>passed</span><span><i class="lg-funder"></i>shared funder</span><span><i class="lg-coll"></i>shared collector</span><span><i class="lg-lbl"></i>on a Sybil list</span></div></div>
        <div class="card"><h2>Members</h2><table><thead><tr><th>Wallet</th><th>List</th><th>Verdict</th><th>Margin</th></tr></thead><tbody>${c.nodes.filter(n => n.kind === "wallet").map(n =>
          `<tr class="row-link ${n.id === w ? "me" : ""}" data-w="${n.id}"><td class="mono">${short(n.id, 4)}</td><td class="mono">${esc(n.src ?? "")}</td><td class="${n.v ? "warn" : ""}">${n.v ? "Flagged" : "Passed"}</td><td class="mono">${(n.m ?? 0) > 0 ? "+" : ""}${n.m}</td></tr>`).join("")}</tbody></table></div>` + list;
    }
    el.querySelectorAll<HTMLTableRowElement>("tr.row-link").forEach(tr => tr.onclick = () => {
      location.href = tr.dataset.w ? link("check", tr.dataset.w) : `cluster.html?c=${tr.dataset.c}`;
    });
  } catch (e) { fail(el, e); }
}

// ------------------------------------------------------------------ campaign

async function campaignPage() {
  shell("Campaign");
  let vectorsRoot = "";
  try { vectorsRoot = (await snapshotIndex()).root; } catch { /* shown as pending */ }
  const steps: [string, string, string, boolean][] = [   // label, value, note, done on chain
    ["Test set committed", card.testRoot, `${card.testSize} rows`, LIVE],
    ["Filter hash committed", card.netlistSha256, "before snapshot", LIVE],
    ["Snapshot", "76,254,000", "block", true],
    ["Wallet bits published", vectorsRoot, "Merkle root", LIVE],
    ["Taped out + bound", LIVE ? `#${CONFIG.circuitId}` : "—", "circuit", LIVE],
    ["Audits", "", "see Audit", LIVE],
  ];
  $("page").innerHTML = `
    <ol class="timeline">${steps.map(([l, v, n, done], i) => `
      <li class="${done ? "done" : ""}" style="--i:${i}"><a class="tl-link" href="step.html?n=${i + 1}">
        <span class="tl-n mono">0${i + 1}</span>
        <div class="tl-body"><b>${l}</b><span class="mono muted">${n}</span></div>
        <span class="tl-val">${v ? `<code class="mono" title="${esc(v)}">${v.startsWith("0x") ? short(v, 6) : esc(v)}</code>` : ""}</span>
        <span class="tl-state mono">${done ? "on chain" : "pending"}</span>
        <span class="go mono" aria-hidden="true">→</span>
      </a></li>`).join("")}</ol>`;
}


// ------------------------------------------------------------------ campaign step detail

const STEPS = ["Test set committed", "Filter hash committed", "Snapshot", "Wallet bits published", "Taped out + bound", "Audits"];
const SNAP_BLOCK = 76_254_000n;
type Check = { label: string; ok: boolean | null; detail: string };
const checksHtml = (cs: Check[]) => `<ul class="checks">${cs.map(c => `<li class="${c.ok === null ? "" : c.ok ? "c-ok" : "c-bad"}">
  <span class="mark mono">${c.ok === null ? "…" : c.ok ? "✓" : "✗"}</span><span>${esc(c.label)}</span><span class="mono muted">${esc(c.detail)}</span></li>`).join("")}</ul>`;
const callCard = (fn: string, note: string) => `<div class="card"><h2>Contract call <span class="count mono">${esc(note)}</span></h2><pre class="call mono">${esc(fn)}</pre></div>`;
const tile = (k: string, v: string, sub: string) => `<div><span class="k mono">${k}</span><span class="v">${v}</span><span class="s mono">${sub}</span></div>`;
const dateOf = (t: number) => new Date(t * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";
const testLeaf = (i: number, bits: Hex, label: boolean) => keccak256(encodePacked(["uint32", "bytes8", "bool"], [i, bits, label]));
const snapLeaf = (w: Hex, bits: Hex) => keccak256(encodePacked(["address", "bytes8"], [w, bits]));
type TL = { root: Hex; size: number; leaves: { index: number; bits: Hex; label: number; leaf: Hex; proof: Hex[] }[] };

/** Probability mass of Binomial(n, p). */
const binom = (n: number, p: number) => {
  const out: number[] = []; let c = 1;
  for (let k = 0; k <= n; k++) { out.push(c * p ** k * (1 - p) ** (n - k)); c = c * (n - k) / (k + 1); }
  return out;
};

async function stepPage() {
  const n = Math.min(6, Math.max(1, Number(new URLSearchParams(location.search).get("n")) || 1));
  shell(`Step 0${n} · ${STEPS[n - 1]}`);
  const el = $("page");
  const done = n === 3 || LIVE;
  const nav = `<div class="stage-nav mono">${n > 1 ? `<a href="step.html?n=${n - 1}">← Step 0${n - 1}</a>` : "<span></span>"}
    <a href="campaign.html">All steps</a>${n < 6 ? `<a href="step.html?n=${n + 1}">Step 0${n + 1} →</a>` : "<span></span>"}</div>`;
  const head = `<div class="card"><div class="verdict"><span class="pill ${done ? "live" : "pend"}"><span class="dot"></span>${done ? "On chain" : "Pending"}</span>
    <span class="mono muted">campaign #${CONFIG.campaignId}</span></div>${nav}</div>`;
  const verify = (title: string, btn: string) => `<div class="card"><h2>${title}</h2><div id="vout">${checksHtml([])}</div>
    <button class="btn-dark mono" id="vbtn">${btn}</button></div>`;
  const runner = (fn: () => Promise<Check[]>) => {
    const b = $<HTMLButtonElement>("vbtn"), out = $("vout");
    b.onclick = async () => {
      b.disabled = true; b.textContent = "Checking…";
      try { out.innerHTML = checksHtml(await fn()); } catch (e) { out.innerHTML = checksHtml([{ label: "Check failed", ok: false, detail: String((e as Error).message ?? e) }]); }
      b.disabled = false; b.textContent = "Run again";
    };
  };
  try {
    if (n === 1) {
      const t: TL = await fetch(CONFIG.testLeavesUrl).then(r => r.json()), net = await loadNet();
      const bots = t.leaves.filter(l => l.label === 1).length;
      const rows = t.leaves.map(l => ({ ...l, v: decide(net, unpack(l.bits)).verdict }));
      const right = rows.filter(r => r.v === (r.label === 1)).length;
      el.innerHTML = head + `<div class="stats">${tile("Rows", String(t.size), "held out, never trained on")}${tile("Bots", String(bots), `${(bots / t.size * 100).toFixed(0)}%`)}
        ${tile("Humans", String(t.size - bots), `${((t.size - bots) / t.size * 100).toFixed(0)}%`)}${tile("Circuit right", `${right}`, `${(right / t.size * 100).toFixed(1)}% of rows`)}</div>
        <div class="card">${copyRow("Merkle root", t.root)}<div class="facts mono"><span>leaf = keccak256(index ‖ bits ‖ label)</span><span>sorted pairs</span><span>depth ${t.leaves[0].proof.length}</span></div></div>
        ${verify("Verify", "Rebuild the root")}
        <div class="card"><h2>Rows <span class="count mono">first 24 of ${t.size}</span></h2>
          <table><thead><tr><th>#</th><th>Bits</th><th>Label</th><th>Circuit</th><th></th></tr></thead><tbody>${rows.slice(0, 24).map(r => `<tr>
            <td class="mono">${r.index}</td><td class="mono">${r.bits}</td><td>${r.label ? "bot" : "human"}</td>
            <td class="${r.v ? "flagtxt" : ""}">${r.v ? "Flagged" : "Passed"}</td><td class="mono">${r.v === (r.label === 1) ? "✓" : "✗"}</td></tr>`).join("")}</tbody></table></div>
        ${callCard(`AccuracyAudit.commitTestSet(\n  root = ${t.root},\n  size = ${t.size}\n)`, "before the campaign")}`;
      runner(async () => {
        let leafOk = 0, proofOk = 0;
        for (const l of t.leaves) {
          const leaf = testLeaf(l.index, l.bits, l.label === 1);
          if (leaf === l.leaf) leafOk++;
          if (merkleRoot(leaf, l.proof).toLowerCase() === t.root.toLowerCase()) proofOk++;
        }
        return [
          { label: "Leaves recomputed from rows", ok: leafOk === t.size, detail: `${leafOk}/${t.size}` },
          { label: "Every proof reaches the root", ok: proofOk === t.size, detail: `${proofOk}/${t.size}` },
          { label: "Root matches the model card", ok: t.root.toLowerCase() === card.testRoot.toLowerCase(), detail: short(card.testRoot, 6) },
          { label: "Size matches the model card", ok: t.size === card.testSize, detail: String(card.testSize) },
        ];
      });
    } else if (n === 2) {
      el.innerHTML = head + `<div class="stats">${tile("Gates", String(card.gates), "NAND")}${tile("Inputs", String(card.nIn), "bits")}
        ${tile("Outputs", String(card.nOut), "verdict + margin")}${tile("Snapshot", "76.25M", "commit must come first")}</div>
        <div class="card">${copyRow("Netlist sha256", card.netlistSha256)}${copyRow("Extractor sha256", card.extractorSha256)}
          <div class="facts mono"><span>netlist = the circuit</span><span>extractor = the code that makes the 64 bits</span></div></div>
        ${verify("Verify", "Hash the published netlist")}
        <div class="card"><h2>Rules the contract enforces</h2><div class="rules">
          <div><b>SnapshotPassed</b><span>commit after the snapshot block is refused</span></div>
          <div><b>NetlistMismatch</b><span>bind fails if the taped-out circuit has another hash</span></div>
          <div><b>ExtractorMismatch</b><span>published bits must come from the committed extractor</span></div>
          <div><b>TestSetAfterCommit</b><span>the test set has to be older than the campaign</span></div></div></div>
        ${callCard(`CampaignCommit.commit(\n  netlistHash   = ${card.netlistSha256},\n  extractorHash = ${card.extractorSha256},\n  snapshotBlock = ${SNAP_BLOCK}\n)`, "before the snapshot")}`;
      runner(async () => {
        const nl: { netlist: Hex } = await fetch("./model/cusity.netlist.json").then(r => r.json());
        const bytes = new Uint8Array(nl.netlist.slice(2).match(/../g)!.map(h => parseInt(h, 16)));
        const h = "0x" + Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
        return [
          { label: "Netlist downloaded", ok: true, detail: `${bytes.length.toLocaleString("en-US")} bytes` },
          { label: "7 bytes per NAND gate", ok: bytes.length === card.gates * 7, detail: `${bytes.length / 7} gates` },
          { label: "sha256 matches the commitment", ok: h === card.netlistSha256.toLowerCase(), detail: short(h, 8) },
        ];
      });
    } else if (n === 3) {
      const span = (extCfg.windowEnd - extCfg.windowStart) / 86400;
      el.innerHTML = head + `<div class="stats">${tile("Block", "76,254,000", "X Layer")}${tile("Window", `${span} days`, "of history read")}
        ${tile("OKB price", `$${extCfg.okbUsd}`, "frozen for USD features")}${tile("Chain", String(extCfg.chainId), "X Layer mainnet")}</div>
        <div class="card"><h2>Window</h2><div class="window"><div><span class="mono muted">from</span><b>${dateOf(extCfg.windowStart)}</b></div>
          <i></i><div><span class="mono muted">to</span><b>${dateOf(extCfg.windowEnd)}</b></div></div></div>
        ${verify("Verify on X Layer", "Read the block")}
        <div class="card"><h2>Frozen inputs</h2><table><tbody>
          <tr><td>USDT0</td><td class="mono">${short(extCfg.usdt0, 8)}</td></tr>
          <tr><td>Exchange list</td><td class="mono">${extCfg.exchanges.length ? extCfg.exchanges.length + " addresses" : "none listed"}</td></tr>
          <tr><td>Extractor hash</td><td class="mono">${short(card.extractorSha256, 8)}</td></tr></tbody></table></div>`;
      runner(async () => {
        const [b, head] = await Promise.all([client.getBlock({ blockNumber: SNAP_BLOCK }), client.getBlockNumber()]);
        return [
          { label: "Block exists", ok: true, detail: short(b.hash!, 8) },
          { label: "Block time", ok: true, detail: dateOf(Number(b.timestamp)) },
          { label: "Final (behind the chain head)", ok: head > SNAP_BLOCK, detail: `${(head - SNAP_BLOCK).toLocaleString("en-US")} blocks ago` },
        ];
      });
    } else if (n === 4) {
      const si = await snapshotIndex(), w0 = (wallet() || si.samples[0]).toLowerCase();
      el.innerHTML = head + `<div class="stats">${tile("Wallets", si.count.toLocaleString("en-US"), "64 bits each")}${tile("Shards", "256", "by first address byte")}
        ${tile("Block", si.block.toLocaleString("en-US"), "snapshot")}${tile("Campaign", `#${si.campaignId}`, "")}</div>
        <div class="card">${copyRow("Merkle root", si.root)}${copyRow("Extractor sha256", si.extractorHash)}
          <div class="facts mono"><span>leaf = keccak256(wallet ‖ bits)</span><span>anyone can recompute it</span></div></div>
        <div class="card"><h2>Verify a wallet</h2>
          <form class="row" id="pf"><input class="mono" id="pw" value="${esc(w0)}" spellcheck="false" aria-label="Wallet" /><button class="btn-dark mono" id="vbtn">Prove</button></form>
          <div id="vout">${checksHtml([])}</div><div id="ppath"></div></div>
        ${callCard(`CampaignCommit.publishVectors(\n  id   = ${CONFIG.campaignId},\n  root = ${si.root},\n  uri  = "${location.origin}/snapshot/"\n)`, "after the snapshot")}`;
      $("pf").onsubmit = async e => {
        e.preventDefault();
        const w = $<HTMLInputElement>("pw").value.trim().toLowerCase(), out = $("vout");
        if (!/^0x[0-9a-f]{40}$/.test(w)) return void (out.innerHTML = checksHtml([{ label: "Not an address", ok: false, detail: "" }]));
        const entry = (await shard(w))[w];
        if (!entry) return void (out.innerHTML = checksHtml([{ label: "Not in this snapshot", ok: false, detail: short(w) }]));
        const leaf = snapLeaf(w as Hex, entry.bits);
        let h = leaf; const path = [h];
        for (const p of entry.proof) { h = keccak256((h.toLowerCase() < p.toLowerCase() ? `0x${h.slice(2)}${p.slice(2)}` : `0x${p.slice(2)}${h.slice(2)}`) as Hex); path.push(h); }
        out.innerHTML = checksHtml([
          { label: "Bits", ok: true, detail: entry.bits },
          { label: "Leaf", ok: true, detail: short(leaf, 8) },
          { label: `Proof (${entry.proof.length} steps) reaches the root`, ok: h.toLowerCase() === si.root.toLowerCase(), detail: short(h, 8) },
        ]);
        $("ppath").innerHTML = `<ol class="path mono">${path.map((x, i) => `<li><span>${i === 0 ? "leaf" : i === path.length - 1 ? "root" : `step ${i}`}</span>${short(x, 10)}</li>`).join("")}</ol>
          <a class="btn-dark mono" href="${link("check", w)}">Open in Check →</a>`;
      };
      $("pf").dispatchEvent(new Event("submit", { cancelable: true }));
    } else if (n === 5) {
      const opts: [string, string, string, string][] = [
        ["#419", "0xf70d324Da8C1C4Cb0dE3FF147E53E7E9db543c4e", "0.0013 OKB + 0.01 BEM", "cheapest"],
        ["#422", "0x550992f2dC407BfFDd82c516C0984dc5e00B37d3", "0.0013 OKB + 0.01 BEM", "cheapest"],
        ["#180", "0x7335a50819d44402e3D5E00239bBB80A13E7308F", "0.428 OKB", "OKB only"],
        ["#300", "0x9b826BD2984C2A041eE3b8f7168f2620fC5D3281", "0.854 OKB", ""],
      ];
      el.innerHTML = head + `<div class="stats">${tile("Transistors", String(card.gates), "one per NAND gate")}${tile("Netlist", `${(card.gates * 7).toLocaleString("en-US")} B`, "7 bytes per gate")}
        ${tile("Eval gas", "1.49M", "mainnet fork")}${tile("Circuit", LIVE ? `#${CONFIG.circuitId}` : "—", LIVE ? "bound" : "not yet")}</div>
        <div class="card"><h2>Sequence</h2><ol class="seq">
          <li><b>Mint</b><span>${card.gates} NAND transistors on the processor</span></li>
          <li><b>Tape out</b><span>upload the netlist, pay the tape-out fee</span></li>
          <li><b>Check</b><span>processor's netlist sha256 = committed hash</span></li>
          <li><b>Bind</b><span>campaign → circuit, once, can't be changed</span></li></ol></div>
        <div class="card"><h2>Processors <span class="count mono">all-in cost for ${card.gates} gates · tested on a fork</span></h2>
          <table><thead><tr><th>Processor</th><th>Address</th><th>Cost</th><th></th></tr></thead><tbody>${opts.map(([id, a, c, t]) => `<tr>
            <td class="mono">${id}</td><td class="mono"><a href="${CONFIG.explorer}/address/${a}" target="_blank" rel="noopener">${short(a, 4)}</a></td><td>${c}</td><td class="mono muted">${t}</td></tr>`).join("")}</tbody></table></div>
        ${callCard(`TapeOut.tapeout(netlist)        // processor, payable TAPEOUT_FEE\nCusityRegistry.register(processor, circuitId, testCommitId)\nCampaignCommit.bind(${CONFIG.campaignId}, modelId)`, "needs a funded wallet")}`;
    } else {
      const K = 16, p = card.test.accuracy, pm = binom(K, p), mx = Math.max(...pm);
      let lo = 0, acc = 0; while (acc + pm[lo] < 0.05) acc += pm[lo++];
      let hi = K; acc = 0; while (acc + pm[hi] < 0.05) acc += pm[hi--];
      el.innerHTML = head + `<div class="stats">${tile("Rows per round", String(K), "drawn by a future blockhash")}${tile("Expected", `${(K * p).toFixed(1)}`, `of ${K} right`)}
        ${tile("90% range", `${lo}–${hi}`, "for an honest circuit")}${tile("Test set", String(card.testSize), "rows to draw from")}</div>
        <div class="card"><h2>What an honest score looks like <span class="count mono">accuracy ${(p * 100).toFixed(1)}% · Binomial(${K})</span></h2>
          <div class="binom">${pm.map((v, k) => `<div class="${k >= lo && k <= hi ? "in" : ""}"><i style="height:${(v / mx * 100).toFixed(1)}%"></i><span class="mono">${k}</span></div>`).join("")}</div>
          <div class="legend mono"><span><i class="ink"></i>inside 90% range</span><span>score far below the range = the circuit doesn't match its claim</span></div></div>
        <div class="card"><h2>Round</h2><ol class="seq">
          <li><b>Request</b><span>anyone calls requestAudit(modelId)</span></li>
          <li><b>Wait</b><span>a future blockhash picks ${K} row indices</span></li>
          <li><b>Finalize</b><span>rows + Merkle proofs submitted, circuit evaluated on chain</span></li>
          <li><b>Score</b><span>correct / ${K} saved forever</span></li></ol>
          <a class="btn-dark mono" href="${link("audit")}">Open Audit →</a></div>
        ${callCard(`AccuracyAudit.requestAudit(modelId)\nAccuracyAudit.finalizeAudit(roundId, rows, proofs)`, "permissionless")}`;
    }
    wireCopy();
  } catch (e) { fail(el, e); }
}

// ------------------------------------------------------------------ model

function prevCard() {
  const c = card as typeof card & { previous?: { name: string; gates: number; test: typeof card.test }; changes?: string };
  if (!c.previous) return "";
  const p = c.previous, row = (k: string, a: string, b: string, better: boolean) =>
    `<tr><td>${k}</td><td class="mono">${a}</td><td class="mono ${better ? "ok" : ""}">${b}</td></tr>`;
  const pc = (x: number) => `${(x * 100).toFixed(1)}%`;
  return `<div class="card"><h2>${esc(p.name.replace("Cusity bot filter ", ""))} → ${esc(c.name.replace("Cusity bot filter ", ""))} <span class="count mono">same 364 held-out wallets</span></h2>
    <table><thead><tr><th></th><th>${esc(p.name.replace("Cusity bot filter ", ""))}</th><th>${esc(c.name.replace("Cusity bot filter ", ""))}</th></tr></thead><tbody>
    ${row("Balanced accuracy", pc(p.test.balanced_accuracy), pc(c.test.balanced_accuracy), c.test.balanced_accuracy > p.test.balanced_accuracy)}
    ${row("Bot recall", pc(p.test.bot_recall), pc(c.test.bot_recall), c.test.bot_recall > p.test.bot_recall)}
    ${row("Bot precision", pc(p.test.bot_precision), pc(c.test.bot_precision), c.test.bot_precision > p.test.bot_precision + 0.0005)}
    ${row("NAND gates", String(p.gates), String(c.gates), c.gates < p.gates)}</tbody></table>
    ${c.changes ? `<p class="muted note">${esc(c.changes)}</p>` : ""}</div>`;
}

function modelPage() {
  shell("Model");
  const t = card.test;
  $("page").innerHTML = `
    <div class="stats">
      <div><span class="k mono">Gates</span><span class="v">${card.gates}</span><span class="s mono">NAND</span></div>
      <div><span class="k mono">Inputs</span><span class="v">${card.nIn}</span><span class="s mono">bits</span></div>
      <div><span class="k mono">Accuracy</span><span class="v">${(t.balanced_accuracy * 100).toFixed(1)}%</span><span class="s mono">held-out, balanced</span></div>
      <div><span class="k mono">Bot precision</span><span class="v">${(t.bot_precision * 100).toFixed(0)}%</span><span class="s mono">recall ${(t.bot_recall * 100).toFixed(0)}%</span></div>
    </div>
    <div class="card">
      <h2>Identity</h2>
      ${LIVE ? copyRow("Processor", CONFIG.processor) + `<div class="hashrow"><span class="k mono">Circuit ID</span><code class="mono">#${CONFIG.circuitId}</code></div>` : ""}
      ${copyRow("Netlist sha256", card.netlistSha256)}
      ${copyRow("Extractor sha256", card.extractorSha256)}
      ${copyRow("Test-set root", card.testRoot)}
    </div>
    ${prevCard()}
    <div class="card">
      <h2>Architecture</h2>
      <div class="facts mono"><span>difflogic</span><span>${card.architecture.widths.join(" → ")} → ${card.architecture.group * 2}</span><span>verdict + 6-bit margin</span></div>
    </div>
    <div class="card">
      <h2>Download</h2>
      <div class="dl mono">
        <a href="./model/cusity.netlist.json" download>netlist.json</a>
        <a href="./model/cusity.v" download>cusity.v</a>
        <a href="./model/model_card.json" download>model_card.json</a>
        <a href="./test_leaves.json" download>test_leaves.json</a>
      </div>
    </div>`;
  wireCopy();
}

({ check: checkPage, explain: explainPage, audit: auditPage, appeal: appealPage, campaign: campaignPage, model: modelPage, feature: featurePage, stage: stagePage, cluster: clusterPage, step: stepPage })[page]();
startMotion();
