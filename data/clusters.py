"""Sybil-style cluster graph over the labelled wallets, after the methods used by airdrop hunters:

  * shared funding source        (LayerZero/Chaos Labs, Hop: "parent fund distribution" address)
  * shared collection address    (Hop: wallets sweeping to the same address)
  * direct transfers between wallets, then Louvain communities to split big groups (Arbitrum)
  * funding-time window: how tightly a cluster's first fundings bunch together (LayerZero used 24 h)

Exchanges, bridges and contracts are hubs, not owners, so they never connect wallets (Arbitrum removed
them before clustering too): a counterparty is a hub if it is a contract, its own history is exchange-scale
(its outgoing or incoming list hit the 1,000-tx cap), or it touches more than HUB_DEGREE labelled wallets.
Amounts and failed transactions follow the extractor's rules (data/history_okx.ts).

Reads the OKX history cache (data/raw/okx/<block>) and data/vectors.jsonl; writes web/public/graph/.
  python data/clusters.py [block]
"""
import collections, glob, json, os, sys
import networkx as nx
from networkx.algorithms.community import louvain_communities

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "compiler"))
import tap02

HUB_DEGREE = 60          # a counterparty shared by more labelled wallets than this is a service, not a farm owner
WINDOW = 24 * 3600       # LayerZero-style funding window
OUT = "web/public/graph"
ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
GROUPS_ONLY = "--groups" in sys.argv   # just write build/groups.json (connected components) for model/split.py
BLOCK = ARGS[0] if ARGS else str(json.loads(open("data/vectors.jsonl").readline())["block"])
OKB_UNTIL, WEI_FROM = 10_434_920, 10_438_885   # = OKX_OKB_UNTIL_BLOCK / OKX_WEI_FROM_BLOCK in data/history_okx.ts

def okb(t):
    """Amount in OKB, by the extractor's rule; failed transactions moved nothing."""
    a = t.get("amount") or "0"; h = int(t.get("height") or 0)
    if t.get("state") == "fail": return 0.0
    if "." in a or h <= OKB_UNTIL or (h < WEI_FROM and len(a) < 10): return float(a)
    return int(a) / 1e18

def wilson(k, n, z=1.96):
    if n == 0: return (0.0, 0.0)
    p = k / n; d = 1 + z * z / n; c = p + z * z / (2 * n); r = z * ((p * (1 - p) + z * z / (4 * n)) / n) ** .5
    return ((c - r) / d, (c + r) / d)

labels = {l.split(",")[0]: (int(l.split(",")[1]), l.split(",")[2]) for l in open("data/labels_public.csv").read().strip().split("\n")[1:]}
vec = {json.loads(l)["address"]: json.loads(l)["bits"] for l in open("data/vectors.jsonl")}

def verdict(bits):
    o = tap02.outputs(tap02.run(A, B, 64, tap02.unpack(bits, 64)), 7)
    return o[0], sum(o[1 + k] << k for k in range(6)) - 32

hist, capped = {}, set()
for f in glob.glob(f"data/raw/okx/{BLOCK}/*.json"):
    a = os.path.basename(f)[:-5]
    j = json.load(open(f))
    if a.endswith(".from") or a.endswith(".to"):
        if j.get("capped"): capped.add(a.rsplit(".", 1)[0])
        continue
    if a in labels: hist[a] = sorted(j["items"], key=lambda t: (int(t.get("height") or 0), t.get("txId", "")))

contracts, fund, coll, direct = set(), {}, collections.defaultdict(set), collections.defaultdict(int)
amount = collections.defaultdict(float)   # (from, to) -> OKB moved, for the graph's edge labels
for a, items in hist.items():
    for t in items:
        fr, to = (t.get("from") or "").lower(), (t.get("to") or "").lower()
        amt = okb(t)
        if t.get("isToContract") and to: contracts.add(to)
        if t.get("isFromContract") and fr: contracts.add(fr)
        if amt <= 0: continue
        if (fr == a or to == a) and fr and to: amount[(fr, to)] += amt if fr == a else 0
        if to == a and a not in fund: fund[a] = (fr, int(t.get("transactionTime") or 0) // 1000); amount[(fr, a)] += amt
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

if GROUPS_ONLY:   # every link (shared funder, shared collector, direct transfer) keeps wallets in one split
    groups = {w: i for i, comp in enumerate(sorted(nx.connected_components(G), key=lambda c: min(c))) for w in comp}
    json.dump(groups, open("build/groups.json", "w"))
    print(f"groups: {len(set(groups.values()))} components over {len(groups)} wallets (largest {max(map(len, nx.connected_components(G)))})")
    sys.exit()
nl = json.load(open("build/cusity.netlist.json")); A, B = tap02.parse(nl["netlist"], 64)

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
            inter.setdefault(f, "funder"); edges.append({"s": f, "t": w, "k": "funds", "okb": round(amount[(f, w)], 6)})
    for c, ws in coll.items():
        if hub(c): continue
        inside = ws & mset
        if len(inside) >= 2:
            inter.setdefault(c, "collector")
            edges += [{"s": w, "t": c, "k": "sweeps", "okb": round(amount[(w, c)], 6)} for w in sorted(inside)]
    for (a, b) in direct:
        if a in mset and b in mset: edges.append({"s": a, "t": b, "k": "direct", "n": direct[(a, b)], "okb": round(amount[(a, b)] + amount[(b, a)], 6)})
    nodes += [{"id": x, "kind": k} for x, k in inter.items()]
    ts = sorted(fund[w][1] for w in members if w in fund and fund[w][1])
    best = max((sum(1 for u in ts if t0 <= u <= t0 + WINDOW) for t0 in ts), default=0)
    stat = {"id": cid, "size": len(members), "bots": sum(labels[w][0] for w in members),
            "flagged": sum(n["v"] for n in nodes if n["kind"] == "wallet"),
            "funders": sum(1 for k in inter.values() if k == "funder"), "collectors": sum(1 for k in inter.values() if k == "collector"),
            "direct": sum(1 for e in edges if e["k"] == "direct"), "window24h": best}
    summary.append(stat)
    json.dump({"stats": stat, "nodes": nodes, "edges": edges}, open(f"{OUT}/c/{cid}.json", "w"))

# what the clusters say about the labels (does clustering carry signal beyond the 64 bits?), with 95% CIs
inc = [w for w in labels if w in index]; out = [w for w in labels if w not in index]
bots = lambda ws: sum(labels[w][0] for w in ws)
ci_in, ci_out = wilson(bots(inc), len(inc)), wilson(bots(out), len(out))
evidence = {"inCluster": {"n": len(inc), "botRate": bots(inc) / max(1, len(inc)), "ci95": ci_in},
            "notClustered": {"n": len(out), "botRate": bots(out) / max(1, len(out)), "ci95": ci_out}}
json.dump({"wallets": index, "clusters": summary, "hubDegree": HUB_DEGREE, "evidence": evidence}, open(f"{OUT}/index.json", "w"))
print(f"clusters: {len(clusters)} (largest {len(clusters[0]) if clusters else 0}); wallets in a cluster: {len(inc)}/{len(labels)}")
print(f"bot rate: in a cluster {evidence['inCluster']['botRate']:.1%} (95% CI {ci_in[0]:.1%}-{ci_in[1]:.1%}) | not clustered {evidence['notClustered']['botRate']:.1%} (95% CI {ci_out[0]:.1%}-{ci_out[1]:.1%})")
print(f"hubs excluded: {sum(1 for x in deg if hub(x))} (contracts {len(contracts)}, exchange-scale {len(capped)})")
for s in summary[:6]: print(s)
