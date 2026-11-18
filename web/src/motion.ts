// Motion: inertial smooth scrolling (Lenis), reveal-on-scroll, count-up numbers, and a scroll-driven
// hero stack. Everything animates transform/opacity only, so it stays on the compositor.
// Honours prefers-reduced-motion: no inertia, no transitions, final values shown at once.
import Lenis from "lenis";

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
type Listener = (y: number) => void;
const listeners: Listener[] = [];
export const onScroll = (f: Listener) => { listeners.push(f); f(window.scrollY); };

export function startMotion() {
  if (!reduced) {
    const lenis = new Lenis({ lerp: 0.09, wheelMultiplier: 1, smoothWheel: true, anchors: { offset: -72 } });
    lenis.on("scroll", () => listeners.forEach(f => f(lenis.scroll)));
    const raf = (t: number) => { lenis.raf(t); requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
    document.documentElement.classList.add("lenis-on");
  } else {
    addEventListener("scroll", () => listeners.forEach(f => f(window.scrollY)), { passive: true });
  }

  // reveal on scroll (staggered for siblings)
  const els = [...document.querySelectorAll<HTMLElement>("[data-reveal]")];
  if (reduced) { els.forEach(e => e.classList.add("in")); }
  else {
    const io = new IntersectionObserver(entries => entries.forEach(en => {
      if (!en.isIntersecting) return;
      const el = en.target as HTMLElement, sibs = [...(el.parentElement?.children ?? [])].filter(c => c.hasAttribute("data-reveal"));
      el.style.transitionDelay = `${Math.min(sibs.indexOf(el), 6) * 70}ms`;
      el.classList.add("in"); io.unobserve(el);
    }), { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    els.forEach(e => io.observe(e));
  }

  // count-up numbers
  const counts = [...document.querySelectorAll<HTMLElement>(".count[data-to]")];
  const run = (el: HTMLElement) => {
    const to = Number(el.dataset.to), dec = Number(el.dataset.dec ?? 0), fmt = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
    if (reduced || to === 0) { el.textContent = fmt(to); return; }
    const t0 = performance.now(), dur = 1400;
    const tick = (t: number) => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 4); el.textContent = fmt(to * e); if (k < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  };
  const cio = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { run(e.target as HTMLElement); cio.unobserve(e.target); } }), { threshold: 0.4 });
  counts.forEach(c => cio.observe(c));
}

/** Hero: the four plates spread apart as the page scrolls past the hero. */
export function explodeStack() {
  const plates = [...document.querySelectorAll<SVGGElement>(".stack .plate")];
  const leaders = document.querySelector<SVGGElement>(".stack .leaders");
  if (!plates.length || reduced) return;
  const base = plates.map(p => Number(/translate\(0 (\d+)\)/.exec(p.getAttribute("transform") ?? "")?.[1] ?? 0));
  onScroll(y => {
    const k = Math.min(1, Math.max(0, y / 520));
    plates.forEach((p, i) => p.setAttribute("transform", `translate(0 ${base[i] + (i - 1.5) * 26 * k})`));
    if (leaders) leaders.style.opacity = String(1 - k * 0.6);
  });
}
