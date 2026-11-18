// Why this verdict. Counterfactuals move one feature to another *valid* thermometer level (or flip a
// flag), so every "what would change it" is an input a real wallet could have (review 2.5).
import { decide, run, type Net } from "./tap02";
import { SLOTS, describeLevel, levelOf, withLevel, type Slot } from "../../data/features";

export type Change = { slot: Slot; from: string; to: string; steps: number };
export type Reading = { slot: Slot; text: string; level: number; bits: number[] };

export function readings(bits: number[]): Reading[] {
  return SLOTS.map(s => s.kind === "flag"
    ? { slot: s, text: `${s.label}: ${bits[s.start] ? "yes" : "no"}`, level: bits[s.start], bits: [bits[s.start]] }
    : { slot: s, text: describeLevel(s.feature, levelOf(bits, s)), level: levelOf(bits, s), bits: bits.slice(s.start, s.start + s.count) });
}

/** Single-feature changes that flip the verdict, nearest level first. */
export function flips(net: Net, bits: number[]): Change[] {
  const base = decide(net, bits).verdict, out: Change[] = [];
  for (const s of SLOTS) {
    if (s.kind === "flag") {
      if (s.name === "hasName") continue;   // constant in v1
      const b = bits.slice(); b[s.start] ^= 1;
      if (decide(net, b).verdict !== base)
        out.push({ slot: s, from: `${s.label}: ${bits[s.start] ? "yes" : "no"}`, to: `${s.label}: ${b[s.start] ? "yes" : "no"}`, steps: 1 });
      continue;
    }
    const cur = levelOf(bits, s);
    let best: Change | undefined;
    for (let L = 0; L <= s.count; L++) {
      if (L === cur) continue;
      if (decide(net, withLevel(bits, s, L)).verdict !== base && (!best || Math.abs(L - cur) < best.steps))
        best = { slot: s, from: describeLevel(s.feature, cur), to: describeLevel(s.feature, L), steps: Math.abs(L - cur) };
    }
    if (best) out.push(best);
  }
  return out.sort((x, y) => x.steps - y.steps);
}

/** Gates whose single flip changes the verdict (the gate map). O(n^2), well under a second at 3,000 gates. */
export function decidingGates(net: Net, bits: number[]): number[] {
  const s = run(net, bits), off = 2 + net.nIn, n = net.a.length, vIdx = s.length - net.nOut, base = s[vIdx], res: number[] = [];
  const t = new Uint8Array(s.length);
  for (let g = 0; g < n; g++) {
    t.set(s); t[off + g] ^= 1;
    for (let h = g + 1; h < n; h++) t[off + h] = 1 - (t[net.a[h]] & t[net.b[h]]);
    if (t[vIdx] !== base) res.push(g);
  }
  return res;
}
