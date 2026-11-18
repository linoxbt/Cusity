"""Sybil-style cluster graph over the labelled wallets, after the methods used by airdrop hunters:

  * shared funding source        (LayerZero/Chaos Labs, Hop: "parent fund distribution" address)
  * shared collection address    (Hop: wallets sweeping to the same address)
  * direct transfers between wallets, then Louvain communities to split big groups (Arbitrum)
  * funding-time window: how tightly a cluster's first fundings bunch together (LayerZero used 24 h)

Exchanges, bridges and contracts are hubs, not owners, so they never connect wallets (Arbitrum removed
them before clustering too): a counterparty is a hub if it is a contract, its outgoing history is
exchange-scale (capped), or it touches more than HUB_DEGREE labelled wallets.

Reads the OKX history cache (data/raw/okx) and data/vectors.jsonl; writes web/public/graph/.
  python data/clusters.py
"""
import collections, glob, json, os, sys
import networkx as nx
from networkx.algorithms.community import louvain_communities

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "compiler"))
import tap02

HUB_DEGREE = 60          # a counterparty shared by more labelled wallets than this is a service, not a farm owner
WINDOW = 24 * 3600       # LayerZero-style funding window
OUT = "web/public/graph"

labels = {l.split(",")[0]: (int(l.split(",")[1]), l.split(",")[2]) for l in open("data/labels_public.csv").read().strip().split("\n")[1:]}
vec = {json.loads(l)["address"]: json.loads(l)["bits"] for l in open("data/vectors.jsonl")}
nl = json.load(open("build/cusity.netlist.json")); A, B = tap02.parse(nl["netlist"], 64)

def verdict(bits):
    o = tap02.outputs(tap02.run(A, B, 64, tap02.unpack(bits, 64)), 7)
    return o[0], sum(o[1 + k] << k for k in range(6)) - 32

hist, capped = {}, set()
for f in glob.glob("data/raw/okx/*.json"):
    a = os.path.basename(f)[:-5]
    j = json.load(open(f))
    if a.endswith(".from"):
        if j.get("capped"): capped.add(a[:-5])
        continue
    if a in labels: hist[a] = sorted(j["items"], key=lambda t: (int(t.get("height") or 0), t.get("txId", "")))

contracts, fund, coll, direct = set(), {}, collections.defaultdict(set), collections.defaultdict(int)
for a, items in hist.items():
    for t in items:
        fr, to = (t.get("from") or "").lower(), (t.get("to") or "").lower()
        amt = float(t.get("amount") or 0)
        if t.get("isToContract") and to: contracts.add(to)
        if t.get("isFromContract") and fr: contracts.add(fr)
        if amt <= 0: continue
        if to == a and a not in fund: fund[a] = (fr, int(t.get("transactionTime") or 0) // 1000)
        if fr == a and to and to != a:
            if to in labels: direct[tuple(sorted((a, to)))] += 1
            else: coll[to].add(a)

by_funder = collections.defaultdict(set)
for a, (f, _) in fund.items(): by_funder[f].add(a)
deg = collections.Counter()
for f, ws in by_funder.items(): deg[f] += len(ws)
for c, ws in coll.items(): deg[c] += len(ws)
hub = lambda x: x in contracts or x in capped or deg[x] > HUB_DEGREE

G = nx.Graph()
G.add_nodes_from(labels)
link = collections.defaultdict(list)   # wallet pair -> reasons
for f, ws in by_funder.items():
    if hub(f) or len(ws) < 2: continue
    ws = sorted(ws)
    for w in ws[1:]: G.add_edge(ws[0], w); link[(ws[0], w)].append(("funder", f))
for c, ws in coll.items():
    if hub(c) or len(ws) < 2: continue
    ws = sorted(ws)
    for w in ws[1:]: G.add_edge(ws[0], w); link[(ws[0], w)].append(("collector", c))
for (a, b), n in direct.items(): G.add_edge(a, b); link[(a, b)].append(("direct", None))

clusters = []
for comp in nx.connected_components(G):
    if len(comp) < 2: continue
    sub = G.subgraph(comp)
    parts = louvain_communities(sub, seed=0) if len(comp) > 40 else [comp]
    clusters.extend(p for p in parts if len(p) >= 2)
clusters.sort(key=len, reverse=True)

os.makedirs(f"{OUT}/c", exist_ok=True)
index, summary = {}, []
for cid, members in enumerate(clusters):
    members = sorted(members)
    mset = set(members)
    nodes, edges, inter = [], [], {}
    for w in members:
        v, m = verdict(vec[w])
        nodes.append({"id": w, "kind": "wallet", "label": labels[w][0], "src": labels[w][1], "v": v, "m": m})
        index[w] = cid
    for w in members:   # the funder / collector intermediaries that tie this cluster together
        f = fund.get(w, (None,))[0]
        if f and not hub(f) and len(by_funder[f] & mset) >= 2:
            inter.setdefault(f, "funder"); edges.append({"s": f, "t": w, "k": "funds"})
    for c, ws in coll.items():
        if hub(c): continue
        inside = ws & mset
        if len(inside) >= 2:
            inter.setdefault(c, "collector")
            edges += [{"s": w, "t": c, "k": "sweeps"} for w in sorted(inside)]
    for (a, b) in direct:
        if a in mset and b in mset: edges.append({"s": a, "t": b, "k": "direct"})
    nodes += [{"id": x, "kind": k} for x, k in inter.items()]
    ts = sorted(fund[w][1] for w in members if w in fund and fund[w][1])
    best = max((sum(1 for u in ts if t0 <= u <= t0 + WINDOW) for t0 in ts), default=0)
    stat = {"id": cid, "size": len(members), "bots": sum(labels[w][0] for w in members),
            "flagged": sum(n["v"] for n in nodes if n["kind"] == "wallet"),
            "funders": sum(1 for k in inter.values() if k == "funder"), "collectors": sum(1 for k in inter.values() if k == "collector"),
            "direct": sum(1 for e in edges if e["k"] == "direct"), "window24h": best}
    summary.append(stat)
    json.dump({"stats": stat, "nodes": nodes, "edges": edges}, open(f"{OUT}/c/{cid}.json", "w"))

json.dump({"wallets": index, "clusters": summary, "hubDegree": HUB_DEGREE}, open(f"{OUT}/index.json", "w"))

# what the clusters say about the labels (does clustering carry signal beyond the 64 bits?)
inc = [w for w in labels if w in index]; out = [w for w in labels if w not in index]
rate = lambda ws: sum(labels[w][0] for w in ws) / max(1, len(ws))
big = [w for w in inc if summary[index[w]]["size"] >= 20]
print(f"clusters: {len(clusters)} (largest {len(clusters[0]) if clusters else 0}); wallets in a cluster: {len(inc)}/{len(labels)}")
print(f"bot rate: in a cluster {rate(inc):.1%} | in a cluster of 20+ {rate(big):.1%} ({len(big)} wallets) | not clustered {rate(out):.1%}")
print(f"hubs excluded: {sum(1 for x in deg if hub(x))} (contracts {len(contracts)}, exchange-scale {len(capped)})")
for s in summary[:6]: print(s)
