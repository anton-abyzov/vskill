---
description: Subscription state machine, dunning retry logic, and proration calculations. Use for recurring billing lifecycle, failed payment recovery, and mid-cycle plan change pricing.
---

# Billing Automation

## Subscription State Machine

```
trialing ──► active ──► past_due ──► canceled
                │           │
                │           └──► active (payment recovered)
                │
                ├──► paused ──► active (resumed)
                │
                └──► canceled (immediate or at period end)
```

**Transition rules:**
- `trialing -> active`: First successful payment or trial end with valid payment method
- `trialing -> canceled`: Trial expires with no payment method
- `active -> past_due`: Payment fails at cycle renewal
- `past_due -> active`: Retry succeeds during dunning window
- `past_due -> canceled`: All retries exhausted
- `active -> paused`: Explicit customer/admin action; paused subscriptions skip billing cycles
- `paused -> active`: Resume triggers immediate or next-cycle billing
- `active -> canceled`: Immediate cancellation or scheduled at period end (`cancel_at_period_end`)

**Edge cases:**
- Cancellation during trial: No charge, immediate termination
- Downgrade while past_due: Apply after payment recovers, not during dunning
- Pause during past_due: Not allowed; must resolve payment first

## Dunning Retry Schedule

```python
DUNNING_SCHEDULE = [
    # attempt | delay from last failure | action
    (1, 0,   "initial_failure"),       # Day 0: Payment fails, notify immediately
    (2, 1,   "retry_silent"),          # Day 1: Silent retry (card networks batch)
    (3, 3,   "retry_with_email"),      # Day 3: Retry + "update payment method" email
    (4, 5,   "retry_with_email"),      # Day 5: Retry + escalation email
    (5, 7,   "final_retry"),           # Day 7: Final retry + "last chance" email
    # Day 7 fail → cancel subscription
]
```

**Key behaviors:**
- Each retry uses the customer's current default payment method (they may update it mid-dunning)
- If customer updates payment method during dunning, trigger immediate off-schedule retry
- Grace period: Service continues during dunning window (configurable: full access vs degraded)
- On recovery: Reset retry counter, move to `active`, send "payment recovered" email
- On exhaustion: Cancel subscription, send final notice, retain customer record for reactivation

## Proration Calculation

```python
def calculate_proration(old_plan_amount, new_plan_amount,
                        period_start, period_end, change_date):
    """Mid-cycle plan change proration."""
    total_days = (period_end - period_start).days
    days_remaining = (period_end - change_date).days

    # Credit for unused portion of old plan
    unused_credit = (old_plan_amount / total_days) * days_remaining

    # Charge for remaining portion at new plan rate
    new_charge = (new_plan_amount / total_days) * days_remaining

    # Net amount: positive = charge customer, negative = credit
    net = new_charge - unused_credit

    return {
        'unused_credit': round(unused_credit, 2),
        'new_charge': round(new_charge, 2),
        'net_proration': round(net, 2),
        'days_remaining': days_remaining,
        'total_days': total_days
    }


def calculate_seat_proration(current_seats, new_seats, price_per_seat,
                             period_start, period_end, change_date):
    """Mid-cycle seat count change."""
    total_days = (period_end - period_start).days
    days_remaining = (period_end - change_date).days
    seat_delta = new_seats - current_seats

    prorated = (seat_delta * price_per_seat / total_days) * days_remaining

    return {
        'seat_delta': seat_delta,
        'prorated_charge': round(max(0, prorated), 2),  # No refund for seat removal mid-cycle
        'prorated_credit': round(abs(min(0, prorated)), 2) if seat_delta < 0 else 0,
    }
```

**Proration strategies:**
- **Immediate charge**: Invoice proration immediately on plan change (Stripe default)
- **Next invoice**: Add proration line items to next billing cycle invoice
- **None**: No proration; new price takes effect at next renewal

**Edge cases:**
- Multiple plan changes in one cycle: Each change calculates from last change date, not period start
- Downgrade credit exceeds next charge: Roll credit forward, do not refund automatically
- Annual-to-monthly switch: Prorate annual credit, start monthly billing immediately
