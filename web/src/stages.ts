// Stage-by-stage view of the v1 circuit: the same logic network as the NAND netlist, evaluated layer
// by layer from the trained gate list (difflogic ops), so each stage's activations can be shown.
// Checked bit-for-bit against the NAND netlist on all 2,425 wallets (build/tmp/check_stages.ts).
import gates from "../public/model/v1.gates.json";

type Layer = { in: number; out: number; a: number[]; b: number[]; op: number[] };
const L = gates.layers as Layer[];
export const GROUP = gates.group as number;

const OP = (op: number, a: number, b: number) => {
  switch (op) {
    case 0: return 0; case 1: return a & b; case 2: return a & (1 - b); case 3: return a;
    case 4: return (1 - a) & b; case 5: return b; case 6: return a ^ b; case 7: return a | b;
    case 8: return 1 - (a | b); case 9: return 1 - (a ^ b); case 10: return 1 - b; case 11: return a | (1 - b);
    case 12: return 1 - a; case 13: return (1 - a) | b; case 14: return 1 - (a & b); default: return 1;
  }
};

export type Stages = { layers: Uint8Array[]; human: number; bot: number; verdict: boolean; margin: number };

export function runStages(bits: number[]): Stages {
  let x = Uint8Array.from(bits); const layers: Uint8Array[] = [];
  for (const l of L) {
    const y = new Uint8Array(l.out);
    for (let j = 0; j < l.out; j++) y[j] = OP(l.op[j], x[l.a[j]], x[l.b[j]]);
    layers.push(y); x = y;
  }
  const last = layers[layers.length - 1];
  let human = 0, bot = 0;
  for (let j = 0; j < GROUP; j++) human += last[j];
  for (let j = GROUP; j < 2 * GROUP; j++) bot += last[j];
  return { layers, human, bot, verdict: bot > human, margin: bot - human };
}

export const layerSizes = () => L.map(l => l.out);
