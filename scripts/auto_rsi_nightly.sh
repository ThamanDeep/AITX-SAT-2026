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

# Optional: log this cycle to the coordinator API so both RSI tracks share
# one pane of glass. Failures never break the cycle. COORDINATOR_TOKEN adds
# the bearer header once the Railway service sets one.
if [ -n "${COORDINATOR_URL:-}" ]; then
  AUTH=(); [ -n "${COORDINATOR_TOKEN:-}" ] && AUTH=(-H "Authorization: Bearer $COORDINATOR_TOKEN")
  python3 - "$RESULTS" "$VERSION" <<'PYEOF' > /tmp/rsi-eval-post.json
import json,sys
rows=[json.loads(l) for l in open(sys.argv[1]) if l.strip()]
valid=[r for r in rows if not r.get("error")]
rw=[float(r.get("reward",0)) for r in valid] or [0]
print(json.dumps({"version":sys.argv[2],"source":"ec2-episodic-memory-track",
  "decision_quality":round(sum(rw)/len(rw),4),"n_valid":len(valid),"n_total":len(rows)}))
PYEOF
  curl -s -m 15 "${AUTH[@]}" -H "Content-Type: application/json" \
    -d @/tmp/rsi-eval-post.json "${COORDINATOR_URL%/}/api/evaluations" >/dev/null \
    && echo "coordinator: eval row uploaded" || echo "coordinator unreachable (non-fatal)"
  EPISODES=/tmp/rsi-episodes-post.json
  docker cp "$C:/sandbox/.openclaw/workspace/memory/episodes.jsonl" /tmp/episodes.jsonl 2>/dev/null && \
    python3 -c "import json,sys; rows=[json.loads(l) for l in open('/tmp/episodes.jsonl') if l.strip()]; json.dump(rows[-20:], open('$EPISODES','w'))" && \
    curl -s -m 15 "${AUTH[@]}" -H "Content-Type: application/json" \
      -d @"$EPISODES" "${COORDINATOR_URL%/}/api/episodic-memory" >/dev/null \
    && echo "coordinator: recent episodes uploaded" || echo "coordinator episodes upload skipped"
fi
echo "candidate recorded; champion unchanged pending a human Discord decision"
