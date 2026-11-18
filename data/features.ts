// The 64-bit input layout. One source of truth: training, Verilog export, contracts and the web page
// all follow this order. Bit i -> byte i>>3, bit i&7 (TAP-02 packing, LSB first).

export type Feature = { name: string; label: string; unit: string; thresholds: number[] };

export const FEATURES: Feature[] = [
  { name: "ageDays",        label: "wallet age",                        unit: "days",  thresholds: [1, 7, 30, 90, 180, 365] },
  { name: "txCount",        label: "transactions sent",                 unit: "",      thresholds: [1, 5, 20, 50, 200, 1000] },
  { name: "contracts",      label: "distinct contracts used",           unit: "",      thresholds: [1, 3, 10, 25, 50, 100] },
  { name: "counterparties", label: "distinct counterparties",           unit: "",      thresholds: [1, 3, 10, 25, 50, 100] },
  { name: "funderCluster",  label: "wallets sharing its first funder",  unit: "",      thresholds: [1, 2, 5, 10, 25, 50, 100, 500] },
  { name: "amountRepeat",   label: "transfers with repeated amounts",   unit: "%",     thresholds: [10, 25, 40, 60, 80, 95] },
  { name: "hourSpread",     label: "distinct active hours of the day",  unit: "",      thresholds: [1, 2, 4, 8, 12, 18] },
  { name: "gasSame",        label: "txs with identical gas settings",   unit: "%",     thresholds: [50, 80, 95, 99] },
  { name: "burstShare",     label: "activity inside the campaign window", unit: "%",   thresholds: [10, 25, 50, 75, 90, 99] },
  { name: "balanceUsd",     label: "balance",                           unit: "USD",   thresholds: [0.01, 1, 10, 100, 1000, 10000] },
];
export const FLAGS = [
  { name: "isContract",         label: "is a contract (has code)" },
  { name: "hasName",            label: "has a name (not used in v1, always 0)" },
  { name: "fundedFromExchange", label: "first funded from a known exchange" },
  { name: "sweptToFunder",      label: "sent funds back to its funder" },
] as const;
export const N_BITS = 64; // 60 threshold bits + 4 flags

export type RawFeatures = { [k: string]: number | boolean };
export type Hex = `0x${string}`;

export const thermometer = (v: number, t: number[]) => t.map(x => (v > x ? 1 : 0));

export function toBits(f: RawFeatures): number[] {
  const bits: number[] = [];
  for (const feat of FEATURES) bits.push(...thermometer(Number(f[feat.name]), feat.thresholds));
  for (const flag of FLAGS) bits.push(f[flag.name] ? 1 : 0);
  if (bits.length !== N_BITS) throw new Error(`layout has ${bits.length} bits, expected ${N_BITS}`);
  return bits;
}

export function pack(bits: number[]): Hex {
  const out = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((b, i) => { if (b) out[i >> 3] |= 1 << (i & 7); });
  return `0x${Array.from(out, x => x.toString(16).padStart(2, "0")).join("")}`;
}

export function unpack(hex: string, n = N_BITS): number[] {
  const h = hex.replace(/^0x/, "");
  return Array.from({ length: n }, (_, i) => (parseInt(h.slice(2 * (i >> 3), 2 * (i >> 3) + 2), 16) >> (i & 7)) & 1);
}

/** Bit ranges per feature: [{feature, start, count}] then flags. */
export type Slot = { kind: "feature"; feature: Feature; start: number; count: number }
                 | { kind: "flag"; name: string; label: string; start: number; count: 1 };
export const SLOTS: Slot[] = (() => {
  const s: Slot[] = []; let k = 0;
  for (const f of FEATURES) { s.push({ kind: "feature", feature: f, start: k, count: f.thresholds.length }); k += f.thresholds.length; }
  for (const f of FLAGS) { s.push({ kind: "flag", name: f.name, label: f.label, start: k, count: 1 }); k++; }
  return s;
})();

const fmt = (x: number, unit: string) =>
  unit === "%" ? `${x}%` : unit === "USD" ? `$${x.toLocaleString("en-US")}`
  : unit ? `${x.toLocaleString("en-US")} ${x === 1 ? unit.replace(/s$/, "") : unit}` : x.toLocaleString("en-US");

/** Thermometer level (number of thresholds exceeded) for a feature slot. */
export const levelOf = (bits: number[], s: Slot) => bits.slice(s.start, s.start + s.count).reduce((a, b) => a + b, 0);

/** Plain words for "this feature is at level L", e.g. "wallet age: more than 30 days, at most 90 days". */
export function describeLevel(f: Feature, level: number): string {
  const t = f.thresholds;
  if (level === 0) return `${f.label}: ${fmt(t[0], f.unit)} or less`;
  if (level === t.length) return `${f.label}: more than ${fmt(t[t.length - 1], f.unit)}`;
  return `${f.label}: more than ${fmt(t[level - 1], f.unit)}, at most ${fmt(t[level], f.unit)}`;
}

/** Plain words for a single bit i. */
export function describeBit(i: number): string {
  for (const s of SLOTS) {
    if (i >= s.start && i < s.start + s.count)
      return s.kind === "flag" ? s.label : `${s.feature.label} > ${fmt(s.feature.thresholds[i - s.start], s.feature.unit)}`;
  }
  throw new Error("bit out of range");
}

/** True if the thermometer code is valid (each feature's bits are 1...10...0). */
export function isValid(bits: number[]): boolean {
  return SLOTS.every(s => s.kind === "flag" || bits.slice(s.start, s.start + s.count).every((b, j, a) => j === 0 || b <= a[j - 1]));
}

/** Set a feature to a given thermometer level, returning a new vector. */
export function withLevel(bits: number[], s: Slot, level: number): number[] {
  const b = bits.slice();
  for (let j = 0; j < s.count; j++) b[s.start + j] = j < level ? 1 : 0;
  return b;
}
