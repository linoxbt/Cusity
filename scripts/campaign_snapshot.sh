#!/usr/bin/env bash
# A campaign's own snapshot: extract its entrants at its snapshot block with the committed extractor, build
# the positional tree, and write the shards + list.json the site serves (and publishVectors points to).
#   scripts/campaign_snapshot.sh <entrants.csv> <snapshotBlock> <campaignId>
# entrants.csv: one address per line (a header line is fine). Needs OKX_* keys in .env for uncached histories.
set -euo pipefail
cd "$(dirname "$0")/.."
W=${1:?usage: campaign_snapshot.sh <entrants.csv> <snapshotBlock> <campaignId>}; BLOCK=${2:?}; CID=${3:?}
ENVF=$([ -f .env ] && echo "--env-file=.env" || true)
npx tsx $ENVF data/extract.ts --wallets "$W" --block "$BLOCK" --out build/campaign_vectors.jsonl
npx tsx data/merkle.ts snapshot build/campaign_vectors.jsonl "$CID" build/campaign_snapshot.json
npx tsx scripts/shard_snapshot.ts build/campaign_snapshot.json web/public/snapshot
echo "next: STEP=publish forge script script/Campaign.s.sol ... (reads web/public/snapshot/index.json), then redeploy the site"
