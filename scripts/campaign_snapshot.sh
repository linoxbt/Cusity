#!/usr/bin/env bash
# A campaign's own snapshot: extract its entrants at its snapshot block with the committed extractor, build
# the positional tree, and write the shards + list.json the site serves (and publishVectors points to).
# This REPLACES the shipped demo snapshot in web/public/snapshot: the live site then checks campaign entrants.
#   scripts/campaign_snapshot.sh <entrants.csv> <snapshotBlock> <campaignId>
# entrants.csv: one address per line (a header line is fine). Needs OKX_* keys in .env for uncached histories.
set -euo pipefail
cd "$(dirname "$0")/.."
W=${1:?usage: campaign_snapshot.sh <entrants.csv> <snapshotBlock> <campaignId>}; BLOCK=${2:?}; CID=${3:?}
ENVF=$([ -f .env ] && echo "--env-file=.env" || true)
# first column only, lower-cased and de-duplicated (a duplicate would abort the tree after a paid extraction)
cut -d, -f1 "$W" | tr -d '"\r ' | tr 'A-F' 'a-f' | grep -E '^0x[0-9a-f]{40}$' | sort -u > build/campaign_entrants.csv
echo "$(wc -l < build/campaign_entrants.csv) unique entrants"
npx tsx $ENVF data/extract.ts --wallets build/campaign_entrants.csv --block "$BLOCK" --out build/campaign_vectors.jsonl
npx tsx data/merkle.ts snapshot build/campaign_vectors.jsonl "$CID" build/campaign_snapshot.json
npx tsx scripts/shard_snapshot.ts build/campaign_snapshot.json web/public/snapshot
# every input the extractor read, so anyone can recompute every row offline (scripts/verify_snapshot.sh)
npx tsx scripts/pack_inputs.ts "$BLOCK" web/public/snapshot/inputs.json.gz
scripts/verify_snapshot.sh web/public/snapshot/inputs.json.gz web/public/snapshot/list.json
echo "next: STEP=publish forge script script/Campaign.s.sol ... (reads web/public/snapshot/index.json), then redeploy the site"
