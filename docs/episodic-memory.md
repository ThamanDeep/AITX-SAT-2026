# Episodic Memory → Recursive Self-Improvement → Teacher-Model Dataset

How the agent team turns every Discord interaction into (1) behavior change
today and (2) training data for a teacher model later. Companion to
`self-improving-review-judge.md` (the evaluation contract) and
`recursive_intelligence_evaluation.md` (day-1 benchmark).

## Pipeline: Observe → Distill → Remember → Export

### 1. Observe (already happening, zero new code)
OpenClaw records every session as JSONL transcripts inside the sandbox:
`/sandbox/.openclaw/agents/<agent>/sessions/*.jsonl` — user messages, agent
replies, tool calls, delegation chains. Discord reactions (👍/👎) on agent
messages are the explicit reward signal, fetched via the bot API at
distillation time.

### 2. Distill (nightly cron `episodic-memory-synthesis`, 05:00 UTC)
A scheduled main-agent turn reads the past day's transcripts and appends one
record per meaningful interaction to `memory/episodes.jsonl`:

```json
{"episode_id": "2026-07-19-001", "date": "2026-07-19", "channel": "gpu-desk",
 "task_type": "price_watch|review_audit|chat|coordination",
 "request": "one-line summary of what the user wanted",
 "agent_chain": ["main", "scout", "speculator"],
 "outcome": "what was delivered",
 "feedback": {"reactions": ["👍"], "user_followup": "accepted|corrected|ignored"},
 "quality": "good|bad|neutral",
 "lesson": "generalized takeaway, or null"}
```

Rules (enforced in the job prompt):
- Episodes are **summaries, never raw transcripts** — no tokens, no secrets,
  no message IDs beyond the channel name.
- A `lesson` is only written when there is a feedback signal to justify it
  (reaction, explicit correction, task success/failure) — never from the
  agent's unaudited self-opinion (same admission policy as Sage's memory).
- Benchmark items are never eligible as episodes (leakage guard).

### 3. Remember (the recursive part)
The same nightly job promotes durable lessons into the workspace `MEMORY.md`
under `## Learned lessons (episodic)` — capped at 30 bullets, merged/deduped,
contradictions reconciled. OpenClaw auto-loads MEMORY.md into main sessions,
so **yesterday's lessons are in today's context**: behavior changes without
touching weights (Reflexion-style verbal RL). `memory/` is git-friendly —
snapshot it per benchmark version so every scorecard pins the exact memory
it ran with (`benchmarks/results/vK` ↔ memory snapshot K).

### 4. Export (feeding the teacher model)
`scripts/export_teacher_dataset.py` converts `episodes.jsonl` into
NeMo-ready training files:
- **SFT set**: `{"input": request+context, "output": outcome}` for
  `quality=good` episodes.
- **Preference set (DPO/RLHF)**: `{"prompt": ..., "chosen": ..., "rejected": ...}`
  pairing good vs. bad outcomes on similar `task_type`s.
The teacher model (e.g. a Nemotron fine-tune via NeMo) distills the accumulated
judgment; the hackathon story is the pipeline, not the training run.

## Proving improvement (unchanged contract)
The frozen benchmark (`benchmarks/run_benchmark.py --memory <lessons>`) is
re-scored per memory version; memory-ON vs memory-OFF is the claim, McNemar
p<0.05 the bar. Episodes make the lessons; the benchmark keeps them honest.

## Ops
- Cron job `episodic-memory-synthesis`, `0 5 * * *` UTC (midnight CDT), agent
  `main`, created alongside `gpu-daily-watch` on the EC2 gateway.
- Files live in the sandbox workspace (`memory/episodes.jsonl`, `MEMORY.md`)
  and survive rebuilds (workspace persistence).
- July 20 self-stop backup already archives the whole workspace, episodes
  included.
