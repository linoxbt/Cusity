import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toBits, pack, unpack, isValid, SLOTS, levelOf, withLevel, describeLevel, N_BITS, FEATURES } from "./features";
import { buildHistory } from "./history";
import { historyFeatures, type Config } from "./extract";
import { testTree, snapshotTree } from "./merkle";
import type { Tx } from "./indexer";

test("pack/unpack round trip, LSB first", () => {
  const bits = Array.from({ length: 64 }, (_, i) => (i * 7 + 3) % 5 === 0 ? 1 : 0);
  assert.deepEqual(unpack(pack(bits)), bits);
  assert.equal(pack([1, ...Array(63).fill(0)]), "0x0100000000000000");   // bit 0 = lowest bit of byte 0
  assert.equal(pack([...Array(63).fill(0), 1]), "0x0000000000000080");
});

test("layout is 64 bits and thermometer-valid", () => {
  const f: any = { ageDays: 45, txCount: 12, contracts: 4, counterparties: 30, funderCluster: 3, amountRepeat: 50,
    hourSpread: 5, gasSame: 85, burstShare: 20, balanceUsd: 250, isContract: false, hasName: false, fundedFromExchange: true, sweptToFunder: false };
  const b = toBits(f);
  assert.equal(b.length, N_BITS); assert.ok(isValid(b));
  assert.equal(levelOf(b, SLOTS[0]), 3);   // 45 days > 1, 7, 30
  assert.equal(describeLevel(FEATURES[0], 3), "wallet age: more than 30 days, at most 90 days");
  assert.ok(isValid(withLevel(b, SLOTS[0], 6)));
});

test("python and TS pack the fixture the same way", () => {
  const fx = JSON.parse(readFileSync("build/fixture.json", "utf8"));
  for (const v of fx.vectors) assert.equal(pack(unpack(v.bits)), v.bits);
});

const tx = (from: string, to: string, value: bigint, time: number, extra: Partial<Tx> = {}): Tx =>
  ({ hash: "0x", block: time, time, from, to, value, gasPrice: 1n, gasLimit: 21000n, hasData: false, ...extra });

test("funder cluster does not depend on who else is in the input list", () => {
  const F = "0xf0", txs = [tx(F, "0xa1", 5n, 1), tx(F, "0xa2", 5n, 2), tx(F, "0xa3", 5n, 3), tx("0xa1", "0xc0", 1n, 4, { hasData: true })];
  const h = buildHistory(txs);
  const cfg: Config = { chainId: 196, scanFromBlock: 0, windowStart: 0, windowEnd: 10, okbUsd: 0, usdt0: "0x0", usdt0Decimals: 6, exchanges: [] };
  const f = historyFeatures("0xa1", h, cfg, 86400 * 10);
  assert.equal(f.funderCluster, 3);   // counts all three wallets funded by F, from the whole index
  assert.equal(f.contracts, 1);
  assert.equal(f.counterparties, 2);
});

test("merkle trees are deterministic and proofs line up", () => {
  const rows = [{ bits: "0x0102030405060708" as const, label: 1 }, { bits: "0x1112131415161718" as const, label: 0 }];
  const a = testTree(rows), b = testTree(rows);
  assert.equal(a.root, b.root); assert.equal(a.leaves[1].index, 1);
  const s = snapshotTree([{ address: "0x00000000000000000000000000000000000000aa", bits: "0x0102030405060708", block: 5 }], 3, "0x00");
  assert.equal(s.campaignId, 3); assert.ok(s.wallets["0x00000000000000000000000000000000000000aa"]);
});

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { oklinkHistory, toTx } from "./history_oklink";

test("OKLink rows map to Tx (units, ms timestamps, fee as gas proxy)", () => {
  const t = toTx({ txId: "0xabc", height: "100", transactionTime: "1700000000000", from: "0xAA", to: "0xBB",
    amount: "1.5", txFee: "0.0001", methodId: "0xa9059cbb" });
  assert.equal(t.block, 100); assert.equal(t.time, 1700000000);
  assert.equal(t.value, 1500000000000000000n); assert.equal(t.gasPrice, 100000000000000n);
  assert.equal(t.from, "0xaa"); assert.ok(t.hasData);
});

test("OKLink history: paging, snapshot cut-off, population-independent funder count", async () => {
  process.chdir(mkdtempSync(`${tmpdir()}/okl-`));   // cache goes to a scratch dir
  const W = "0x00000000000000000000000000000000000000a1", F = "0x00000000000000000000000000000000000000f0";
  const row = (h: string, height: number, from: string, to: string, amount: string) =>
    ({ txId: h, height: String(height), transactionTime: String(height * 1000), from, to, amount, txFee: "0.00001", methodId: "" });
  const pages: Record<string, any[]> = {
    [W]: [row("0x1", 10, F, W, "1"), row("0x2", 20, W, F, "0.5"), row("0x9", 999, W, F, "9")],
    [F]: [row("0x1", 10, F, W, "1"), row("0x3", 11, F, "0xb2", "1"), row("0x4", 12, F, "0xb3", "1"), row("0x5", 13, F, "0xb3", "1")],
  };
  const fake = async (url: string) => {
    const a = new URL(url).searchParams.get("address")!;
    return { ok: true, status: 200, json: async () => ({ code: "0", msg: "", data: [{ totalPage: "1", transactionLists: pages[a] ?? [] }] }) };
  };
  const h = await oklinkHistory([W], 500, fake);
  assert.equal(h.txsOf(W).length, 2);           // block 999 is after the snapshot
  assert.equal(h.funderOf(W), F);
  assert.equal(h.funderCount(F), 3);            // F funded a1, b2, b3, wherever they are in the input list
});
