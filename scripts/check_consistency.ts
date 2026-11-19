// Every published artifact must describe the same model and the same snapshot (audit S12): the model card,
// the netlist, the gate list the site runs, the test leaves, the snapshot index/list, and the current
// extractor source. Exits non-zero on any mismatch. Run by scripts/build_model.sh and scripts/test_all.sh.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { extractorHash } from "../data/extractor_hash";
import { build, snapshotLeaf, testLeaf } from "../data/merkle_core";
import type { Hex } from "viem";

const j = (f: string) => JSON.parse(readFileSync(f, "utf8"));
const errs: string[] = [];
const eq = (what: string, a: unknown, b: unknown) => { if (String(a).toLowerCase() !== String(b).toLowerCase()) errs.push(`${what}: ${a} != ${b}`); };

const card = j("web/public/model/model_card.json"), nl = j("web/public/model/cusity.netlist.json");
eq("card vs build card", JSON.stringify(card), JSON.stringify(j("build/model_card.json")));
eq("netlist sha256", "0x" + createHash("sha256").update(Buffer.from(nl.netlist.slice(2), "hex")).digest("hex"), card.netlistSha256);
eq("netlist vs build", nl.netlist, j("build/cusity.netlist.json").netlist);
eq("gates", card.gates, nl.gates);
const gv = `model/v${card.version}.gates.json`;
if (existsSync(gv)) eq("site gates.json vs " + gv, readFileSync("web/public/model/gates.json", "utf8"), readFileSync(gv, "utf8"));
else errs.push(`missing ${gv}`);
const ext = extractorHash();
eq("extractor hash (card)", card.extractorSha256, ext);

const tl = j("web/public/test_leaves.json");
eq("test leaves vs data/", JSON.stringify(tl), JSON.stringify(j("data/test_leaves.json")));
eq("test root (card)", card.testRoot, tl.root); eq("test size (card)", card.testSize, tl.size);
eq("test root rebuilt", build(tl.leaves.map((l: any) => testLeaf(l.index, l.wallet, l.bits, l.label === 1))).root, tl.root);

const idx = j("web/public/snapshot/index.json"), list = j("web/public/snapshot/list.json");
eq("snapshot extractor hash", idx.extractorHash, ext);
eq("snapshot root (index vs list)", idx.root, list.root);
const sorted = list.list.every((x: [string], i: number) => i === 0 || x[0] > list.list[i - 1][0]);
if (!sorted) errs.push("snapshot list not strictly sorted (duplicate or out of order)");
eq("snapshot root rebuilt", build(list.list.map(([w, b]: [Hex, Hex], i: number) => snapshotLeaf(i, w, b))).root, idx.root);
for (const k of ["00", "7f", "ff"]) eq(`shard ${k} root`, j(`web/public/snapshot/${k}.json`).root, idx.root);
const vec = readFileSync("data/vectors.jsonl", "utf8").trim().split("\n").map(l => JSON.parse(l));
if (vec.some(v => v.extractorHash?.toLowerCase() !== ext.toLowerCase())) errs.push("data/vectors.jsonl was extracted with a different extractor");
if (existsSync("web/public/snapshot_vectors.json")) errs.push("stale web/public/snapshot_vectors.json is published");

if (errs.length) { console.error("INCONSISTENT:\n  " + errs.join("\n  ")); process.exit(1); }
console.log(`consistent: v${card.version}, ${card.gates} gates, test root ${tl.root.slice(0, 10)}…, snapshot root ${idx.root.slice(0, 10)}…, extractor ${ext.slice(0, 10)}…`);
