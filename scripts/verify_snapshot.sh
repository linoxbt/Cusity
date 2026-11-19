#!/usr/bin/env bash
# Recompute every wallet's 64 bits from the published inputs with the committed extractor, OFFLINE (no API keys,
# a dead RPC address), and compare with the published snapshot list. Anyone can run this against a campaign:
#   scripts/verify_snapshot.sh <inputs.json.gz> <list.json> [git-ref]
# It works in a throwaway checkout, so your own data/raw is untouched.
set -euo pipefail
IN=$(realpath "$1"); LIST=$(realpath "$2"); REF=${3:-HEAD}
ROOT=$(cd "$(dirname "$0")/.." && pwd); T=$(mktemp -d)
git -C "$ROOT" worktree add -q --detach "$T/w" "$REF"
trap 'git -C "$ROOT" worktree remove --force "$T/w"; rm -rf "$T"' EXIT
cd "$T/w" && ln -s "$ROOT/node_modules" node_modules
npx tsx "$ROOT/scripts/unpack_inputs.ts" "$IN"
BLOCK=$(python3 -c "import gzip,json;print(json.load(gzip.open('$IN'))['block'])")
python3 -c "import json;print('address');[print(w) for w,_ in json.load(open('$LIST'))['list']]" > "$T/wallets.csv"
env -u OKX_API_KEY -u OKX_SECRET_KEY -u OKX_PASSPHRASE XLAYER_RPC=http://127.0.0.1:9 \
  npx tsx data/extract.ts --wallets "$T/wallets.csv" --block "$BLOCK" --out "$T/vectors.jsonl"
python3 - "$T/vectors.jsonl" "$LIST" <<'PY'
import json, sys
got = {json.loads(l)["address"]: json.loads(l)["bits"] for l in open(sys.argv[1])}
pub = {w: b for w, b in json.load(open(sys.argv[2]))["list"]}
bad = [w for w in pub if got.get(w) != pub[w]]
print(f"{len(pub) - len(bad)}/{len(pub)} wallets recomputed to the published bits")
sys.exit(1 if bad else 0)
PY
