#!/usr/bin/env python3
"""Pull Stripe refunds for a date range and emit one JSON record per line.

Reads STRIPE_API_KEY from the environment. Degrades gracefully when missing —
prints a diagnostic line and exits 2 rather than crashing on import.

Output: JSONL on stdout. Each line is a flattened refund record with the
fields documented in references/refund-schema.md.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime
from typing import Iterator


def _eprint(msg: str) -> None:
    print(msg, file=sys.stderr)


def parse_iso(value: str) -> int:
    """Convert an ISO-8601 date (YYYY-MM-DD) to a Unix timestamp."""
    return int(datetime.strptime(value, "%Y-%m-%d").timestamp())


def iter_refunds(api_key: str, since: int, until: int) -> Iterator[dict]:
    """Paginate Stripe /v1/refunds. Imported lazily so module import never fails
    just because the `stripe` pip package is not installed in CI."""
    try:
        import stripe  # type: ignore
    except ImportError:
        _eprint("stripe package not installed; run: pip install 'stripe>=8'")
        sys.exit(3)
    stripe.api_key = api_key
    starting_after = None
    while True:
        kwargs = {"limit": 100, "created": {"gte": since, "lte": until}}
        if starting_after:
            kwargs["starting_after"] = starting_after
        page = stripe.Refund.list(**kwargs)
        for r in page.data:
            yield {
                "id": r.id,
                "amount": r.amount,
                "currency": r.currency,
                "status": r.status,
                "reason": getattr(r, "reason", None),
                "charge": getattr(r, "charge", None),
                "created": r.created,
                "metadata": dict(getattr(r, "metadata", {}) or {}),
            }
        if not page.has_more:
            break
        starting_after = page.data[-1].id


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit Stripe refunds over a date range.")
    parser.add_argument("--since", required=True, help="ISO date (YYYY-MM-DD).")
    parser.add_argument("--until", required=True, help="ISO date (YYYY-MM-DD).")
    args = parser.parse_args()

    api_key = os.environ.get("STRIPE_API_KEY")
    if not api_key:
        _eprint("STRIPE_API_KEY not set in environment or .env.local")
        return 2
    try:
        since = parse_iso(args.since)
        until = parse_iso(args.until)
    except ValueError as e:
        _eprint(f"invalid date: {e}")
        return 2
    if since > until:
        _eprint("--since is after --until")
        return 2

    try:
        for record in iter_refunds(api_key, since, until):
            print(json.dumps(record))
    except Exception as e:  # noqa: BLE001 — surface the underlying HTTP error
        _eprint(f"stripe call failed: {e}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
