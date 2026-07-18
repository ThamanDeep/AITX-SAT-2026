#!/usr/bin/env bash
# Nightly RSI evaluation cycle (EC2 host cron, 05:30 UTC — right after
# the 05:00 memory distillation):
#   1. snapshot tonight's lessons out of the sandbox
#   2. vf-eval rollouts with lessons injected (memory ON)
#   3. append the measured challenger with accepted=false
#   4. request a human promote/keep decision in Discord
# The cron never changes the champion.
set -euo pipefail
exec >> /opt/aitx/rsi-cycles.log 2>&1
echo "=== RSI cycle $(date -u +%FT%TZ) ==="

REPO=/opt/aitx/repo
cd "$REPO"
set -a; . deploy/docker-compose/.env; set +a
export OPENAI_API_KEY="${NVIDIA_INFERENCE_API_KEY:?}"
export GOLDEN_DATASET="$REPO/scripts/golden_dataset.json"
export PATH="/root/.local/bin:$PATH"

C=$(docker ps --format '{{.Names}}' | grep openshell- | head -1)
[ -n "$C" ] || { echo "no sandbox running; abort"; exit 1; }

mkdir -p /opt/aitx/memory
VERSION="auto-$(date -u +%Y%m%d)"
LESSONS=/opt/aitx/memory/lessons-$VERSION.md

docker cp "$C:/sandbox/.openclaw/workspace/MEMORY.md" "$LESSONS" 2>/dev/null || echo "" > "$LESSONS"
echo "lessons snapshot: $LESSONS ($(wc -l < "$LESSONS") lines)"

cd "$REPO/environments/gpu_deal_judge"
uv run --with verifiers --with . vf-eval gpu-deal-judge \
  -m "nvidia/nemotron-3-super-120b-a12b" \
  -b "https://integrate.api.nvidia.com/v1" -k OPENAI_API_KEY \
  -n 15 -r 3 -s --env-args "{\"memory_file\": \"$LESSONS\"}" || { echo "eval failed"; exit 1; }

RESULTS=$(ls -t "$PWD"/outputs/evals/*/*/results.jsonl | head -1)
cd "$REPO"
python3 scripts/verifiers_to_rsi_csv.py "$RESULTS" \
  --output data/rsi_runs.csv \
  --run-id "$VERSION-$(date -u +%H%M)" \
  --version "$VERSION" \
  --parent-version "$(python3 -c 'import csv; r=list(csv.DictReader(open("data/rsi_runs.csv"))); print(next(x["version"] for x in reversed(r) if x["current"]=="true"))')" \
  --policy-change "Nightly lessons $(date -u +%F)" \
  --teacher-model Nemotron \
  --accepted false \
  --current false
python3 scripts/post_rsi_discord.py

# Optional: notify the coordinator API (friend's Railway service) so both RSI
# tracks log in one place. Read-only trigger; failures never break the cycle.
if [ -n "${COORDINATOR_URL:-}" ]; then
  curl -s -m 15 "${COORDINATOR_URL%/}/api/run-research" >/dev/null \
    && echo "coordinator notified: run-research triggered" \
    || echo "coordinator unreachable (non-fatal)"
fi
echo "candidate recorded; champion unchanged pending a human Discord decision"
