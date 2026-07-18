# Verifiers results → dashboard + video

The reliable pipeline is:

`Verifiers RolloutOutput → aggregate CSV → dashboard API / Remotion video`

The CSV is the shared source of truth. The dashboard reads it on every refresh; the video agent receives the same CSV and a strict prompt.

## 1. Record the metrics in Verifiers

Use the policy score as a weighted reward and record the diagnostic values as zero-weight metrics:

```python
rubric = vf.Rubric()
rubric.add_reward_func(decision_quality, weight=1.0)
rubric.add_metric(landed_price_error_pct)
rubric.add_metric(valid_url_rate_pct)
rubric.add_metric(unsupported_claims_pct)
rubric.add_metric(price_forecast_regret_usd)
```

Verifiers includes reward, metrics, and `timing.total_ms` in each `RolloutOutput`. Save evaluation results with:

```bash
prime eval run your-environment -m your-model --save-results
```

References: [environments and rubric metrics](https://docs.primeintellect.ai/verifiers/environments), [RolloutOutput fields](https://docs.primeintellect.ai/verifiers/reference), [evaluation result files](https://docs.primeintellect.ai/tutorials-environments/evaluating).

## 2. Start the measured history

Use `--reset` once to replace the illustrative fixture with the first measured champion:

```bash
python3 scripts/verifiers_to_rsi_csv.py outputs/baseline-results.jsonl \
  --output data/rsi_runs.csv \
  --run-id baseline-v1.4 \
  --version v1.4 \
  --policy-change "Measured baseline" \
  --teacher-model Nemotron \
  --accepted true \
  --baseline true \
  --current true \
  --reset
```

Then add each evaluated candidate:

```bash
python3 scripts/verifiers_to_rsi_csv.py outputs/results.jsonl \
  --output data/rsi_runs.csv \
  --run-id overnight-2026-07-19-v1.5 \
  --version v1.5 \
  --parent-version v1.4 \
  --policy-change "URL health verifier and source diversity" \
  --teacher-model Nemotron \
  --accepted true \
  --current true
```

The adapter calculates mean 95% confidence intervals for quality metrics and a deterministic bootstrap interval for median latency. Promotion remains explicit: the script never decides whether a candidate is accepted.

The dashboard’s **Refresh history** action now reloads `data/rsi_runs.csv`.

## 3. Prepare a video-agent package

```bash
python3 scripts/prepare_rsi_story.py data/rsi_runs.csv \
  --json-out artifacts/rsi-story.json \
  --prompt-template prompts/rsi_video_from_csv.md \
  --prompt-out artifacts/rsi-video-prompt.md \
  --project-name "Decision Frontier" \
  --teacher-model Nemotron
```

Attach `data/rsi_runs.csv` and paste `artifacts/rsi-video-prompt.md` into a coding agent that can use Remotion. Code rendering is important: it preserves exact tables, labels, and values. Remotion accepts JSON input props and renders the composition programmatically: [renderMedia](https://www.remotion.dev/docs/renderer/render-media), [data-driven compositions](https://www.remotion.dev/docs/data-fetching).

The checked-in CSV is illustrative. Replace it with measured rows after the first overnight evaluation.
