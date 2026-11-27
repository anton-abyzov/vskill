# Stripe Refund object — fields used by this skill

Reference for the subset of `Refund` object fields consumed by `scripts/audit.py`
and `scripts/grader.py`. See [Stripe API reference](https://stripe.com/docs/api/refunds/object)
for the full schema.

## Fields

| Field      | Type    | Description |
|------------|---------|-------------|
| `id`       | string  | Unique refund identifier, e.g. `re_1Nx7VP2eZvKYlo2C9Q9z3vV1`. Primary key. |
| `amount`   | integer | Amount refunded in the smallest currency unit (cents for USD). Used by the grader's "large amount" heuristic with a $1,000 threshold. |
| `currency` | string  | ISO 4217 lowercase code (`usd`, `eur`). Reported but not graded. |
| `status`   | string  | One of `pending`, `succeeded`, `failed`, `canceled`, `requires_action`. The grader weights `failed` as anomalous (+0.30). |
| `reason`   | string\|null | One of `duplicate`, `fraudulent`, `requested_by_customer`, or null when the merchant did not record one. The grader treats `null` as anomalous (+0.30). |
| `charge`   | string  | The originating `Charge` id. The grader counts duplicates per `charge` value and weights any duplicate at +0.40. |
| `created`  | integer | Unix timestamp at refund creation. Reported but not graded. |
| `metadata` | object  | Free-form key/value pairs the merchant attaches. Surfaced verbatim in the report; ungraded. |

## Anomaly score model (deterministic)

The grader assigns each record a weighted score, clamped at 1.0:

```
score(refund) = clamp(
    0.30 if reason is null else 0
  + 0.40 if duplicate(charge) else 0
  + 0.20 if amount > 100_000 cents ($1,000) else 0
  + 0.30 if status == "failed" else 0
, 0, 1)
```

Overall score = mean of per-record scores. The output JSON sorts records by
`anomaly_score` descending and includes only records with `score > 0`.

## Test-mode safety

Stripe distinguishes test and live keys by prefix:
- `sk_test_*` → test mode; safe to use against fixture data.
- `sk_live_*` → production; never use in CI or local development.

`tests/integration_test.py` refuses to proceed against a non-`sk_test_` key as
a safety guard.
