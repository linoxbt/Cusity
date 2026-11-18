// The app: four independent pages (check.html, explain.html, audit.html, appeal.html) sharing one shell.
// The last checked wallet carries across pages (sessionStorage), and ?w=0x… makes any page shareable.
import "./style.css";
import { CONFIG, LIVE } from "./config";
import { auditInfo, checkWallet, loadNet, runAudit, sampleWallets, type CheckResult } from "./chain";
import { decidingGates, flips, readings } from "./explain";
import { $, bitsGrid, esc, marginBar, short } from "./ui";

type Page = "check" | "explain" | "audit" | "appeal";
type Ok = Extract<CheckResult, { status: "ok" }>;
const PAGES: [Page, string][] = [["check", "Check"], ["explain", "Explain"], ["audit", "Audit"], ["appeal", "Appeal"]];
const page = (document.body.dataset.page ?? "check") as Page;
const KEY = "cusity:wallet";

const wallet = () => new URLSearchParams(location.search).get("w") ?? sessionStorage.getItem(KEY) ?? "";
const remember = (w: string) => sessionStorage.setItem(KEY, w);
const link = (p: Page, w = wallet()) => `${p}.html${w ? `?w=${encodeURIComponent(w)}` : ""}`;

// ------------------------------------------------------------------ shell

function shell(title: string) {
  const nav = PAGES.map(([p, label], i) =>
    `<a href="${link(p)}" class="${p === page ? "on" : ""}"><span>0${i + 1}</span>${label}</a>`).join("");
  document.body.innerHTML = `
    <aside class="rail">
      <a class="rail-tile" href="index.html" aria-label="Cusity home"><img src="./mark.svg" alt="" width="34" height="34" /></a>
      <nav class="rail-nav">${nav}</nav>
      <div class="rail-status mono"><span class="lbl">Circuit</span><span class="val">${LIVE ? `#${CONFIG.circuitId} live` : "demo"}</span></div>
    </aside>
    <div class="app-main">
      <header class="app-bar">
        <a class="bar-brand" href="index.html"><img src="./logo.svg" alt="cusity" height="22" /></a>
        <nav class="app-tabs">${nav}</nav>
        <span class="chip mono">${LIVE ? "Live · X Layer" : "Demo"}</span>
      </header>
      <section class="sheet app-sheet">
        <h1 class="app-title">${title}</h1>
        <div id="page"></div>
      </section>
    </div>`;
}

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
    out.innerHTML = `<p class="muted mono">…</p>`;
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
        <div class="card">
          <h2>64 inputs</h2>
          ${bitsGrid(r.bits)}
          <div class="hex"><code class="mono">${r.bitsHex}</code><button class="ghost" id="copy">Copy</button></div>
        </div>`;
      $("copy").onclick = () => navigator.clipboard.writeText(r.bitsHex);
    } catch (e) { fail(out, e); }
  };
  $("f").addEventListener("submit", e => { e.preventDefault(); go($<HTMLInputElement>("w").value.trim()); });
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
  try {
    const r = await lookup(wallet());
    if (!r || r.status !== "ok") return needWallet(el);
    const net = await loadNet(), fl = flips(net, r.bits), dg = decidingGates(net, r.bits), dgs = new Set(dg);
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
        <h2>Gates <span class="count mono">${dg.length} / ${net.a.length} deciding</span></h2>
        <div class="gatemap">${Array.from(net.a, (_, g) => `<i class="${dgs.has(g) ? "d" : ""}" title="gate ${g}"></i>`).join("")}</div>
      </div>`;
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

({ check: checkPage, explain: explainPage, audit: auditPage, appeal: appealPage })[page]();
