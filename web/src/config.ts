// Fill in after deployment (docs/ONCHAIN.md, "Site"). Live mode switches on only when every on-chain field
// is set; until then the site runs in demo mode: the current circuit (build/cusity.netlist.json) is
// evaluated in the browser on the published snapshot.
export const ZERO = "0x0000000000000000000000000000000000000000" as const;

export const CONFIG = {
  rpc: ["https://rpc.xlayer.tech", "https://xlayerrpc.okx.com", "https://xlayer.drpc.org"],   // all allow browser CORS
  chainId: 196,
  explorer: "https://www.oklink.com/x-layer",
  registry: ZERO as `0x${string}`,
  campaign: ZERO as `0x${string}`,
  campaignId: 0n,
  audit: ZERO as `0x${string}`,
  auditK: 16,                               // rows per round in demo mode (live mode reads K() from the contract)
  snapshotUrl: "./snapshot/",               // sharded snapshot (scripts/shard_snapshot.ts), shipped with the site
  testLeavesUrl: "./test_leaves.json",
  appealsUrl: "https://github.com/linoxbt/cusity/issues/new",   // public appeals: an issue with the wallet and its bits
  // Files that don't go on chain with the DeWEB build (too big, or no DeWEB content type) are linked from GitHub
  // there; the inputs bundle's sha256 ships with the site (snapshot/inputs.sha256.txt) so the copy can be checked.
  offchainBase: (import.meta.env.VITE_OFFCHAIN_BASE as string | undefined) ?? "./",
};

const set = (a: string) => a !== ZERO;
/** Live only when all three contracts are configured: a half-filled config stays in demo mode. */
export const LIVE = set(CONFIG.registry) && set(CONFIG.campaign) && set(CONFIG.audit);
