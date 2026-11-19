// Interactive cluster map: force layout (d3-force, loaded only on this page), pan/zoom (wheel, drag, pinch),
// draggable nodes, directed edges with OKB amounts, and a details panel for the selected node.
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type SimulationNodeDatum } from "d3-force";
import type { Cluster, GNodeData } from "./data";
import { esc, short } from "./ui";

type N = GNodeData & SimulationNodeDatum;
type E = { source: N; target: N; k: string; okb?: number; n?: number };
const SVG = "http://www.w3.org/2000/svg";
const KIND: Record<string, string> = { funds: "funds", sweeps: "sends to", direct: "transfers with" };
const fmtOkb = (x?: number) => (x === undefined ? "" : x >= 1 ? `${x.toFixed(2)} OKB` : x > 0 ? `${x.toPrecision(2)} OKB` : "");

export function mountGraph(host: HTMLElement, c: Cluster, focus: string, href: (w: string) => string, onSelect: (html: string) => void) {
  const W = 640, H = 420;
  const nodes: N[] = c.nodes.map(n => ({ ...n }));
  const byId = new Map(nodes.map(n => [n.id, n]));
  const links = c.edges.filter(e => byId.has(e.s) && byId.has(e.t)).map(e => ({ source: e.s, target: e.t, k: e.k, okb: e.okb, n: e.n }));
  const sim = forceSimulation(nodes)
    .force("link", forceLink(links).id((d: unknown) => (d as N).id).distance(l => ((l as unknown as E).k === "direct" ? 55 : 80)))
    .force("charge", forceManyBody().strength(-260)).force("center", forceCenter(W / 2, H / 2)).force("collide", forceCollide(20)).stop();
  for (let i = 0; i < 300; i++) sim.tick();
  const edges = links as unknown as E[];

  host.innerHTML = `<div class="graph-wrap" data-lenis-prevent>
      <svg class="graph" viewBox="0 0 ${W} ${H}" role="group" aria-label="Cluster map: ${nodes.length} nodes. Use the members table below for a list.">
        <defs>${["funds", "sweeps", "direct"].map(k => `<marker id="ar-${k}" class="ar-${k}" viewBox="0 0 10 10" refX="22" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z"/></marker>`).join("")}</defs>
        <g class="vp"><g class="edges"></g><g class="nodes"></g></g></svg>
      <div class="graph-ctl mono"><button type="button" data-z="1.3" aria-label="Zoom in">+</button><button type="button" data-z="0.77" aria-label="Zoom out">−</button><button type="button" data-z="0" aria-label="Fit">Fit</button></div>
    </div>`;
  const svg = host.querySelector("svg")!, vp = svg.querySelector<SVGGElement>(".vp")!;
  const gE = svg.querySelector(".edges")!, gN = svg.querySelector(".nodes")!;
  const lines = edges.map(e => {
    const l = document.createElementNS(SVG, "line");
    l.setAttribute("class", `e-${e.k}`); l.setAttribute("marker-end", e.k === "direct" ? "" : `url(#ar-${e.k})`);
    const t = document.createElementNS(SVG, "title");
    t.textContent = `${short(e.source.id, 4)} ${KIND[e.k] ?? e.k} ${short(e.target.id, 4)}${e.okb ? ` · ${fmtOkb(e.okb)}` : ""}${e.n ? ` · ${e.n} txs` : ""}`;
    l.appendChild(t); gE.appendChild(l); return l;
  });
  const els = nodes.map(n => {
    const a = document.createElementNS(SVG, "a");
    a.setAttribute("href", n.kind === "wallet" ? href(n.id) : "#");
    a.setAttribute("class", n.kind === "wallet" ? `n-wallet ${n.v ? "flag" : "pass"} ${n.id === focus ? "focus" : ""}` : `n-${n.kind}`);
    a.setAttribute("aria-label", n.kind === "wallet" ? `wallet ${n.id}, ${n.v ? "flagged" : "passed"}` : `${n.kind} ${n.id}`);
    a.innerHTML = (n.kind === "wallet"
      ? `<circle class="hit" r="18"/><circle class="dot" r="${n.id === focus ? 12 : 9}"/>${n.label ? `<circle class="lbl" r="3"/>` : ""}`
      : `<circle class="hit" r="18"/><rect x="-9" y="-9" width="18" height="18" transform="rotate(45)"/>`);
    gN.appendChild(a); return a;
  });
  const paint = () => {
    edges.forEach((e, i) => { const l = lines[i];
      l.setAttribute("x1", String(e.source.x)); l.setAttribute("y1", String(e.source.y)); l.setAttribute("x2", String(e.target.x)); l.setAttribute("y2", String(e.target.y)); });
    nodes.forEach((n, i) => els[i].setAttribute("transform", `translate(${n.x!.toFixed(1)} ${n.y!.toFixed(1)})`));
  };
  paint();

  // ---- view: pan / zoom (viewBox maths keeps strokes crisp)
  let view = { x: 0, y: 0, k: 1 };
  const apply = () => vp.setAttribute("transform", `translate(${view.x} ${view.y}) scale(${view.k})`);
  const fit = () => {
    const xs = nodes.map(n => n.x!), ys = nodes.map(n => n.y!), pad = 40;
    const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
    const k = Math.min(W / (x1 - x0), H / (y1 - y0), 2.5);
    view = { k, x: (W - (x0 + x1) * k) / 2, y: (H - (y0 + y1) * k) / 2 }; apply();
  };
  fit();
  const toSvg = (cx: number, cy: number) => { const r = svg.getBoundingClientRect(); return { x: (cx - r.left) / r.width * W, y: (cy - r.top) / r.height * H }; };
  const zoomAt = (f: number, px = W / 2, py = H / 2) => {
    const k = Math.min(6, Math.max(0.3, view.k * f)); f = k / view.k;
    view = { k, x: px - (px - view.x) * f, y: py - (py - view.y) * f }; apply();
  };
  // plain wheel scrolls the page; ctrl/cmd + wheel (what trackpad pinch sends) zooms, as do the buttons
  svg.addEventListener("wheel", e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault(); const p = toSvg(e.clientX, e.clientY); zoomAt(Math.exp(-e.deltaY * 0.0015), p.x, p.y);
  }, { passive: false });
  host.querySelectorAll<HTMLButtonElement>(".graph-ctl button").forEach(b => b.onclick = () => (Number(b.dataset.z) ? zoomAt(Number(b.dataset.z)) : fit()));

  const ptrs = new Map<number, { x: number; y: number }>();
  let drag: { node?: N; moved: boolean; last: { x: number; y: number } } | undefined, pinch = 0;
  svg.addEventListener("pointerdown", e => {
    const i = els.findIndex(el => el.contains(e.target as Node));
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); drag = undefined; return; }
    drag = { node: i >= 0 ? nodes[i] : undefined, moved: false, last: toSvg(e.clientX, e.clientY) };
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener("pointermove", e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2 && pinch) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y), m = toSvg((a.x + b.x) / 2, (a.y + b.y) / 2);
      zoomAt(d / pinch, m.x, m.y); pinch = d; return;
    }
    if (!drag) return;
    const p = toSvg(e.clientX, e.clientY), dx = p.x - drag.last.x, dy = p.y - drag.last.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
    drag.last = p;
    if (drag.node) { drag.node.x! += dx / view.k; drag.node.y! += dy / view.k; paint(); }
    else { view.x += dx; view.y += dy; apply(); }
  });
  const end = (e: PointerEvent) => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = 0; };
  svg.addEventListener("pointercancel", e => { end(e); drag = undefined; });
  // the svg holds pointer capture while dragging, so a tap is handled here (the browser would send its
  // click to the svg, not the node): no movement + on a node = select it; a second tap on a wallet opens it
  svg.addEventListener("pointerup", e => {
    end(e);
    const d = drag; drag = undefined;
    if (!d || d.moved || !d.node) return;
    activate(nodes.indexOf(d.node));
  });

  // ---- selection: a click (not a drag) selects; a second click on a wallet opens it
  let selected = -1;
  const select = (i: number) => {
    selected = i; const n = nodes[i];
    els.forEach((el, j) => el.classList.toggle("sel", j === i));
    const mine = edges.filter(e => e.source === n || e.target === n);
    lines.forEach((l, j) => l.classList.toggle("hl", mine.includes(edges[j])));
    onSelect(`<div class="gsel"><span class="mono k">${n.kind === "wallet" ? (n.v ? "flagged wallet" : "passed wallet") : `shared ${n.kind}`}</span>
      <code class="mono">${esc(n.id)}</code>
      ${n.kind === "wallet" ? `<span class="mono">margin ${(n.m ?? 0) > 0 ? "+" : ""}${n.m ?? 0} · ${n.label ? "on a Sybil list" : "labelled human"} (${esc(n.src ?? "")})</span>` : ""}
      <ul>${mine.map(e => `<li class="mono">${e.source === n ? `${KIND[e.k] ?? e.k} ${short(e.target.id, 4)}` : `${short(e.source.id, 4)} ${KIND[e.k] ?? e.k} it`}${e.okb ? ` · ${fmtOkb(e.okb)}` : ""}</li>`).join("")}</ul>
      ${n.kind === "wallet" ? `<a class="btn-dark mono" href="${href(n.id)}">Check this wallet →</a>` : ""}</div>`);
  };
  const activate = (i: number) => {
    if (nodes[i].kind === "wallet" && selected === i) location.href = href(nodes[i].id);
    else select(i);
  };
  // keyboard (Enter on a focused node) arrives as a click with detail 0; pointer taps are handled on pointerup
  els.forEach((el, i) => el.addEventListener("click", e => { e.preventDefault(); if (e.detail === 0) activate(i); }));
  const fi = nodes.findIndex(n => n.id === focus);
  if (fi >= 0) select(fi);
}
