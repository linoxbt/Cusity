// Small helpers shared by the landing page and the app pages.

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
export const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export const short = (h: string, n = 6) => (h.length > 2 * n + 2 ? `${h.slice(0, n + 2)}…${h.slice(-n)}` : h);

export function marginBar(margin: number, flagged: boolean) {
  const pct = Math.min(Math.abs(margin), 16) / 16 * 50;
  const style = margin >= 0 ? `left:50%;width:${pct}%` : `left:${50 - pct}%;width:${pct}%`;
  return `<div class="mbar"><span class="fill ${flagged ? "flag" : ""}" style="${style}"></span></div>
    <div class="mbar-legend"><span>human</span><span>${margin > 0 ? "+" : ""}${margin}</span><span>bot</span></div>`;
}

/** The 64 input bits drawn on the hero's top plate (8 x 8, isometric). */
export function drawPlate(bits: number[]) {
  const g = document.getElementById("plate-bits"); if (!g) return;
  const cx = 250, cy = 75, step = 14, h = step * 0.42;
  let out = "";
  for (let i = 0; i < 64; i++) {
    const u = (i & 7) - 3.5, v = (i >> 3) - 3.5, x = cx + (u - v) * step, y = cy + (u + v) * step / 2;
    out += `<path d="M${x.toFixed(1)} ${(y - h / 2).toFixed(1)} l${h.toFixed(1)} ${(h / 2).toFixed(1)} l${(-h).toFixed(1)} ${(h / 2).toFixed(1)} l${(-h).toFixed(1)} ${(-h / 2).toFixed(1)} Z" class="${bits[i] ? "on" : ""}"/>`;
  }
  g.innerHTML = out;
}

/** Copy with visible feedback ("Copied" / "Copy failed"), never an unhandled rejection. */
export function copyButton(btn: HTMLButtonElement, text: () => string) {
  const label = btn.textContent ?? "Copy";
  btn.onclick = async () => {
    try { await navigator.clipboard.writeText(text()); btn.textContent = "Copied"; }
    catch { btn.textContent = "Copy failed"; }
    setTimeout(() => (btn.textContent = label), 1400);
  };
}
