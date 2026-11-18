// Stage-by-stage view of the v1 circuit: the same logic network as the NAND netlist, evaluated layer
// by layer from the trained gate list (difflogic ops), so each stage's activations can be shown.
// Checked bit-for-bit against the NAND netlist on all 2,425 wallets (build/tmp/check_stages.ts).
import gates from "../public/model/v1.gates.json";

type Layer = { in: number; out: number; a: number[]; b: number[]; op: number[] };
const L = gates.layers as Layer[];
export const GROUP = gates.group as number;

export const OP_NAMES = ["FALSE", "AND", "A·¬B", "A", "¬A·B", "B", "XOR", "OR", "NOR", "XNOR", "¬B", "A+¬B", "¬A", "¬A+B", "NAND", "TRUE"];
const READS_A = new Set([1, 2, 3, 4, 6, 7, 8, 9, 11, 12, 13, 14]);
const READS_B = new Set([1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14]);

const OP = (op: number, a: number, b: number) => {
  switch (op) {
    case 0: return 0; case 1: return a & b; case 2: return a & (1 - b); case 3: return a;
    case 4: return (1 - a) & b; case 5: return b; case 6: return a ^ b; case 7: return a | b;
    case 8: return 1 - (a | b); case 9: return 1 - (a ^ b); case 10: return 1 - b; case 11: return a | (1 - b);
    case 12: return 1 - a; case 13: return (1 - a) | b; case 14: return 1 - (a & b); default: return 1;
  }
};

export type Stages = { layers: Uint8Array[]; human: number; bot: number; verdict: boolean; margin: number };

function forward(x: Uint8Array, from: number, layers: Uint8Array[]) {
  for (let li = from; li < L.length; li++) {
    const l = L[li], y = new Uint8Array(l.out);
    for (let j = 0; j < l.out; j++) y[j] = OP(l.op[j], x[l.a[j]], x[l.b[j]]);
    layers[li] = y; x = y;
  }
  return layers;
}
const vote = (last: Uint8Array) => {
  let human = 0, bot = 0;
  for (let j = 0; j < GROUP; j++) human += last[j];
  for (let j = GROUP; j < 2 * GROUP; j++) bot += last[j];
  return { human, bot, verdict: bot > human, margin: bot - human };
};

export function runStages(bits: number[]): Stages {
  const layers = forward(Uint8Array.from(bits), 0, []);
  return { layers, ...vote(layers[layers.length - 1]) };
}

export const layerSizes = () => L.map(l => l.out);

/** Neurons that reach the vote at all (the rest were pruned before synthesis). */
export function liveNeurons(): Set<number>[] {
  const keep = L.map(() => new Set<number>()); keep[L.length - 1] = new Set(Array.from({ length: L[L.length - 1].out }, (_, i) => i));
  for (let li = L.length - 1; li > 0; li--) for (const j of keep[li]) {
    if (READS_A.has(L[li].op[j])) keep[li - 1].add(L[li].a[j]);
    if (READS_B.has(L[li].op[j])) keep[li - 1].add(L[li].b[j]);
  }
  return keep;
}

/** Neurons of layer li whose single flip changes the verdict for this wallet. */
export function decidingNeurons(bits: number[], li: number): number[] {
  const base = runStages(bits), res: number[] = [];
  for (let j = 0; j < L[li].out; j++) {
    const layers = base.layers.slice(); const x = Uint8Array.from(base.layers[li]); x[j] ^= 1; layers[li] = x;
    if (li + 1 < L.length) forward(x, li + 1, layers);
    if (vote(layers[L.length - 1]).verdict !== base.verdict) res.push(j);
  }
  return res;
}

/** Input bits that a set of neurons in layer li ultimately read. */
export function inputsOf(li: number, neurons: number[]): Map<number, number> {
  const count = new Map<number, number>();
  for (const n of neurons) {
    let frontier = new Set([n]);
    for (let k = li; k >= 0; k--) {
      const next = new Set<number>();
      for (const j of frontier) {
        if (READS_A.has(L[k].op[j])) next.add(L[k].a[j]);
        if (READS_B.has(L[k].op[j])) next.add(L[k].b[j]);
      }
      frontier = next;
    }
    for (const bit of frontier) count.set(bit, (count.get(bit) ?? 0) + 1);
  }
  return count;
}

export const opsOf = (li: number, only?: Set<number>) => {
  const c = new Array(16).fill(0);
  L[li].op.forEach((o, j) => { if (!only || only.has(j)) c[o]++; });
  return c;
};
