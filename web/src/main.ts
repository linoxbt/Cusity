import "./style.css";
import { CONFIG, LIVE } from "./config";
import { auditInfo, checkWallet, loadNet, runAudit, sampleWallets, type CheckResult } from "./chain";
import { decidingGates, flips, readings } from "./explain";
import { SLOTS } from "../../data/features";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const short = (h: string, n = 6) => (h.length > 2 * n + 2 ? `${h.slice(0, n + 2)}…${h.slice(-n)}` : h);

let last: Extract<CheckResult, { status: "ok" }> | undefined;

// ------------------------------------------------------------------ routing

const VIEWS = ["check", "explain", "audit", "appeal"] as const;
function route() {
  const v = (location.hash.slice(1) || "check") as (typeof VIEWS)[number];
  for (const id of VIEWS) $(`view-${id}`).hidden = id !== v;
  document.querySelectorAll<HTMLAnchorElement>("nav a").forEach(a => a.classList.toggle("on", a.dataset.view === v));
  if (v === "explain") renderExplain();
  if (v === "audit") renderAudit();
  if (v === "appeal") prefillAppeal();
}
window.addEventListener("hashchange", route);

$("mode").textContent = LIVE ? `Live · X Layer · model #${CONFIG.modelId}` : "Demo · toy circuit in your browser";
$("foot-ids").textContent = LIVE
  ? `processor ${CONFIG.processor} · circuit #${CONFIG.circuitId} · campaign #${CONFIG.campaignId}`
  : "Demo mode: the pipeline-proof circuit (251 NAND gates) runs locally. Live addresses go in web/src/config.ts.";

// ------------------------------------------------------------------ check

function bitsGrid(bits: number[]) {
  return `<div class="bits">${SLOTS.map(s => `
    <div class="feat"><span class="name">${esc(s.kind === "flag" ? s.label : s.feature.label)}</span>
      <span class="cells">${bits.slice(s.start, s.start + s.count).map((b, j) =>
        `<span class="cell ${b ? "on" : ""}" title="bit ${s.start + j}">${b}</span>`).join("")}</span></div>`).join("")}</div>`;
}

function marginBar(margin: number, flagged: boolean) {
  const pct = Math.min(Math.abs(margin), 16) / 16 * 50;
  const style = margin >= 0 ? `left:50%;width:${pct}%` : `left:${50 - pct}%;width:${pct}%`;
  return `<div class="bar"><span class="fill ${flagged ? "flag" : ""}" style="${style}"></span></div>
    <div class="bar-legend"><span>clearly human</span><span>margin ${margin > 0 ? "+" : ""}${margin}</span><span>clearly bot</span></div>`;
}

function renderCheck(r: CheckResult) {
  const out = $("check-out");
  if (r.status === "invalid") { out.innerHTML = `<div class="card warn">That is not a valid address.</div>`; return; }
  if (r.status === "not-in-snapshot") {
    out.innerHTML = `<div class="card"><p>${esc(r.wallet)} is not in this campaign's snapshot, so the filter has no input bits for it.</p></div>`;
    return;
  }
  last = r;
  const agree = r.localVerdict === r.verdict;
  out.innerHTML = `
    <div class="card">
      <div class="verdict">
        <span class="pill ${r.verdict ? "flag" : ""}"><span class="dot"></span>${r.verdict ? "Flagged by the filter" : "Passed the filter"}</span>
        <a href="#explain" class="muted">Why?</a> <a href="#appeal" class="muted">Appeal</a>
      </div>
      ${marginBar(r.margin, r.verdict)}
      <dl class="kv">
        <dt>Wallet</dt><dd class="mono">${esc(r.wallet)}</dd>
        <dt>Answer from</dt><dd>${r.source}</dd>
        <dt>Snapshot proof</dt><dd class="ok">bits match the committed root <span class="mono muted">${short(r.root)}</span></dd>
        <dt>Your browser</dt><dd class="${agree ? "ok" : "warn"}">${agree ? "re-ran the circuit and got the same answer" : "got a different answer. Report this."}</dd>
      </dl>
    </div>
    <div class="card">
      <h2 style="margin-top:0">The 64 bits the circuit saw</h2>
      ${bitsGrid(r.bits)}
      <div class="hex">Exact input: <code class="mono">${r.bitsHex}</code><button class="ghost" id="copy-bits">Copy</button></div>
    </div>`;
  $("copy-bits").onclick = () => navigator.clipboard.writeText(r.bitsHex);
}

$("check-form").addEventListener("submit", async e => {
  e.preventDefault();
  const btn = $("check-form").querySelector("button")!;
  btn.disabled = true; $("check-out").innerHTML = `<p class="muted">Checking…</p>`;
  try { renderCheck(await checkWallet($<HTMLInputElement>("wallet").value)); }
  catch (err) { $("check-out").innerHTML = `<div class="card warn">${esc(String((err as Error).message ?? err))}</div>`; }
  finally { btn.disabled = false; }
});

sampleWallets().then(ws => {
  if (!ws.length) return;
  $("samples").innerHTML = `<span>${LIVE ? "Entrants:" : "Try a sample:"}</span>` + ws.slice(0, 4).map(w =>
    `<button type="button" data-w="${esc(w)}">${short(w, 4)}</button>`).join("");
  $("samples").querySelectorAll<HTMLButtonElement>("button").forEach(b => b.onclick = () => {
    $<HTMLInputElement>("wallet").value = b.dataset.w!; $<HTMLFormElement>("check-form").requestSubmit();
  });
}).catch(() => {});

// ------------------------------------------------------------------ explain

async function renderExplain() {
  const out = $("explain-out");
  if (!last) { out.innerHTML = `<p class="muted">Check a wallet first, then come back here.</p>`; return; }
  const net = await loadNet(), r = last, fl = flips(net, r.bits), t0 = performance.now(), dg = decidingGates(net, r.bits), ms = performance.now() - t0;
  out.innerHTML = `
    <div class="card">
      <div class="verdict"><span class="pill ${r.verdict ? "flag" : ""}"><span class="dot"></span>${r.verdict ? "Flagged" : "Passed"}</span>
        <span class="mono muted">${esc(r.wallet)}</span></div>
      ${marginBar(r.margin, r.verdict)}
    </div>
    <div class="card">
      <h2 style="margin-top:0">What would change the result</h2>
      ${fl.length ? `<ul class="reasons">${fl.map(c => `<li>If <strong>${esc(c.from)}</strong><br/>were instead <span class="to">${esc(c.to)}</span>, the result would flip.</li>`).join("")}</ul>`
        : `<p>No single realistic change flips this result. It is not a close call.</p>`}
    </div>
    <div class="card">
      <h2 style="margin-top:0">What the circuit read</h2>
      <table><tbody>${readings(r.bits).map(x => `<tr><td>${esc(x.text)}</td><td class="mono muted">${x.bits.join("")}</td></tr>`).join("")}</tbody></table>
    </div>
    <div class="card">
      <h2 style="margin-top:0">Gate map</h2>
      <p class="muted">${net.a.length} NAND gates. Flipping any one of the <span class="ok">${dg.length} highlighted</span> gates on its own
        would change the verdict (computed in ${ms.toFixed(0)} ms in your browser).</p>
      <div class="gatemap">${Array.from(net.a, (_, g) => `<i class="${dg.includes(g) ? "d" : ""}" title="gate ${g}"></i>`).join("")}</div>
    </div>`;
}

// ------------------------------------------------------------------ audit

async function renderAudit() {
  const out = $("audit-out");
  out.innerHTML = `<p class="muted">Loading…</p>`;
  try {
    const a = await auditInfo();
    const matches = a.netlistHash && a.committedHash ? a.netlistHash.toLowerCase() === a.committedHash.toLowerCase() : undefined;
    const done = a.rounds.filter(r => r.status === "done"), expired = a.rounds.filter(r => r.status === "expired").length;
    const c = done.reduce((s, r) => s + r.correct, 0), t = done.reduce((s, r) => s + r.total, 0);
    out.innerHTML = `
      <div class="card"><dl class="kv" style="margin-top:0">
        <dt>Test set root</dt><dd class="mono">${a.testRoot}</dd>
        <dt>Test set size</dt><dd>${a.testSize} rows · ${a.k} sampled per round</dd>
        ${LIVE ? `<dt>Committed netlist</dt><dd class="mono">${a.committedHash}</dd>
        <dt>Taped-out netlist</dt><dd class="mono">${a.netlistHash}</dd>
        <dt>Campaign commit</dt><dd class="${matches && a.bound ? "ok" : "warn"}">${matches && a.bound ? `matches and is bound (snapshot block ${a.snapshotBlock})` : "not bound yet"}</dd>` :
        `<dt>Mode</dt><dd>Demo: rows are drawn with a random seed and scored by the circuit in your browser. Live audits run on chain.</dd>`}
        <dt>Score so far</dt><dd>${t ? `<strong>${c}/${t}</strong> correct over ${done.length} round${done.length > 1 ? "s" : ""} (${(100 * c / t).toFixed(1)}%)` : "no finished rounds yet"}${expired ? ` · <span class="warn">${expired} expired</span>` : ""}</dd>
      </dl></div>
      ${a.rounds.length ? `<div class="card"><table><thead><tr><th>Round</th><th>Status</th><th>Score</th></tr></thead><tbody>${a.rounds.map(r =>
        `<tr><td class="mono">#${r.id}</td><td class="${r.status === "expired" ? "warn" : ""}">${r.status}</td><td>${r.status === "done" ? `${r.correct}/${r.total}` : "–"}</td></tr>`).join("")}</tbody></table></div>` : ""}`;
  } catch (err) { out.innerHTML = `<div class="card warn">${esc(String((err as Error).message ?? err))}</div>`; }
}

$("run-audit").addEventListener("click", async () => {
  const btn = $<HTMLButtonElement>("run-audit"), log = $("audit-log");
  btn.disabled = true; log.hidden = false; log.textContent = "";
  try {
    const r = await runAudit(s => { log.textContent += s + "\n"; log.scrollTop = log.scrollHeight; });
    log.textContent += `\nround #${r.id}: ${r.correct}/${r.total} correct\n`;
    await renderAudit();
  } catch (err) { log.textContent += `\nerror: ${(err as Error).message ?? err}\n`; }
  finally { btn.disabled = false; }
});

// ------------------------------------------------------------------ appeal

function prefillAppeal() {
  if (!last) return;
  if (!$<HTMLInputElement>("ap-wallet").value) $<HTMLInputElement>("ap-wallet").value = last.wallet;
  if (!$<HTMLInputElement>("ap-bits").value) $<HTMLInputElement>("ap-bits").value = last.bitsHex;
}

$("appeal-form").addEventListener("submit", e => {
  e.preventDefault();
  const w = $<HTMLInputElement>("ap-wallet").value.trim(), b = $<HTMLInputElement>("ap-bits").value.trim(), n = $<HTMLTextAreaElement>("ap-note").value.trim();
  const msg = `Cusity appeal\ncampaign: #${CONFIG.campaignId}\nwallet: ${w}\nbits: ${b}\nnote: ${n}`;
  const out = $("appeal-out");
  out.innerHTML = `<div class="card"><h2 style="margin-top:0">Your appeal</h2><div class="msg mono" id="ap-msg"></div>
    <div class="row" style="margin-top:14px"><button class="primary" id="ap-copy">Copy message</button>
    ${CONFIG.containerId ? `<button id="ap-send">Open TapeSend</button>` : ""}</div>
    <p class="muted" style="margin-top:14px">${CONFIG.containerId
      ? `Send it to Container <span class="mono">${esc(CONFIG.containerId)}</span> in TapeSend.`
      : "TapeSend delivery is wired up once the model's Container is live. For now, copy the message."}</p></div>`;
  $("ap-msg").textContent = msg;   // user text goes in as text, never HTML
  $("ap-copy").onclick = () => navigator.clipboard.writeText(msg);
});

route();
