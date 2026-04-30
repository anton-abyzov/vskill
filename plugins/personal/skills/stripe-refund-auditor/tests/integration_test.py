"""Integration test for stripe-refund-auditor.

Skipped when STRIPE_API_KEY is unset, so CI without secrets stays green. When
the env var is present we exercise the audit script against Stripe's test
mode endpoints — never production data.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest


SKILL_DIR = Path(__file__).resolve().parent.parent
AUDIT_PY = SKILL_DIR / "scripts" / "audit.py"
GRADER_PY = SKILL_DIR / "scripts" / "grader.py"


@pytest.fixture(scope="module")
def stripe_key() -> str:
    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        pytest.skip("STRIPE_API_KEY not set — skipping integration test")
    if not key.startswith("sk_test_"):
        pytest.skip("STRIPE_API_KEY is not a test-mode key (sk_test_*) — skipping for safety")
    return key


def test_audit_exits_2_without_env(monkeypatch, tmp_path):
    """Without STRIPE_API_KEY the script must exit 2 with a clear message."""
    monkeypatch.delenv("STRIPE_API_KEY", raising=False)
    result = subprocess.run(
        [sys.executable, str(AUDIT_PY), "--since", "2026-01-01", "--until", "2026-01-31"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 2
    assert "STRIPE_API_KEY" in result.stderr


def test_grader_pure_function_empty_input(tmp_path):
    """grader.py must produce a deterministic empty-input result without env access."""
    empty = tmp_path / "empty.jsonl"
    empty.write_text("")
    result = subprocess.run(
        [sys.executable, str(GRADER_PY), str(empty)],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0
    data = json.loads(result.stdout)
    assert data == {"overall_score": 0.0, "anomalies": [], "count": 0}


def test_audit_pulls_refunds_in_test_mode(stripe_key, tmp_path):
    """End-to-end: audit.py should produce zero or more JSONL records in test mode."""
    out = tmp_path / "refunds.jsonl"
    with open(out, "w", encoding="utf-8") as fh:
        result = subprocess.run(
            [sys.executable, str(AUDIT_PY), "--since", "2026-01-01", "--until", "2026-01-31"],
            stdout=fh,
            stderr=subprocess.PIPE,
            text=True,
            env={**os.environ, "STRIPE_API_KEY": stripe_key},
        )
    assert result.returncode == 0, f"audit.py failed: {result.stderr}"
    # Each line must parse as JSON with at least an `id`.
    for line in out.read_text().splitlines():
        if not line.strip():
            continue
        record = json.loads(line)
        assert "id" in record
        assert "amount" in record
        assert "status" in record
