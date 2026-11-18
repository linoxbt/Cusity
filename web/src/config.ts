// Fill in after deployment (scripts/onchain.md). While `campaign` is the zero address the site runs
// in demo mode: the toy circuit is evaluated in the browser from build/toy.netlist.json.
export const ZERO = "0x0000000000000000000000000000000000000000" as const;

export const CONFIG = {
  rpc: ["https://rpc.xlayer.tech"],
  chainId: 196,
  explorer: "https://www.oklink.com/x-layer",
  processor: ZERO as `0x${string}`,
  circuitId: 0n,
  modelId: 0n,
  registry: ZERO as `0x${string}`,
  campaign: ZERO as `0x${string}`,
  campaignId: 0n,
  audit: ZERO as `0x${string}`,
  snapshotUrl: "./snapshot_vectors.json",   // shipped inside the same DeWEB site
  testLeavesUrl: "./test_leaves.json",
  containerId: "",                          // the model's Circuit Container, for TapeSend appeals
};

export const LIVE = CONFIG.campaign !== ZERO;
