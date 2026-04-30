---
name: stripe-refund-auditor
description: Audits Stripe refunds over a date range to surface anomalies (refund-rate spikes, missing reasons, duplicate refunds). Activates when the user asks to "audit refunds", "check Stripe refund anomalies", or "review refund activity".
version: 1.0.0
allowed-tools: Bash, Read, Write
mcp-deps: [stripe]
secrets: [STRIPE_API_KEY]
runtime-python: ">=3.10"
runtime-pip: [stripe>=8, pydantic>=2]
integration-runner: pytest
integration-file: tests/integration_test.py
integration-requires: [STRIPE_API_KEY]
metadata:
  category: finance
  tags:
    - stripe
    - finance
    - audit
---

# /stripe-refund-auditor

Audit Stripe refunds over a date range to surface anomalies — refund-rate spikes,
missing reasons, suspicious duplicates — and emit a markdown report.

## When to use

Trigger when the user asks any of:
- "Audit our Stripe refunds for the last 30 days"
- "Check refund anomalies in Stripe"
- "Review refund activity since {date}"

## What this skill does

1. Read `STRIPE_API_KEY` from the environment (or `.env.local` next to this skill).
2. Run `scripts/audit.py` with the requested date range. The script paginates
   through `/v1/refunds` and emits a JSON record per refund.
3. Run `scripts/grader.py` over the JSON output to compute a deterministic
   anomaly score in `[0, 1]`.
4. Render a markdown report listing the highest-scoring anomalies with their
   `id`, `amount`, `currency`, `status`, and `reason`.

## Files in this skill

- `scripts/audit.py` — the deterministic refund-pull + anomaly-detection helper.
- `scripts/grader.py` — pure-function grader producing a 0..1 numeric score.
- `tests/integration_test.py` — pytest integration test (skipped without `STRIPE_API_KEY`).
- `references/refund-schema.md` — Stripe Refund object field reference.
- `evals/evals.json` — LLM-judged behavioral evaluation cases.
- `.env.example` — placeholder template; copy to `.env.local` and fill in real values.

## Preflight

Before invoking, run `vskill check stripe-refund-auditor` to verify:
- The Stripe MCP server is configured in your Claude config.
- `STRIPE_API_KEY` is resolvable from env or `.env.local`.
- Python `>=3.10` is on PATH.
- `pytest --collect-only tests/` succeeds.

## Step 1 — Pull refunds. Run this immediately:

```bash
python3 scripts/audit.py --since "$(date -u -v-30d +%Y-%m-%d)" --until "$(date -u +%Y-%m-%d)" > /tmp/refunds.jsonl
```

## Step 2 — Score anomalies. Run this immediately:

```bash
python3 scripts/grader.py /tmp/refunds.jsonl > /tmp/refund-scores.json
```

## Step 3 — Render the report. Run this immediately:

```bash
python3 -c "import json,sys; data=json.load(open('/tmp/refund-scores.json')); print(json.dumps({'top_anomalies': data['anomalies'][:10], 'score': data['overall_score']}, indent=2))"
```

The skill's caller is expected to take the JSON from Step 3 and turn it into
prose. See `references/refund-schema.md` for the underlying field semantics.

## Failure modes

- **`STRIPE_API_KEY` missing** → `audit.py` exits with code 2 and prints a
  diagnostic line. Run `vskill check stripe-refund-auditor` to see which env
  source is searched.
- **Empty result set** → `grader.py` returns `{"overall_score": 0.0, "anomalies": []}`.
- **Network failure** → `audit.py` exits non-zero and the message includes the
  underlying HTTP status. Re-run after fixing connectivity.
