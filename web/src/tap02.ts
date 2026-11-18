// In-browser TAP-02 evaluator (NAND only). Matches compiler/tap02.py and the live processor's eval.
import { hexToBytes } from "viem";

export type Net = { a: Uint32Array; b: Uint32Array; nIn: number; nOut: number };

export function parse(hex: `0x${string}`, nIn: number, nOut: number): Net {
  const bytes = hexToBytes(hex), a: number[] = [], b: number[] = [];
  if (bytes.length % 7) throw new Error("netlist length is not a multiple of 7");
  for (let i = 0; i < bytes.length; i += 7) {
    if (bytes[i] !== 0x00) throw new Error(bytes[i] === 0x01 ? "LATCH not supported" : bytes[i] === 0x02 ? "REF not supported" : "bad opcode");
    const x = (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3], y = (bytes[i + 4] << 16) | (bytes[i + 5] << 8) | bytes[i + 6];
    const own = 2 + nIn + a.length;
    if (x >= own || y >= own) throw new Error(`NAND: future signal at record ${a.length}`);
    a.push(x); b.push(y);
  }
  return { a: Uint32Array.from(a), b: Uint32Array.from(b), nIn, nOut };
}

/** Every signal: [0, 1, inputs..., gate outputs...] */
export function run(net: Net, inBits: number[]): Uint8Array {
  const off = 2 + net.nIn, s = new Uint8Array(off + net.a.length);
  s[1] = 1;
  for (let i = 0; i < net.nIn; i++) s[2 + i] = inBits[i];
  for (let g = 0; g < net.a.length; g++) s[off + g] = 1 - (s[net.a[g]] & s[net.b[g]]);
  return s;
}

export const outputs = (net: Net, s: Uint8Array) => s.slice(s.length - net.nOut);
/** verdict (true = flagged) and margin (bot popcount - human popcount, signed) */
export function decide(net: Net, bits: number[]) {
  const o = outputs(net, run(net, bits));
  let m = 0; for (let k = 0; k < 6; k++) m |= o[1 + k] << k;
  return { verdict: o[0] === 1, margin: m - 32 };
}
