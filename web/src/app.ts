// The app: six independent pages (check, explain, audit, appeal, campaign, model) sharing one shell.
// The last checked wallet carries across pages (sessionStorage), and ?w=0x… makes any page shareable.
import "./style.css";
import { CONFIG, LIVE } from "./config";
import { auditInfo, checkWallet, loadNet, runAudit, sampleWallets, shard, snapshotIndex, type CheckResult } from "./chain";
import { decidingGates, flips, readings } from "./explain";
import { $, bitsGrid, esc, marginBar, short } from "./ui";
import { startMotion } from "./motion";
import card from "../public/model/model_card.json";
import fstats from "../public/model/feature_stats.json";
import { runStages, layerSizes, GROUP } from "./stages";
import { decide } from "./tap02";
import { SLOTS, levelOf, withLevel, describeLevel, type Slot } from "../../data/features";

type Page = "check" | "explain" | "audit" | "appeal" | "campaign" | "model" | "feature";
type Ok = Extract<CheckResult, { status: "ok" }>;
const PAGES: [Page, string][] = [["check", "Check"], ["explain", "Explain"], ["audit", "Audit"], ["appeal", "Appeal"], ["campaign", "Campaign"], ["model", "Model"]];
const page = (document.body.dataset.page ?? "check") as Page;
const KEY = "cusity:wallet";

const wallet = () => new URLSearchParams(location.search).get("w") ?? sessionStorage.getItem(KEY) ?? "";
const remember = (w: string) => sessionStorage.setItem(KEY, w);
const link = (p: Page, w = wallet()) => `${p}.html${w ? `?w=${encodeURIComponent(w)}` : ""}`;

// ------------------------------------------------------------------ shell

function shell(title: string) {
  const nav = PAGES.map(([p, label], i) =>
    `<a href="${link(p)}" class="${p === page || (page === "feature" && p === "check") ? "on" : ""}"><span>0${i + 1}</span>${label}</a>`).join("");
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
  const stage = (n: string, title: string, body: string, foot: string) =>
    `<div class="stage"><span class="mono st-n">${n}</span><b>${title}</b>${body}<span class="mono st-f">${foot}</span></div>`;
  const parts = [
    stage("01", "Read", grid(bits, "s-in"), `${bits.reduce((a, b) => a + b, 0)}/64 on`),
    ...st.layers.slice(0, -1).map((l, i) => stage(`0${i + 2}`, `Layer ${i + 1}`, grid(l), `${on(l)}/${sizes[i]} fired`)),
    stage(`0${st.layers.length + 1}`, "Vote", `<div class="vote">
        <div><span class="mono">human</span>${grid(last.slice(0, GROUP), "s-vote")}<b>${st.human}</b></div>
        <div><span class="mono">bot</span>${grid(last.slice(GROUP), "s-vote bot")}<b>${st.bot}</b></div></div>`,
      `${st.bot} − ${st.human} = ${st.margin > 0 ? "+" : ""}${st.margin}`),
    stage(`0${st.layers.length + 2}`, "Verdict", `<div class="st-verdict ${st.verdict ? "flag" : ""}"><span class="dot"></span>${st.verdict ? "Flagged" : "Passed"}</div>`, "bot > human"),
  ];
  return `<div class="card"><h2>Filter stages <span class="count mono">scroll →</span></h2><div class="stages">${parts.join('<span class="arrow mono">→</span>')}</div></div>`;
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
            <span class="actions"><a href="${link("explain", r.wallet)}">Why →</a><a href="${link("appeal", r.wallet)}">Appeal →</a></span></div>
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
      <li class="${done ? "done" : ""}" style="--i:${i}">
        <span class="tl-n mono">0${i + 1}</span>
        <div class="tl-body"><b>${l}</b><span class="mono muted">${n}</span></div>
        <span class="tl-val">${v && v.startsWith("0x") ? `<code class="mono" title="${esc(v)}">${short(v, 6)}</code><button class="ghost" data-copy="${esc(v)}">Copy</button>`
          : v ? `<code class="mono">${esc(v)}</code>` : ""}</span>
        <span class="tl-state mono">${done ? "on chain" : "pending"}</span>
      </li>`).join("")}</ol>`;
  wireCopy();
}

// ------------------------------------------------------------------ model

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

({ check: checkPage, explain: explainPage, audit: auditPage, appeal: appealPage, campaign: campaignPage, model: modelPage, feature: featurePage })[page]();
startMotion();
