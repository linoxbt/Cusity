import { createPublicClient, defineChain, fallback, http } from "viem";

export const RPCS = [process.env.XLAYER_RPC ?? "https://rpc.xlayer.tech", process.env.XLAYER_RPC_2].filter(Boolean) as string[];

export const xlayer = defineChain({
  id: 196, name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: RPCS } },
});

// Fall back across several RPCs: the public ones cap eth_getLogs ranges and sometimes hang.
// No JSON-RPC batching: rpc.xlayer.tech rejects batches ("too many RPC calls in batch request").
export const client = createPublicClient({
  chain: xlayer,
  transport: fallback(RPCS.map(u => http(u, { timeout: 20_000, retryCount: 3 })), { rank: false }),
});
