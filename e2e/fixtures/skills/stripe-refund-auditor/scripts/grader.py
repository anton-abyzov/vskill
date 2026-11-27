#!/usr/bin/env python3
"""Deterministic anomaly grader for Stripe refund records.

Pure function: takes a JSONL file (output of audit.py) on the command line and
emits a JSON object with `overall_score` (float in [0, 1]) and `anomalies`
(list of records with the highest individual scores).

No network calls, no env reads. Same input → same output.
"""
from __future__ import annotations

import json
import sys
from typing import Iterable


# Heuristic weights — tuned for "noticeable but not paranoid" anomaly thresholds.
# Each weight contributes additively to the per-record score and is clamped at 1.0.
W_MISSING_REASON = 0.30
W_DUPLICATE_CHARGE = 0.40
W_LARGE_AMOUNT = 0.20  # > 100,000 cents = $1,000
W_FAILED_STATUS = 0.30
LARGE_AMOUNT_THRESHOLD_CENTS = 100_000


def score_record(rec: dict, charges_seen: dict[str, int]) -> float:
    """Return a 0..1 anomaly score for a single refund record."""
    score = 0.0
    if not rec.get("reason"):
        score += W_MISSING_REASON
    charge = rec.get("charge")
    if charge and charges_seen.get(charge, 0) > 1:
        score += W_DUPLICATE_CHARGE
    if isinstance(rec.get("amount"), int) and rec["amount"] > LARGE_AMOUNT_THRESHOLD_CENTS:
        score += W_LARGE_AMOUNT
    if rec.get("status") == "failed":
        score += W_FAILED_STATUS
    return min(score, 1.0)


def grade(records: Iterable[dict]) -> dict:
    """Score a list of refund records and return summary + top anomalies."""
    rec_list = list(records)
    if not rec_list:
        return {"overall_score": 0.0, "anomalies": [], "count": 0}
    # First pass: count charges to detect duplicates.
    charges_seen: dict[str, int] = {}
    for r in rec_list:
        charge = r.get("charge")
        if charge:
            charges_seen[charge] = charges_seen.get(charge, 0) + 1
    scored: list[dict] = []
    total = 0.0
    for r in rec_list:
        s = score_record(r, charges_seen)
        scored.append({**r, "anomaly_score": round(s, 3)})
        total += s
    scored.sort(key=lambda x: x["anomaly_score"], reverse=True)
    return {
        "overall_score": round(total / len(rec_list), 3),
        "anomalies": [r for r in scored if r["anomaly_score"] > 0.0],
        "count": len(rec_list),
    }


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: grader.py <refunds.jsonl>", file=sys.stderr)
        return 2
    try:
        with open(argv[1], "r", encoding="utf-8") as fh:
            records = [json.loads(line) for line in fh if line.strip()]
    except OSError as e:
        print(f"could not read input: {e}", file=sys.stderr)
        return 1
    result = grade(records)
    json.dump(result, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
