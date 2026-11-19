// The app: ten pages sharing one shell (check, explain, cluster, audit, appeal, campaign, model, and the
// feature / stage / step detail pages). The last checked wallet carries across pages (sessionStorage), and
// ?w=0x… makes any page shareable. Every number shown comes from a data file or the chain, never typed in.
import "./style.css";
import { CONFIG, LIVE } from "./config";
import { auditInfo, checkWallet, live, loadCircuit, loadNet, runAudit, type CheckResult } from "./chain";
import { checksum, clusterById, FetchError, graphIndex, inSnapshot, rebuildTestRoot, sampleWallets, shardOf, snapshotIndex,
  snapshotList, testLeaves, type GIndex } from "./data";
import { decidingGates, flips, readings } from "./explain";
import { $, copyButton, esc, marginBar, short } from "./ui";
import { startMotion } from "./motion";
import card from "../public/model/model_card.json";
import fstats from "../public/model/feature_stats.json";
import measured from "./measured.json";
import extCfg from "../../data/extractor.config.json";
import { runStages, layerSizes, GROUP, liveNeurons, neuronEffects, inputsOf, opsOf, OP_NAMES } from "./stages";
import { decide } from "./tap02";
import { SLOTS, FEATURES, FLAGS, levelOf, withLevel, describeLevel, unpack, type Slot } from "../../data/features";
import { build, snapshotLeaf, testLeaf, verify, rootFrom } from "../../data/merkle_core";
import type { Hex } from "viem";

type Page = "check" | "explain" | "cluster" | "audit" | "appeal" | "campaign" | "model" | "feature" | "stage" | "step";
type Ok = Extract<CheckResult, { status: "ok" }>;
const PAGES: [Page, string][] = [["check", "Check"], ["explain", "Explain"], ["cluster", "Cluster"], ["audit", "Audit"], ["appeal", "Appeal"], ["campaign", "Campaign"], ["model", "Model"]];
const PARENT: Partial<Record<Page, Page>> = { feature: "check", stage: "check", step: "campaign" };
const page = (document.body.dataset.page ?? "check") as Page;
const KEY = "cusity:wallet";
const params = new URLSearchParams(location.search);

let current = params.get("w") ?? sessionStorage.getItem(KEY) ?? "";
const wallet = () => current;
const remember = (w: string) => { current = w; sessionStorage.setItem(KEY, w); syncNav(); };
const link = (p: Page, w = wallet()) => `${p}.html${w ? `?w=${encodeURIComponent(w)}` : ""}`;
const pad2 = (n: number) => String(n).padStart(2, "0");
const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const signed = (m: number) => `${m > 0 ? "+" : ""}${m}`;

// ------------------------------------------------------------------ shell

function syncNav() {
  document.querySelectorAll<HTMLAnchorElement>(".rail-nav a[data-p]").forEach(a => (a.href = link(a.dataset.p as Page)));
}

function shell(title: string) {
  const on = (p: Page) => p === page || PARENT[page] === p;
  const nav = PAGES.map(([p, label], i) =>
    `<a data-p="${p}" href="${link(p)}" class="${on(p) ? "on" : ""}" ${on(p) ? 'aria-current="page"' : ""}><span>${pad2(i + 1)}</span>${label}</a>`).join("");
  document.body.innerHTML = `
    <a class="skip mono" href="#page">Skip to content</a>
    <header class="app-bar">
      <a class="bar-brand" href="index.html" aria-label="Cusity home"><img src="./logo.svg" alt="cusity" height="24" /></a>
      <button class="menu-btn" id="menu" aria-label="Toggle menu" aria-controls="rail" aria-expanded="true"><i></i><i></i><i></i></button>
    </header>
    <aside class="rail" id="rail" aria-label="Pages">
      <nav class="rail-nav">${nav}</nav>
      <a class="rail-home mono" href="index.html">← Home</a>
      <div class="rail-status mono"><span class="lbl">Circuit</span><span class="val">${LIVE ? "live on X Layer" : "demo (in browser)"}</span></div>
    </aside>
    <div class="app-main">
      <main class="sheet app-sheet">
        <h1 class="app-title">${esc(title)}</h1>
        <div id="page" tabindex="-1"></div>
      </main>
    </div>
    <div class="scrim" id="scrim"></div>`;
  // ☰: on desktop the sidebar collapses/expands (remembered); on phones it slides over as a drawer.
  // A hidden sidebar is inert, so keyboard focus can't land on links you can't see.
  const phone = () => matchMedia("(max-width: 980px)").matches;
  const KEY_RAIL = "cusity:rail", rail = $("rail"), menu = $("menu");
  if (localStorage.getItem(KEY_RAIL) === "closed") document.body.classList.add("rail-collapsed");
  const sync = () => {
    const open = phone() ? document.body.classList.contains("drawer-open") : !document.body.classList.contains("rail-collapsed");
    menu.setAttribute("aria-expanded", String(open));
    rail.toggleAttribute("inert", !open);
  };
  const drawer = (v: boolean) => {
    document.body.classList.toggle("drawer-open", v); sync();
    if (v) rail.querySelector<HTMLElement>("a")?.focus();
  };
  menu.onclick = () => {
    if (phone()) return drawer(!document.body.classList.contains("drawer-open"));
    const closed = document.body.classList.toggle("rail-collapsed");
    localStorage.setItem(KEY_RAIL, closed ? "closed" : "open"); sync();
  };
  $("scrim").onclick = () => drawer(false);
  addEventListener("keydown", e => {
    if (e.key === "Escape" && document.body.classList.contains("drawer-open")) { drawer(false); menu.focus(); }
  });
  matchMedia("(max-width: 980px)").addEventListener("change", sync);
  sync();
}

const copyRow = (label: string, v: string) =>
  `<div class="hashrow"><span class="k mono">${label}</span><code class="mono" title="${esc(v)}">${short(v, 10)}</code><button class="ghost" data-copy="${esc(v)}">Copy</button></div>`;
const wireCopy = (root: ParentNode = document) =>
  root.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach(b => copyButton(b, () => b.dataset.copy!));

const pill = (r: { verdict: boolean }) => `<span class="pill ${r.verdict ? "flag" : ""}"><span class="dot"></span>${r.verdict ? "Flagged" : "Passed"}</span>`;

/** An error card with a Retry button (retry re-runs the page's loader; failed fetches are not cached). */
function fail(el: HTMLElement, e: unknown, retry?: () => void) {
  const msg = e instanceof FetchError ? e.message : String((e as Error)?.message ?? e);
  el.innerHTML = `<div class="card warn" role="alert"><p>${esc(msg)}</p>${retry ? `<button class="btn-dark mono" type="button">Try again</button>` : ""}</div>`;
  if (retry) el.querySelector("button")!.onclick = retry;
}

/** Only the newest lookup may write to the page (a slow older one is dropped). */
let lookupSeq = 0;
async function lookup(w: string): Promise<CheckResult | undefined | "stale"> {
  if (!w) return undefined;
  const my = ++lookupSeq, r = await checkWallet(w);
  if (my !== lookupSeq) return "stale";
  if (r.status === "ok") remember(r.wallet);
  return r;
}

function needWallet(el: HTMLElement, note = "") {
  el.innerHTML = `<div class="empty">${note ? `<p>${esc(note)}</p>` : ""}<a class="btn-dark mono" href="check.html">Check a wallet first</a></div>`;
}

/** Live mode only: warn if the circuit bound on chain is not the one this site's card and stage pages describe. */
async function cardWarning(el: HTMLElement) {
  if (!LIVE) return;
  try { if (!(await loadCircuit()).matchesCard) el.insertAdjacentHTML("afterbegin", `<div class="card warn" role="alert">The circuit bound on chain is not the model this site's card describes. Verdicts come from chain; the stage view describes the card's model.</div>`); }
  catch { /* the page's own error handling reports chain problems */ }
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

const NSTAGES = () => layerSizes().length + 2;   // read, each logic layer (the last is the vote), verdict
function stageTitle(s: number) {
  const nL = layerSizes().length;
  return s === 1 ? "Read" : s <= nL ? `Layer ${s - 1}` : s === nL + 1 ? "Vote" : "Verdict";
}

function stagesCard(bits: number[], w: string) {
  const st = runStages(bits), sizes = layerSizes(), last = st.layers[st.layers.length - 1];
  const grid = (arr: ArrayLike<number>, cls = "") => `<div class="sg ${cls}">${Array.from(arr, v => `<i class="${v ? "on" : ""}"></i>`).join("")}</div>`;
  const on = (a: Uint8Array) => a.reduce((x, y) => x + y, 0);
  const stage = (n: number, body: string, foot: string) =>
    `<a class="stage" href="stage.html?s=${n}&w=${encodeURIComponent(w)}"><span class="mono st-n">${pad2(n)} <span class="go">→</span></span><b>${stageTitle(n)}</b>${body}<span class="mono st-f">${foot}</span></a>`;
  const parts = [
    stage(1, grid(bits, "s-in"), `${bits.reduce((a, b) => a + b, 0)}/64 on`),
    ...st.layers.slice(0, -1).map((l, i) => stage(i + 2, grid(l), `${on(l)}/${sizes[i]} fired`)),
    stage(st.layers.length + 1, `<div class="vote">
        <div><span class="mono">human</span>${grid(last.slice(0, GROUP), "s-vote")}<b>${st.human}</b></div>
        <div><span class="mono">bot</span>${grid(last.slice(GROUP), "s-vote bot")}<b>${st.bot}</b></div></div>`,
      `${st.bot} − ${st.human} = ${signed(st.margin)}`),
    stage(st.layers.length + 2, `<div class="st-verdict ${st.verdict ? "flag" : ""}"><span class="dot"></span>${st.verdict ? "Flagged" : "Passed"}</div>`, "bot > human"),
  ];
  return `<div class="card"><h2>Filter stages <span class="count mono">tap a stage</span></h2><div class="stages" data-lenis-prevent>${parts.join('<span class="arrow mono" aria-hidden="true">→</span>')}</div></div>`;
}

// ------------------------------------------------------------------ feature detail

async function featurePage() {
  const f = params.get("f") ?? "";
  const slot = SLOTS.find(s => featParam(s) === f);
  shell(slot ? slotLabel(slot) : "Unknown input");
  const el = $("page");
  if (!slot) {
    el.innerHTML = `<div class="card"><p class="now">There is no input called “${esc(f)}”.</p><div class="dl mono">${SLOTS.map(s =>
      `<a href="feature.html?f=${featParam(s)}${wallet() ? `&w=${encodeURIComponent(wallet())}` : ""}">${esc(slotLabel(s))}</a>`).join("")}</div></div>`;
    return;
  }
  const load = async () => {
    el.innerHTML = `<div class="skeleton"><i></i><i></i></div>`;
    try {
      const r = await lookup(wallet());
      if (r === "stale") return;
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
            <span class="mono lvl">${esc(rangeOf(w.L))}</span><span class="dot"></span><b>${w.verdict ? "Flagged" : "Passed"}</b><span class="mono m">${signed(w.margin)}</span></div>`).join("")}</div>
        </div>
        <div class="card">
          <h2>Labelled wallets <span class="count mono">${botN} bots · ${humN} humans</span></h2>
          <div class="dist">${Array.from({ length: levels }, (_, L) => `<div class="dl-col ${L === cur ? "cur" : ""}">
            <div class="bars2"><i class="b" style="height:${(st.bot[L] / botN / maxShare * 100).toFixed(1)}%" title="bots ${st.bot[L]}"></i><i class="h" style="height:${(st.human[L] / humN / maxShare * 100).toFixed(1)}%" title="humans ${st.human[L]}"></i></div>
            <span class="mono">${esc(rangeOf(L))}</span></div>`).join("")}</div>
          <div class="legend mono"><span><i class="b"></i>bots</span><span><i class="h"></i>humans</span><span>share of each class</span></div>
        </div>
        <div class="card"><h2>Wiring</h2><div class="facts mono"><span>${st.readers} first-stage gates read this</span><span>bits ${slot.start}–${slot.start + slot.count - 1}</span></div></div>`;
      await cardWarning(el);
    } catch (e) { fail(el, e, load); }
  };
  load();
}

// ------------------------------------------------------------------ check

function checkPage() {
  shell("Check");
  $("page").innerHTML = `
    <form id="f" class="row" role="search">
      <label class="sr-only" for="w">Wallet address</label>
      <input id="w" class="mono" placeholder="0x… wallet" autocomplete="off" spellcheck="false" value="${esc(wallet())}" />
      <button class="btn-dark mono">Check</button>
    </form>
    <div id="samples" class="samples mono" aria-label="Sample wallets"></div>
    <div id="out" class="out" aria-live="polite"></div>`;
  const out = $("out");
  const go = async (w: string) => {
    out.innerHTML = `<div class="skeleton" aria-label="Checking"><i></i><i></i><i></i></div>`;
    try {
      const r = await lookup(w);
      if (r === "stale") return;
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
            <span class="ok" title="${esc(r.root)}">Proof matches the ${r.rootSource === "on chain" ? "root on chain" : "published root"}</span>
            <span class="${agree ? "ok" : "warn"}">${agree ? "Browser re-run agrees" : "Browser re-run disagrees"}</span>
            <span>${LIVE ? "verdict from eth_call" : "demo: verdict computed in your browser"}</span>
          </div>
        </div>
        ${stagesCard(r.bits, r.wallet)}
        <div class="card">
          <h2>64 inputs <span class="count mono">tap a row</span></h2>
          ${inputRows(r.bits, r.wallet)}
          <div class="hex"><code class="mono">${r.bitsHex}</code><button class="ghost" id="copy" type="button">Copy</button></div>
        </div>`;
      copyButton($<HTMLButtonElement>("copy"), () => r.bitsHex);
    } catch (e) { fail(out, e, () => go(w)); }
  };
  $("f").addEventListener("submit", e => { e.preventDefault(); go($<HTMLInputElement>("w").value.trim()); });
  $("w").addEventListener("input", () => { const v = $<HTMLInputElement>("w").value.trim(); if (/^0x[0-9a-fA-F]{2}/.test(v)) shardOf(v).catch(() => {}); });
  loadNet().catch(() => {});   // warm the circuit while the page is idle
  sampleWallets().then(ws => {
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
  const load = async () => {
    el.innerHTML = `<div class="skeleton"><i></i><i></i></div>`;
    try {
      const r = await lookup(wallet());
      if (r === "stale") return;
      if (!r || r.status !== "ok") return needWallet(el);
      const net = await loadNet(), fl = flips(net, r.bits);
      el.innerHTML = `
        <div class="card"><div class="verdict">${pill(r)}<span class="mono muted">${short(r.wallet)}</span></div>${marginBar(r.margin, r.verdict)}</div>
        <div class="card">
          <h2>Flips the result <span class="count mono">one input changed</span></h2>
          ${fl.length ? `<ul class="reasons">${fl.map(c => `<li><span>${esc(c.from)}</span><span class="arrow" aria-label="to">→</span><span class="to">${esc(c.to)}</span></li>`).join("")}</ul>`
            : `<p class="muted">No single input change flips this result.</p>`}
        </div>
        <div class="card">
          <h2>Read</h2>
          <div class="tbl-wrap"><table><tbody>${readings(r.bits).map(x => `<tr><td>${esc(x.text)}</td><td class="mono muted">${x.bits.join("")}</td></tr>`).join("")}</tbody></table></div>
        </div>
        <div class="card">
          <h2>Gates <span class="count mono" id="gcount">…</span></h2>
          <div class="gatemap" id="gmap" role="img" aria-label="Every NAND gate; deciding gates highlighted"><div class="skeleton"><i></i><i></i></div></div>
        </div>`;
      // the gate map is the heaviest part: paint the page first, then fill it in
      requestAnimationFrame(() => setTimeout(() => {
        const dgs = new Set(decidingGates(net, r.bits));
        $("gcount").textContent = `${dgs.size} / ${net.a.length} deciding`;
        $("gmap").innerHTML = Array.from(net.a, (_, g) => `<i class="${dgs.has(g) ? "d" : ""}" title="gate ${g}"></i>`).join("");
      }, 0));
      await cardWarning(el);
    } catch (e) { fail(el, e, load); }
  };
  load();
}

// ------------------------------------------------------------------ audit

async function auditPage() {
  shell("Audit");
  const el = $("page");
  el.innerHTML = `<div id="a"><div class="skeleton"><i></i><i></i></div></div>
    <div class="row"><button id="run" class="btn-dark mono" type="button">${LIVE ? "Run an audit round (2 transactions)" : "Run a demo round"}</button></div>
    <pre id="log" class="log mono" hidden aria-live="polite"></pre>`;
  const render = async () => {
    try {
      const a = await auditInfo();
      const done = a.rounds.filter(r => r.status === "done"), expired = a.rounds.filter(r => r.status === "expired").length;
      const c = done.reduce((s, r) => s + r.correct, 0), t = done.reduce((s, r) => s + r.total, 0);
      const open = a.rounds.find(r => r.id === a.openRound && (r.status === "pending" || r.status === "ready"));
      // an expired round counts as 0 right: nobody can bury a bad draw by letting it lapse
      const strict = t + expired * a.k ? c / (t + expired * a.k) : 0;
      $("a").innerHTML = `
        <div class="stats">
          <div><span class="k mono">Score</span><span class="v">${t ? pct(c / t, 0) : "–"}</span><span class="s mono">${t ? `${c}/${t} in ${done.length} round${done.length === 1 ? "" : "s"}` : "no rounds yet"}</span></div>
          <div><span class="k mono">Counting expired</span><span class="v">${t || expired ? pct(strict, 0) : "–"}</span><span class="s mono">expired = 0/${a.k}</span></div>
          <div><span class="k mono">Expired</span><span class="v ${expired ? "warn" : ""}">${expired}</span><span class="s mono">never sealed</span></div>
          <div><span class="k mono">Test set</span><span class="v">${a.testSize}</span><span class="s mono" title="${esc(a.testRoot)}">${short(a.testRoot, 4)}</span></div>
        </div>
        <div class="facts mono">
          <span class="${a.leavesMatch ? "ok" : "warn"}">${a.leavesMatch ? "Published rows rebuild the committed root" : "Published rows don't match the committed root"}</span>
          ${LIVE ? `<span class="${a.bound && !a.invalid ? "ok" : "warn"}">${a.invalid ? "Campaign invalidated" : a.bound ? "Campaign bound" : "Not bound"}</span>` : `<span>demo: rounds run in your browser and last for this tab</span>`}
          ${open ? `<span class="warn">Round #${open.id} is open: the button finalizes it</span>` : ""}
        </div>
        ${a.rounds.length ? `<div class="card"><div class="tbl-wrap"><table><thead><tr><th>Round</th><th>Status</th><th>Score</th>${LIVE ? "<th>Requested by</th>" : ""}</tr></thead><tbody>${a.rounds.map(r =>
          `<tr><td class="mono">#${r.id}</td><td class="${r.status === "expired" ? "warn" : ""}">${r.status}</td><td>${r.status === "done" ? `${r.correct}/${r.total}` : r.status === "expired" ? `0/${a.k}` : "–"}</td>${LIVE ? `<td class="mono">${r.requester ? short(r.requester, 4) : ""}</td>` : ""}</tr>`).join("")}</tbody></table></div></div>` : ""}`;
    } catch (e) { fail($("a"), e, render); }
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
    <p class="muted">Appeals are public: they open as an issue on the project's GitHub with the wallet and the exact bits the circuit was given, and are answered there.</p>
    <form id="f" class="stack-form" novalidate>
      <label><span class="mono">Wallet</span><input id="aw" class="mono" spellcheck="false" placeholder="0x…" required /></label>
      <label><span class="mono">Bits</span><input id="ab" class="mono" spellcheck="false" placeholder="0x + 16 hex digits" required /></label>
      <label><span class="mono">What's wrong</span><textarea id="an" rows="3" maxlength="600" required></textarea></label>
      <div class="row"><button class="btn-dark mono">Prepare appeal</button></div>
    </form>
    <div id="out" class="out" aria-live="polite"></div>`;
  try {
    const r = await lookup(wallet());
    if (r && r !== "stale" && r.status === "ok") { $<HTMLInputElement>("aw").value = r.wallet; $<HTMLInputElement>("ab").value = r.bitsHex; }
  } catch { /* the form still works without a prefill */ }
  $("f").addEventListener("submit", async e => {
    e.preventDefault();
    const out = $("out"), w = checksum($<HTMLInputElement>("aw").value), bits = $<HTMLInputElement>("ab").value.trim().toLowerCase();
    const note = $<HTMLTextAreaElement>("an").value.trim();
    const errs = [!w && "Enter a valid wallet address.", !/^0x[0-9a-f]{16}$/.test(bits) && "Bits must be 0x followed by 16 hex digits (shown on the Check page).",
      !note && "Say briefly what you think is wrong."].filter(Boolean) as string[];
    if (errs.length) return void (out.innerHTML = `<div class="card warn" role="alert">${errs.map(x => `<p>${esc(x)}</p>`).join("")}</div>`);
    let inSnap = "not checked";
    try {
      const [idx, sh] = await Promise.all([snapshotIndex(), shardOf(w!)]), en = sh.wallets[w!.toLowerCase()];
      inSnap = !en ? "not in the snapshot" : en.bits.toLowerCase() === bits && inSnapshot(w!, en, idx.root, idx.depth, idx.count) ? "matches the snapshot" : "differs from the snapshot";
    } catch { /* still allow the appeal */ }
    const title = `Appeal: ${w}`;
    const body = `**Cusity appeal**\n\n- campaign: #${CONFIG.campaignId}\n- wallet: \`${w}\`\n- bits: \`${bits}\` (${inSnap})\n- model: ${card.name} (\`${card.netlistSha256}\`)\n\n**What's wrong**\n\n${note}\n`;
    const url = `${CONFIG.appealsUrl}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}&labels=appeal`;
    out.innerHTML = `<div class="card"><div class="msg mono" id="m"></div>
      <div class="row" style="margin-top:12px"><a class="btn-dark mono" href="${esc(url)}" target="_blank" rel="noopener">Open public appeal →</a><button class="ghost" type="button" id="cp">Copy text</button></div>
      <p class="muted small">Needs a GitHub account. No account? Copy the text and post it in the project's channel.</p></div>`;
    $("m").textContent = body;   // user text goes in as text, never HTML
    copyButton($<HTMLButtonElement>("cp"), () => body);
  });
}

// ------------------------------------------------------------------ stage detail

const FEATURE_OF_BIT = (bit: number) => SLOTS.find(s => bit >= s.start && bit < s.start + s.count)!;

async function stagePage() {
  const nS = NSTAGES(), raw = Number(params.get("s"));
  const sIdx = Number.isInteger(raw) && raw >= 1 && raw <= nS ? raw : 1;
  const sizes = layerSizes(), nL = sizes.length;
  shell(`Stage ${pad2(sIdx)} · ${stageTitle(sIdx)}`);
  const el = $("page");
  const load = async () => {
    el.innerHTML = `<div class="skeleton"><i></i><i></i></div>`;
    try {
      const r = await lookup(wallet());
      if (r === "stale") return;
      if (!r || r.status !== "ok") return needWallet(el);
      const st = runStages(r.bits), w = r.wallet, q = (s: number) => `stage.html?s=${s}&w=${encodeURIComponent(w)}`;
      const nav = `<nav class="stage-nav mono" aria-label="Stages">${sIdx > 1 ? `<a href="${q(sIdx - 1)}">← Stage ${pad2(sIdx - 1)}</a>` : "<span></span>"}
        <a href="${link("check", w)}">All stages</a>
        ${sIdx < nS ? `<a href="${q(sIdx + 1)}">Stage ${pad2(sIdx + 1)} →</a>` : "<span></span>"}</nav>`;
      const head = `<div class="card"><div class="verdict">${pill(r)}<span class="mono muted">${short(w)}</span></div>${nav}</div>`;

      if (sIdx === 1) {
        const on = r.bits.reduce((a, b) => a + b, 0);
        el.innerHTML = head + `
          <div class="stats"><div><span class="k mono">Bits</span><span class="v">64</span><span class="s mono">inputs</span></div>
            <div><span class="k mono">On</span><span class="v">${on}</span><span class="s mono">${(on / 64 * 100).toFixed(0)}%</span></div>
            <div><span class="k mono">Features</span><span class="v">${FEATURES.length}</span><span class="s mono">+ ${FLAGS.length} flags</span></div>
            <div><span class="k mono">Packed</span><span class="v small-v mono">${r.bitsHex.slice(0, 10)}…</span><span class="s mono">8 bytes, LSB first</span></div></div>
          <div class="card"><h2>Inputs <span class="count mono">tap a row</span></h2>${inputRows(r.bits, w)}</div>`;
      } else if (sIdx <= nL + 1) {
        const li = sIdx - 2, layer = st.layers[li], live = liveNeurons()[li], { delta, flips: dec } = neuronEffects(r.bits, li);
        const fired = layer.reduce((a, b) => a + b, 0), ops = opsOf(li, live);
        const opRows = ops.map((n, o) => ({ n, o })).filter(x => x.n).sort((a, b) => b.n - a.n);
        const ranked = Array.from(delta, (d, j) => ({ j, d })).filter(x => x.d !== 0).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
        const top = ranked.slice(0, 12), maxD = Math.max(1, ...top.map(x => Math.abs(x.d)));
        const isVote = sIdx === nL + 1;
        const grid = (from: number, to: number) => `<div class="ngrid">${Array.from({ length: to - from }, (_, k) => {
          const j = from + k; return `<i class="${layer[j] ? "on" : ""} ${dec.has(j) ? "d" : ""} ${live.has(j) ? "" : "dead"}" title="neuron ${j}${delta[j] ? ` · moves the margin ${signed(delta[j])}` : ""}${dec.has(j) ? " · flips the verdict" : ""}${live.has(j) ? "" : " · pruned"}"></i>`; }).join("")}</div>`;
        // the inputs behind the most influential neurons, weighted by how far each moves the margin
        const weights = new Map<number, number>();
        for (const x of top) for (const [bit, n] of inputsOf(li, [x.j])) weights.set(bit, (weights.get(bit) ?? 0) + n * Math.abs(x.d));
        const per = new Map<string, { slot: Slot; n: number }>();
        for (const [bit, n] of weights) { const s = FEATURE_OF_BIT(bit), k = featParam(s); const e = per.get(k) ?? { slot: s, n: 0 }; e.n += n; per.set(k, e); }
        const drivers = [...per.values()].sort((a, b) => b.n - a.n), maxN = Math.max(1, ...drivers.map(x => x.n));
        el.innerHTML = head + `
          <div class="stats">
            <div><span class="k mono">${isVote ? "Voters" : "Neurons"}</span><span class="v">${sizes[li]}</span><span class="s mono">${live.size} live</span></div>
            <div><span class="k mono">Fired</span><span class="v">${fired}</span><span class="s mono">${(fired / sizes[li] * 100).toFixed(0)}%</span></div>
            <div><span class="k mono">Influential</span><span class="v">${ranked.length}</span><span class="s mono">${dec.size} flip the verdict alone</span></div>
            <div><span class="k mono">${isVote ? "Margin" : "Reads"}</span><span class="v">${isVote ? signed(st.margin) : (li === 0 ? 64 : sizes[li - 1])}</span><span class="s mono">${isVote ? `${st.bot} bot − ${st.human} human` : "from previous stage"}</span></div>
          </div>
          ${isVote ? `<div class="card"><h2>The vote</h2><div class="votes">
              <div><span class="mono">human · ${st.human}</span>${grid(0, GROUP)}</div>
              <div><span class="mono">bot · ${st.bot}</span>${grid(GROUP, 2 * GROUP)}</div></div>
              <div class="legend mono"><span><i class="on"></i>fired</span><span><i class="d"></i>flips the verdict</span></div></div>`
            : `<div class="card"><h2>Neurons <span class="count mono">${fired} fired · ${sizes[li] - live.size} pruned</span></h2>${grid(0, sizes[li])}
              <div class="legend mono"><span><i class="on"></i>fired</span><span><i class="d"></i>flips the verdict</span><span><i class="dead"></i>pruned</span></div></div>`}
          <div class="card"><h2>Most influential <span class="count mono">flip one neuron: how far the margin moves</span></h2>
            ${top.length ? `<div class="ops">${top.map(x => `<div class="op infl ${x.d > 0 ? "bot" : "hum"}"><span class="mono">#${x.j}${dec.has(x.j) ? " ★" : ""}</span><i style="width:${(Math.abs(x.d) / maxD * 100).toFixed(0)}%"></i><span class="mono">${signed(x.d)} → ${x.d > 0 ? "bot" : "human"}</span></div>`).join("")}</div>
              <p class="muted mono small">★ flips the verdict on its own · ${ranked.length} of ${live.size} live neurons move this wallet's margin</p>`
              : `<p class="muted">No neuron in this stage moves this wallet's margin.</p>`}</div>
          <div class="card"><h2>Driven by <span class="count mono">inputs behind the influential neurons</span></h2>
            ${drivers.length ? `<div class="drivers">${drivers.map(x => `<a class="drv" href="feature.html?f=${featParam(x.slot)}&w=${encodeURIComponent(w)}">
              <span>${esc(slotLabel(x.slot))}</span><i style="width:${(x.n / maxN * 100).toFixed(0)}%"></i><span class="mono">${(x.n / maxN * 100).toFixed(0)}</span></a>`).join("")}</div>`
              : `<p class="muted">Nothing upstream moves this stage for this wallet.</p>`}</div>
          <div class="card"><h2>Logic used <span class="count mono">live neurons</span></h2><div class="ops">${opRows.map(x =>
            `<div class="op"><span class="mono">${OP_NAMES[x.o]}</span><i style="width:${(x.n / opRows[0].n * 100).toFixed(0)}%"></i><span class="mono">${x.n}</span></div>`).join("")}</div></div>`;
      } else {
        el.innerHTML = head + `
          <div class="card"><div class="final ${st.verdict ? "flag" : ""}"><span class="dot"></span><div><b>${st.verdict ? "Flagged" : "Passed"}</b>
            <span class="mono">${st.bot} bot votes ${st.verdict ? ">" : "≤"} ${st.human} human votes · margin ${signed(st.margin)}</span></div></div>
            ${marginBar(st.margin, st.verdict)}
            <p class="muted small">A tie goes to human. The same rule runs on chain: output bit 0 is the verdict, bits 1–6 the margin + 32.</p></div>
          <div class="card"><h2>Next</h2><div class="dl mono">
            <a href="${link("explain", w)}">Why</a><a href="${link("cluster", w)}">Cluster</a><a href="${link("appeal", w)}">Appeal</a></div></div>`;
      }
      await cardWarning(el);
    } catch (e) { fail(el, e, load); }
  };
  load();
}

// ------------------------------------------------------------------ cluster

async function clusterPage() {
  shell("Cluster");
  const el = $("page");
  const load = async () => {
    el.innerHTML = `<div class="skeleton"><i></i><i></i></div>`;
    try {
      const gi: GIndex = await graphIndex(), w = wallet().toLowerCase();
      const cid = w && Object.hasOwn(gi.wallets, w) ? gi.wallets[w] : undefined;
      const ev = gi.evidence;
      const list = `<div class="card"><h2>Largest clusters <span class="count mono">${gi.clusters.length} found · hubs excluded</span></h2>
        <div class="tbl-wrap"><table><thead><tr><th>#</th><th>Wallets</th><th>Labelled bots</th><th>Flagged</th><th>Funded in 24 h</th></tr></thead><tbody>${gi.clusters.slice(0, 12).map(c =>
          `<tr><td class="mono"><a href="cluster.html?c=${c.id}">#${c.id}</a></td><td>${c.size}</td><td>${c.bots}</td><td>${c.flagged}</td><td>${c.window24h}</td></tr>`).join("")}</tbody></table></div>
        ${ev ? `<p class="muted small">Labelled bots: ${pct(ev.inCluster.botRate)} of clustered wallets (95% CI ${pct(ev.inCluster.ci95[0])}–${pct(ev.inCluster.ci95[1])}) vs ${pct(ev.notClustered.botRate)} of the rest (${pct(ev.notClustered.ci95[0])}–${pct(ev.notClustered.ci95[1])}).</p>` : ""}</div>`;
      const cParam = params.get("c");
      let show: number | undefined = cid;
      if (cParam !== null) {
        const n = Number(cParam);
        if (cParam === "" || !Number.isInteger(n) || n < 0 || n >= gi.clusters.length) {
          el.innerHTML = `<div class="card warn">There is no cluster “${esc(cParam)}”.</div>` + list; return;
        }
        show = n;
      }
      if (show === undefined) {
        el.innerHTML = (w ? `<div class="card"><p class="now">This wallet shares no funder, collection address or direct transfers with other labelled wallets.</p></div>` : "") + list;
        return;
      }
      const c = await clusterById(show), s = c.stats;
      el.innerHTML = `
        <div class="stats">
          <div><span class="k mono">Wallets</span><span class="v">${s.size}</span><span class="s mono">cluster #${s.id}</span></div>
          <div><span class="k mono">Flagged</span><span class="v">${s.flagged}</span><span class="s mono">by the circuit</span></div>
          <div><span class="k mono">Labelled bots</span><span class="v">${s.bots}</span><span class="s mono">from Sybil lists</span></div>
          <div><span class="k mono">Funded in 24 h</span><span class="v">${s.window24h}</span><span class="s mono">of ${s.size} wallets</span></div>
        </div>
        <div class="card"><h2>Map <span class="count mono">${s.funders} funders · ${s.collectors} collectors · ${s.direct} direct links · drag, zoom, tap</span></h2>
          <div id="graph" class="graph-host"><div class="skeleton"><i></i><i></i></div></div>
          <div class="legend mono"><span><i class="lg-flag"></i>flagged</span><span><i class="lg-pass"></i>passed</span><span><i class="lg-funder"></i>shared funder</span><span><i class="lg-coll"></i>shared collector</span><span><i class="lg-lbl"></i>on a Sybil list</span>
            <span><i class="lg-e funds"></i>funds →</span><span><i class="lg-e sweeps"></i>sends to →</span><span><i class="lg-e direct"></i>direct</span></div>
          <div id="gsel" class="gsel-host" aria-live="polite"></div></div>
        <div class="card"><h2>Members</h2><div class="tbl-wrap"><table><thead><tr><th>Wallet</th><th>List</th><th>Verdict</th><th>Margin</th></tr></thead><tbody>${c.nodes.filter(n => n.kind === "wallet").map(n =>
          `<tr class="${n.id === w ? "me" : ""}"><td class="mono"><a href="${link("check", n.id)}">${short(n.id, 4)}</a></td><td class="mono">${esc(n.src ?? "")}</td><td class="${n.v ? "warn" : ""}">${n.v ? "Flagged" : "Passed"}</td><td class="mono">${signed(n.m ?? 0)}</td></tr>`).join("")}</tbody></table></div></div>` + list;
      const { mountGraph } = await import("./graph");
      mountGraph($("graph"), c, w, x => link("check", x), html => ($("gsel").innerHTML = html));
    } catch (e) { fail(el, e, load); }
  };
  load();
}

// ------------------------------------------------------------------ campaign

const STEPS = ["Test set committed", "Filter hash committed", "Snapshot", "Wallet bits published", "Taped out + bound", "Audits"];
type StepState = { done: boolean | null; value: string; note: string };   // done: true on chain, false not yet, null demo

/** Each step's state: read from chain in live mode; in demo mode only the snapshot block (a fact of X Layer). */
async function campaignState(): Promise<StepState[]> {
  const idx = await snapshotIndex();
  const base: StepState[] = [
    { done: null, value: card.testRoot, note: `${card.testSize} rows` },
    { done: null, value: card.netlistSha256, note: "before the snapshot" },
    { done: true, value: idx.block.toLocaleString("en-US"), note: "block" },
    { done: null, value: idx.root, note: "Merkle root" },
    { done: null, value: "", note: "circuit" },
    { done: null, value: "", note: "see Audit" },
  ];
  if (!LIVE) return base;
  const L = await live(), c = await L.readCampaign(), head = await L.client.getBlockNumber();
  base[1] = { done: c.commitBlock > 0n && c.netlistHash.toLowerCase() === card.netlistSha256.toLowerCase(), value: c.netlistHash, note: `block ${c.commitBlock}` };
  base[2] = { done: head > c.snapshotBlock, value: c.snapshotBlock.toLocaleString("en-US"), note: "block" };
  base[3] = { done: c.vectorsRoot !== `0x${"0".repeat(64)}` && c.vectorsRoot.toLowerCase() === idx.root.toLowerCase(), value: c.vectorsRoot, note: `${c.vectorsCount} wallets` };
  base[4] = { done: c.bound && !c.invalid, value: c.bound ? `model #${c.modelId}` : "", note: c.invalid ? "INVALIDATED" : "circuit" };
  if (c.bound) {
    const a = await L.auditState();
    base[0] = { done: a.testRoot.toLowerCase() === card.testRoot.toLowerCase(), value: a.testRoot, note: `${a.testSize} rows` };
    base[5] = { done: a.rounds.some(r => r.status === "done"), value: `${a.rounds.filter(r => r.status === "done").length} rounds`, note: "see Audit" };
  } else { base[0].done = false; base[5].done = false; }
  return base;
}
const stateLabel = (d: boolean | null) => d === null ? "not on chain yet" : d ? "on chain" : "pending";

async function campaignPage() {
  shell("Campaign");
  const el = $("page");
  const load = async () => {
    el.innerHTML = `<div class="skeleton"><i></i><i></i></div>`;
    try {
      const steps = await campaignState();
      el.innerHTML = `${LIVE ? "" : `<p class="muted small">Demo: nothing is committed on chain yet. Each step shows the value that will be committed, and its check.</p>`}
        <ol class="timeline">${steps.map((s, i) => `
          <li class="${s.done ? "done" : ""}" style="--i:${i}"><a class="tl-link" href="step.html?n=${i + 1}">
            <span class="tl-n mono">${pad2(i + 1)}</span>
            <div class="tl-body"><b>${STEPS[i]}</b><span class="mono muted">${esc(s.note)}</span></div>
            <span class="tl-val">${s.value ? `<code class="mono" title="${esc(s.value)}">${s.value.startsWith("0x") ? short(s.value, 6) : esc(s.value)}</code>` : ""}</span>
            <span class="tl-state mono">${stateLabel(s.done)}</span>
            <span class="go mono" aria-hidden="true">→</span>
          </a></li>`).join("")}</ol>`;
    } catch (e) { fail(el, e, load); }
  };
  load();
}

// ------------------------------------------------------------------ campaign step detail

type Check = { label: string; ok: boolean | null; detail: string };
const checksHtml = (cs: Check[]) => `<ul class="checks">${cs.map(c => `<li class="${c.ok === null ? "" : c.ok ? "c-ok" : "c-bad"}">
  <span class="mark mono" aria-label="${c.ok === null ? "info" : c.ok ? "pass" : "fail"}">${c.ok === null ? "·" : c.ok ? "✓" : "✗"}</span><span>${esc(c.label)}</span><span class="mono muted">${esc(c.detail)}</span></li>`).join("")}</ul>`;
const callCard = (fn: string, note: string) => `<div class="card"><h2>Contract call <span class="count mono">${esc(note)}</span></h2><pre class="call mono">${esc(fn)}</pre></div>`;
const tile = (k: string, v: string, sub: string) => `<div><span class="k mono">${k}</span><span class="v">${v}</span><span class="s mono">${sub}</span></div>`;
const dateOf = (t: number) => new Date(t * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";

/** Probability mass of Binomial(n, p). */
const binom = (n: number, p: number) => {
  const out: number[] = []; let c = 1;
  for (let k = 0; k <= n; k++) { out.push(c * p ** k * (1 - p) ** (n - k)); c = c * (n - k) / (k + 1); }
  return out;
};

async function stepPage() {
  const raw = Number(params.get("n")), n = Number.isInteger(raw) && raw >= 1 && raw <= 6 ? raw : 1;
  shell(`Step ${pad2(n)} · ${STEPS[n - 1]}`);
  const el = $("page");
  const verifyCard = (title: string, btn: string) => `<div class="card"><h2>${title}</h2><div id="vout" aria-live="polite">${checksHtml([])}</div>
    <button class="btn-dark mono" id="vbtn" type="button">${btn}</button></div>`;
  const runner = (fn: () => Promise<Check[]>) => {
    const b = $<HTMLButtonElement>("vbtn"), out = $("vout");
    b.onclick = async () => {
      b.disabled = true; b.textContent = "Checking…";
      try { out.innerHTML = checksHtml(await fn()); } catch (e) { out.innerHTML = checksHtml([{ label: "Check failed", ok: false, detail: String((e as Error).message ?? e) }]); }
      b.disabled = false; b.textContent = "Run again";
    };
  };
  const load = async () => {
    el.innerHTML = `<div class="skeleton"><i></i><i></i></div>`;
    try {
      const states = await campaignState(), sState = states[n - 1], idx = await snapshotIndex();
      const nav = `<nav class="stage-nav mono" aria-label="Steps">${n > 1 ? `<a href="step.html?n=${n - 1}">← Step ${pad2(n - 1)}</a>` : "<span></span>"}
        <a href="campaign.html">All steps</a>${n < 6 ? `<a href="step.html?n=${n + 1}">Step ${pad2(n + 1)} →</a>` : "<span></span>"}</nav>`;
      const head = `<div class="card"><div class="verdict"><span class="pill ${sState.done ? "live" : "pend"}"><span class="dot"></span>${stateLabel(sState.done)}</span>
        <span class="mono muted">campaign #${CONFIG.campaignId}</span></div>${nav}</div>`;

      if (n === 1) {
        const t = await testLeaves(), net = await loadNet();
        const bots = t.leaves.filter(l => l.label === 1).length;
        const rows = t.leaves.map(l => ({ ...l, v: decide(net, unpack(l.bits)).verdict }));
        const right = rows.filter(r => r.v === (r.label === 1)).length;
        el.innerHTML = head + `<div class="stats">${tile("Rows", String(t.size), "held out, scored once")}${tile("Bots", String(bots), pct(bots / t.size, 0))}
          ${tile("Humans", String(t.size - bots), pct((t.size - bots) / t.size, 0))}${tile("Circuit right", `${right}`, `${pct(right / t.size)} of rows`)}</div>
          <div class="card">${copyRow("Merkle root", t.root)}<div class="facts mono"><span>leaf i = keccak256(i ‖ wallet ‖ bits ‖ label)</span><span>positional, depth ${t.depth}</span>
            <span>frozen in git <a href="https://github.com/linoxbt/cusity/commit/${card.testCommittedInGit}" target="_blank" rel="noopener">${card.testCommittedInGit.slice(0, 7)}</a> before training</span></div></div>
          ${verifyCard("Verify", "Rebuild the root")}
          <div class="card"><h2>Rows <span class="count mono">first 24 of ${t.size}</span></h2>
            <div class="tbl-wrap"><table><thead><tr><th>#</th><th>Wallet</th><th>Bits</th><th>Label</th><th>Circuit</th><th></th></tr></thead><tbody>${rows.slice(0, 24).map(r => `<tr>
              <td class="mono">${r.index}</td><td class="mono"><a href="${link("check", r.wallet)}">${short(r.wallet, 4)}</a></td><td class="mono">${r.bits}</td><td>${r.label ? "bot" : "human"}</td>
              <td class="${r.v ? "flagtxt" : ""}">${r.v ? "Flagged" : "Passed"}</td><td class="mono">${r.v === (r.label === 1) ? "✓" : "✗"}</td></tr>`).join("")}</tbody></table></div>
            <p class="muted small">Each row names its wallet, so anyone can check the label against the public Hop and LayerZero lists and recompute the bits.</p></div>
          ${callCard(`AccuracyAudit.commitTestSet(\n  root  = ${t.root},\n  depth = ${t.depth},\n  size  = ${t.size}\n)`, "before the campaign")}`;
        runner(async () => {
          let leafOk = 0, proofOk = 0;
          for (const l of t.leaves) {
            const leaf = testLeaf(l.index, l.wallet, l.bits, l.label === 1);
            if (leaf === l.leaf) leafOk++;
            if (verify(l.proof, t.root, t.depth, l.index, leaf)) proofOk++;
          }
          const rebuilt = rebuildTestRoot(t);
          return [
            { label: "Leaves recomputed from rows", ok: leafOk === t.size, detail: `${leafOk}/${t.size}` },
            { label: "Every proof reaches the root at its own position", ok: proofOk === t.size, detail: `${proofOk}/${t.size}` },
            { label: "Whole tree rebuilt from the rows", ok: rebuilt.toLowerCase() === t.root.toLowerCase(), detail: short(rebuilt, 6) },
            { label: "Root matches the model card", ok: t.root.toLowerCase() === card.testRoot.toLowerCase(), detail: short(card.testRoot, 6) },
          ];
        });
      } else if (n === 2) {
        el.innerHTML = head + `<div class="stats">${tile("Gates", String(card.gates), "NAND")}${tile("Inputs", String(card.nIn), "bits")}
          ${tile("Outputs", String(card.nOut), "verdict + margin")}${tile("Snapshot", idx.block.toLocaleString("en-US"), "commit must come first")}</div>
          <div class="card">${copyRow("Netlist sha256", card.netlistSha256)}${copyRow("Extractor sha256", card.extractorSha256)}
            <div class="facts mono"><span>netlist = the circuit</span><span>extractor = the code + config that make the 64 bits</span></div></div>
          ${verifyCard("Verify", "Hash the published netlist")}
          <div class="card"><h2>Rules the contracts enforce</h2><div class="rules">
            <div><b>SnapshotPassed</b><span>commit after the snapshot block is refused</span></div>
            <div><b>NetlistMismatch</b><span>bind fails if the taped-out circuit has another hash</span></div>
            <div><b>ExtractorMismatch</b><span>the model must use the committed extractor</span></div>
            <div><b>NotATapeOutProcessor</b><span>only genuine TapeOut processors can host the circuit</span></div></div></div>
          ${callCard(`CampaignCommit.commit(\n  netlistHash   = ${card.netlistSha256},\n  extractorHash = ${card.extractorSha256},\n  snapshotBlock = <future block>\n)`, "before the snapshot")}`;
        runner(async () => {
          const nl = await (await fetch("./model/cusity.netlist.json", { cache: "no-cache" })).json() as { netlist: Hex };
          const bytes = new Uint8Array(nl.netlist.slice(2).match(/../g)!.map(h => parseInt(h, 16)));
          const h = "0x" + Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
          return [
            { label: "Netlist downloaded", ok: true, detail: `${bytes.length.toLocaleString("en-US")} bytes` },
            { label: "7 bytes per NAND gate", ok: bytes.length === card.gates * 7, detail: `${bytes.length / 7} gates` },
            { label: "sha256 matches the commitment", ok: h === card.netlistSha256.toLowerCase(), detail: short(h, 8) },
          ];
        });
      } else if (n === 3) {
        el.innerHTML = head + `<div class="stats">${tile("Block", idx.block.toLocaleString("en-US"), "X Layer")}${tile("Window", `${extCfg.windowDays} days`, "before the snapshot")}
          ${tile("OKB price", `$${extCfg.okbUsd}`, "frozen for USD features")}${tile("History", esc(extCfg.history), "backend, hashed")}</div>
          <div class="card"><h2>Window</h2><div class="window"><div><span class="mono muted">from</span><b id="w-from">${extCfg.windowDays} days before</b></div>
            <i></i><div><span class="mono muted">to</span><b id="w-to">the snapshot block</b></div></div>
            <p class="muted small">Relative to the snapshot, so every campaign uses the same extractor (and the same hash).</p></div>
          ${verifyCard("Verify on X Layer", "Read the block")}
          <div class="card"><h2>Frozen inputs</h2><div class="tbl-wrap"><table><tbody>
            <tr><td>USDT0</td><td class="mono">${short(extCfg.usdt0, 8)}</td></tr>
            <tr><td>Exchange list</td><td class="mono">${extCfg.exchanges.length ? `${extCfg.exchanges.length} addresses` : "none listed (exchange-scale funders are detected from their history)"}</td></tr>
            <tr><td>Extractor hash</td><td class="mono">${short(card.extractorSha256, 8)}</td></tr></tbody></table></div></div>`;
        runner(async () => {
          const { client } = await live(), blk = BigInt(idx.block);
          const [b, headBlk] = await Promise.all([client.getBlock({ blockNumber: blk }), client.getBlockNumber()]);
          $("w-from").textContent = dateOf(Number(b.timestamp) - extCfg.windowDays * 86400); $("w-to").textContent = dateOf(Number(b.timestamp));
          return [
            { label: "Block exists", ok: true, detail: short(b.hash!, 8) },
            { label: "Block time", ok: null, detail: dateOf(Number(b.timestamp)) },
            { label: "Activity window", ok: null, detail: `${dateOf(Number(b.timestamp) - extCfg.windowDays * 86400)} → ${dateOf(Number(b.timestamp))}` },
            { label: "Final (behind the chain head)", ok: headBlk > blk, detail: `${(headBlk - blk).toLocaleString("en-US")} blocks ago` },
          ];
        });
      } else if (n === 4) {
        const w0 = (wallet() || idx.samples[0]).toLowerCase();
        el.innerHTML = head + `<div class="stats">${tile("Wallets", idx.count.toLocaleString("en-US"), "64 bits each")}${tile("Depth", String(idx.depth), "positional tree")}
          ${tile("Block", idx.block.toLocaleString("en-US"), "snapshot")}${tile("Campaign", `#${idx.campaignId}`, "")}</div>
          <div class="card">${copyRow("Merkle root", idx.root)}${copyRow("Extractor sha256", idx.extractorHash)}
            <div class="facts mono"><span>leaf i = keccak256(i ‖ wallet ‖ bits)</span><span>wallets sorted by address</span><span>a duplicate can be proven on chain</span></div></div>
          ${verifyCard("Verify the whole snapshot", "Rebuild from list.json")}
          <div class="card"><h2>Verify one wallet</h2>
            <form class="row" id="pf"><label class="sr-only" for="pw">Wallet</label><input class="mono" id="pw" value="${esc(w0)}" spellcheck="false" /><button class="btn-dark mono">Prove</button></form>
            <div id="pout" aria-live="polite"></div><div id="ppath"></div></div>
          ${callCard(`CampaignCommit.publishVectors(\n  id    = ${CONFIG.campaignId},\n  root  = ${idx.root},\n  count = ${idx.count},\n  depth = ${idx.depth},\n  uri   = "<site>/snapshot/list.json"\n)`, "within 7 days of the snapshot")}`;
        runner(async () => {
          const l = await snapshotList();
          const sorted = l.list.every(([w], i) => i === 0 || w > l.list[i - 1][0]);
          const rebuilt = build(l.list.map(([w, b], i) => snapshotLeaf(i, w as Hex, b))).root;
          return [
            { label: "List downloaded", ok: true, detail: `${l.list.length.toLocaleString("en-US")} wallets` },
            { label: "Sorted, no wallet listed twice", ok: sorted, detail: sorted ? "strictly increasing" : "duplicate or out of order" },
            { label: "Count matches", ok: l.list.length === idx.count, detail: String(idx.count) },
            { label: "Root rebuilt from every wallet", ok: rebuilt.toLowerCase() === idx.root.toLowerCase(), detail: short(rebuilt, 6) },
          ];
        });
        const pout = $("pout"), ppath = $("ppath");
        $("pf").onsubmit = async e => {
          e.preventDefault();
          ppath.innerHTML = "";
          try {
            const w = checksum($<HTMLInputElement>("pw").value);
            if (!w) return void (pout.innerHTML = checksHtml([{ label: "Not an address", ok: false, detail: "" }]));
            const en = (await shardOf(w)).wallets[w.toLowerCase()];
            if (!en) return void (pout.innerHTML = checksHtml([{ label: "Not in this snapshot", ok: false, detail: short(w) }]));
            const leaf = snapshotLeaf(en.index, w, en.bits), path = [leaf];
            for (let k = 1; k <= en.proof.length; k++) path.push(rootFrom(leaf, en.index & ((1 << k) - 1), en.proof.slice(0, k)));
            pout.innerHTML = checksHtml([
              { label: "Position", ok: null, detail: `#${en.index}` }, { label: "Bits", ok: null, detail: en.bits },
              { label: `Proof (${en.proof.length} steps) reaches the root`, ok: inSnapshot(w, en, idx.root, idx.depth, idx.count), detail: short(path[path.length - 1], 8) },
            ]);
            ppath.innerHTML = `<ol class="path mono">${path.map((x, i) => `<li><span>${i === 0 ? "leaf" : i === path.length - 1 ? "root" : `step ${i}`}</span>${short(x, 10)}</li>`).join("")}</ol>
              <a class="btn-dark mono" href="${link("check", w)}">Open in Check →</a>`;
          } catch (er) { pout.innerHTML = checksHtml([{ label: "Couldn't check", ok: false, detail: String((er as Error).message ?? er) }]); }
        };
        $("pf").dispatchEvent(new Event("submit", { cancelable: true }));
      } else if (n === 5) {
        const g = card.gates, cost = (p: (typeof measured.processors)[number]) =>
          `${(g * (p.mintPerGateOkb + p.feePerGateOkb) + measured.tapeoutFeeOkb).toFixed(4).replace(/0+$/, "")} OKB${p.bem ? ` + ${p.bem} BEM` : ""}`;
        el.innerHTML = head + `<div class="stats">${tile("Transistors", String(g), "one per NAND gate")}${tile("Netlist", `${(g * 7).toLocaleString("en-US")} B`, "7 bytes per gate")}
          ${tile("Check gas", `${(measured.verdictOfGas / 1e6).toFixed(2)}M`, "verdictOf, free via eth_call")}${tile("Audit gas", `${(measured.finalizeAuditGasK16 / 1e6).toFixed(1)}M`, `K=16 · limit ${measured.blockGasLimit / 1e6}M`)}</div>
          <div class="card"><h2>Sequence</h2><ol class="seq">
            <li><b>Mint</b><span>${g} NAND transistors on the processor</span></li>
            <li><b>Tape out</b><span>upload exactly the hashed netlist, pay the fee</span></li>
            <li><b>Register</b><span>registry re-hashes the processor's bytes; only genuine TapeOut processors</span></li>
            <li><b>Bind</b><span>campaign → model once; hashes must match</span></li></ol></div>
          <div class="card"><h2>Processors <span class="count mono">all-in cost for ${g} gates · tested on a mainnet fork</span></h2>
            <div class="tbl-wrap"><table><thead><tr><th>Processor</th><th>Address</th><th>Cost</th><th></th></tr></thead><tbody>${measured.processors.map(p => `<tr>
              <td class="mono">${p.id}</td><td class="mono"><a href="${CONFIG.explorer}/address/${p.address}" target="_blank" rel="noopener">${short(p.address, 4)}</a></td><td>${cost(p)}</td><td class="mono muted">${esc(p.note)}</td></tr>`).join("")}</tbody></table></div></div>
          ${callCard(`forge script script/TapeOut.s.sol --account cusity --broadcast   # mint + tapeout\nCusityRegistry.register(processor, circuitId, extractorHash, testCommitId, cardURI)\nCampaignCommit.bind(${CONFIG.campaignId}, modelId)`, "needs a funded wallet")}`;
      } else {
        const K = CONFIG.auditK, p = card.test.accuracy, pm = binom(K, p), mx = Math.max(...pm);
        let lo = 0, acc = 0; while (acc + pm[lo] < 0.05) acc += pm[lo++];
        let hi = K; acc = 0; while (acc + pm[hi] < 0.05) acc += pm[hi--];
        el.innerHTML = head + `<div class="stats">${tile("Rows per round", String(K), "drawn by a future block hash")}${tile("Expected", `${(K * p).toFixed(1)}`, `of ${K} right`)}
          ${tile("90% range", `${lo}–${hi}`, "for an honest circuit")}${tile("Test set", String(card.testSize), "rows to draw from")}</div>
          <div class="card"><h2>What an honest score looks like <span class="count mono">test accuracy ${pct(p)} · Binomial(${K})</span></h2>
            <div class="binom" role="img" aria-label="Probability of each score from 0 to ${K}">${pm.map((v, k) => `<div class="${k >= lo && k <= hi ? "in" : ""}"><i style="height:${(v / mx * 100).toFixed(1)}%"></i><span class="mono">${k}</span></div>`).join("")}</div>
            <div class="legend mono"><span><i class="ink"></i>inside the 90% range</span><span>far below the range = the circuit doesn't match its claim</span></div></div>
          <div class="card"><h2>Round</h2><ol class="seq">
            <li><b>Request</b><span>anyone calls requestAudit(modelId); the requester is recorded</span></li>
            <li><b>Seal</b><span>anyone stores the next block's hash within 256 blocks</span></li>
            <li><b>Finalize</b><span>rows + proofs submitted; the circuit runs on chain</span></li>
            <li><b>Score</b><span>correct / ${K} saved; unsealed rounds count as 0</span></li></ol>
            <a class="btn-dark mono" href="${link("audit")}">Open Audit →</a></div>
          ${callCard(`AccuracyAudit.requestAudit(modelId)\nAccuracyAudit.seal(roundId)\nAccuracyAudit.finalizeAudit(roundId, rows, proofs)`, "permissionless")}`;
      }
      wireCopy();
    } catch (e) { fail(el, e, load); }
  };
  load();
}

// ------------------------------------------------------------------ model

function modelPage() {
  shell("Model");
  const t = card.test, src = t.by_source as Record<string, { n: number; flagged: number }>;
  const SRC: Record<string, string> = { "hop-sybil": "Hop Sybil list (bots)", "layerzero-sybil": "LayerZero Sybil list (bots)", "hop-user": "Hop bridge users (humans)" };
  $("page").innerHTML = `
    <div class="stats">
      ${tile("Balanced accuracy", pct(t.balanced_accuracy), `95% CI ${pct(t.balanced_accuracy_ci95[0], 0)}–${pct(t.balanced_accuracy_ci95[1], 0)}`)}
      ${tile("Humans flagged", pct(t.human_false_positive_rate), "false-positive rate")}
      ${tile("Bots caught", pct(t.bot_recall), `precision ${pct(t.bot_precision, 0)} here`)}
      ${tile("Gates", String(card.gates), "NAND")}
    </div>
    <div class="card">
      <h2>Held-out test <span class="count mono">${t.n} wallets · scored once</span></h2>
      <div class="tbl-wrap"><table><tbody>
        <tr><td>Accuracy</td><td class="mono">${pct(t.accuracy)}</td></tr>
        <tr><td>Bot precision if 10% of a campaign are bots</td><td class="mono">${pct(t.bot_precision_at_prevalence["10%"])}</td></tr>
        <tr><td>Bot precision if 30% are bots</td><td class="mono">${pct(t.bot_precision_at_prevalence["30%"])}</td></tr>
        <tr><td>Balanced accuracy on bit vectors never seen in training (${t.unseen_vectors.n} wallets)</td><td class="mono">${pct(t.unseen_vectors.balanced_accuracy)}</td></tr>
        ${Object.entries(src).map(([k, v]) => `<tr><td>Flagged: ${esc(SRC[k] ?? k)} (${v.n})</td><td class="mono">${pct(v.flagged)}</td></tr>`).join("")}
      </tbody></table></div>
      <p class="muted small">${esc(card.selection)}. The test set was frozen in git commit <a href="https://github.com/linoxbt/cusity/commit/${card.testCommittedInGit}" target="_blank" rel="noopener">${card.testCommittedInGit.slice(0, 7)}</a> before training.</p>
    </div>
    <div class="card">
      <h2>Identity</h2>
      ${copyRow("Netlist sha256", card.netlistSha256)}
      ${copyRow("Extractor sha256", card.extractorSha256)}
      ${copyRow("Test-set root", card.testRoot)}
    </div>
    <div class="card">
      <h2>Architecture</h2>
      <div class="facts mono"><span>difflogic</span><span>64 → ${card.architecture.widths.join(" → ")} → ${card.architecture.group * 2}</span><span>verdict + 6-bit margin</span></div>
    </div>
    <div class="card"><h2>Limits</h2><p>${esc(card.limits)}</p></div>
    <div class="card">
      <h2>Download</h2>
      <div class="dl mono">
        <a href="./model/cusity.netlist.json" download>netlist.json</a>
        <a href="./model/cusity.v" download>cusity.v</a>
        <a href="./model/model_card.json" download>model_card.json</a>
        <a href="./test_leaves.json" download>test_leaves.json</a>
        <a href="./snapshot/list.json" download>snapshot list.json</a>
      </div>
    </div>`;
  wireCopy();
}

const PAGE_FN: Record<Page, () => unknown> = { check: checkPage, explain: explainPage, audit: auditPage, appeal: appealPage, campaign: campaignPage,
  model: modelPage, feature: featurePage, stage: stagePage, cluster: clusterPage, step: stepPage };
(PAGE_FN[page] ?? checkPage)();
startMotion();
