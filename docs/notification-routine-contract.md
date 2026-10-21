# Routine notification observations

The daily digest accepts two optional display fields from a producer bound to
the existing account/target identity. Neither field changes execution,
notification routing, receipt validation, risk approval, counts, or dedup keys.

`account_alias` is the canonical alias used by the website's generated account
name mapping. It resolves only in `accounts[platform_id]`; an unmapped alias is
never shown directly. The existing safe fallback and account ordinals remain.
Producers must supply this alias from the trusted target configuration rather
than derive a nickname from a masked hint, account UID or selector. This change
does not modify the website's lookup behavior or private mappings.

`routine_decision` describes one minimum-notional plan observation. All values
below are synthetic:

```json
{
  "reason_code": "min_notional",
  "observed_value": 12.5,
  "limit": 50.0,
  "currency": "USD",
  "symbol": "DEMO"
}
```

The producer records the actual amount at the decision point and the threshold
used there. The formatter does not recompute these values. Missing amounts or
currency display as unknown. Negative, nonfinite, boolean or contradictory
amounts are rejected. This field cannot claim zero orders or fills, approve a
risk block, suppress an urgent event, or clear a reconciliation state.

For several skipped plans, `routine_decisions` accepts up to 100 observations
with the same shape, each with its own symbol and amount. Identical observations
are shown once. Different plans retain separate comparisons; their amounts are
never summed against one per-order threshold. `routine_decision` remains a
compatible single-plan input.

Verified zero-order no-action runs remain normal when their reason consists
only of the documented count provenance and missing optional account-equity
diagnostics. Unknown counts, receipt problems, mixed urgent reasons, failed
delivery/persistence axes and alerts retain their attention state. An identical
machine reconciliation token in a run's signal and conclusion is displayed
once; free-form detail and different runs are retained. Missing count coverage
does not create a reconciliation state. Account total equity keeps its existing
label and is never presented as strategy NAV.

## Pilot migration boundary

IBKR and Schwab routine heartbeat, no-action and approved ordinary no-order
messages belong in one cross-platform report for a complete business window.
Their strategy execution schedules remain active. Genuine order/fill events
and urgent risk/runtime incidents retain immediate delivery.

Before disabling a pilot's legacy routine sender, verify its current producer,
same-business-window identity coverage and actual non-test central delivery.
Aggregate candidate count alone does not prove both pilots are represented.
Then switch one pilot at a time using the existing notification route; enable
the consolidated daily route last. Preserve failure fallback, historical audit
evidence and the immutable rollback revision. Do not disable an entire shared
execution workflow to remove its routine notification.

This source change does not change production flags or schedules. A rendered
fixture, successful workflow, or no-traffic candidate is not delivery proof.
