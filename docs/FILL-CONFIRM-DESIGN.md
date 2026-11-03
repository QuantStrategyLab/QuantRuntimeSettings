# Cross-broker final-fill confirmation design

Status: proposal only. This document implements no polling, reconciliation,
submission, runtime switch, broker call, alert sender or deployment. A separate
owner-approved implementation is required before any runtime integration.

## Purpose and evidence boundary

Confirm the eventual outcome of an already submitted order for IBKR, Schwab,
LongBridge, Binance and Firstrade. Reuse each platform's existing order identity,
protected archive, reconciliation and notification storage. The daily summary
only projects supplied evidence; it never queries a broker or becomes an
execution authority. Failure to confirm must remain visible, without resubmitting,
cancelling, replacing or compensating for the original order.

The stopped fill-confirm-r1 draft provided useful IBKR settlement-store and
notification-projection sketches. Retain the ideas of bounded reads, durable
per-attempt identity, preserving partial facts after a read failure, later
read-only observation and ambiguous-send protection. Do not carry over its
runtime edits, default-on settlement switch, submission wrappers or assumptions
that one IBKR adapter already establishes a cross-broker contract. No PR is to
be opened from that stopped checkout.

## Ownership and minimum integration

The execution owner persists an existing submission attempt and its broker order
identity. The broker adapter reads existing orders and executions. The existing
reconciliation owner stores observations and resolves disagreements. The
notification producer projects those observations into the original source run;
the central digest validates and renders them. Prefer small additions at these
existing seams over a new global broker service or a replacement risk gate.

Protected identity comprises platform, account UID, target, strategy, original
source run, submission attempt, broker order ID and order leg where applicable.
Use stable permanent IDs or client IDs only when that broker verifies their
scope. Missing broker IDs, a timeout during submission or ambiguous acceptance
must remain `unconfirmed`; polling must not manufacture an identity or repeat a
submission. Keep account/order IDs private; display at most the last two
characters, and use synthetic IDs in tests and public examples.

## Observation state and finality

| Observation | Terminal? | Summary meaning |
| --- | --- | --- |
| Submitted / accepted / working | No | Order submitted; final state unconfirmed |
| Partial execution with remaining quantity | No | Preserve executed quantity and price; remainder unconfirmed |
| Broker-confirmed filled, zero remaining | Yes | Filled, with validated quantities and execution evidence |
| Broker-confirmed cancelled or expired | Yes | Terminal, possibly with earlier partial fills; never imply zero fills |
| Broker-confirmed rejected | Yes | Rejected; confirm whether any prior execution exists |
| Read failed, timed out, identity mismatch or contradictory facts | Unknown | Preserve previous facts and expose confirmation gap |

An order's terminal state and its execution count are separate axes. A terminal
cancellation may have fills; a filled order can have multiple executions. A
known execution count does not prove every order is terminal. A timeout is an
observation deadline, not an order cancellation or proof that the broker has no
order. Missing quantity/price/execution records do not become zero.

Each protected observation retains broker source, order and execution IDs,
requested/cumulative/remaining quantities, average price when available, broker
status, terminal proof, broker event time with timezone, local receipt time,
source revision or sequence and evidence completeness. Validate finite quantities,
non-negative values and the broker's unit/fee/precision semantics. Decimal asset
quantities, order replacements, split legs and fees must not be flattened into
integer stock counts. Corrections or execution busts require explicit revision
provenance; never enforce a simplistic forever-increasing fill quantity that
would conceal a valid broker correction.

## Post-submit bounded observation

After the existing submission result is safely persisted, an independently
approved read-only confirmation step may query that order and its executions.
Use a monotonic overall deadline, a bounded attempt count and a timeout on every
broker call. Bound sleep/backoff by the remaining budget; respect rate limits
and retry-after without exceeding the overall deadline. Exact budgets are
platform-specific acceptance decisions, not defaults enabled by this proposal.
Restore any temporarily scoped client timeout and close only connections owned
by the confirmation step. Do not take over a production Gateway session.

Stop on verified terminal evidence, deadline exhaustion, missing identity,
authentication/permission failure, rate-limit exhaustion or contradictory broker
facts. Reads may be retried only within the approved budget; an ambiguous
submission or external write must never be retried as a read recovery. Preserve
partial observations on error. Distinguish `pending` from `read_failed` and
`permission_denied` in protected storage; public diagnostics use fixed codes.

## Later reconciliation pass

The existing later reconciliation pass reads unresolved protected attempts using
its approved account and broker scope. A separate observational schedule or
entry point requires future approval; this proposal creates neither. It must
recover pending attempts after process restarts, use bounded storage enumeration
and flag truncation as incomplete. Concurrent observers use existing CAS or
append-only sequence protection so stale observations cannot erase newer facts.

Match by the full protected identity, not symbol/quantity/time proximity. Deduplicate
execution records by broker execution identity and broker-supported revision.
Out-of-order, same-sequence conflicting or incompatible source observations stay
unconfirmed for investigation. Terminal evidence without corrections is not
replaced by an older working snapshot. Identity conflicts stop that attempt's
projection before publication; other independently valid targets may still be
reported with explicit incomplete coverage.

Keep the original submission/order count and run count unchanged. A later
confirmation amends that run's confirmation evidence and execution statistics;
it is neither a new submission nor a new strategy run. Preserve the original
06:00 SGT source window, and retain broker execution timestamps separately.
Executions arriving in another window must follow a documented execution-time
metric or an explicit prior-window correction; never silently move an original
order to the observer's day or count a fill twice across daily summaries.

## Broker-specific evidence requirements

These are integration requirements to verify against the current owning adapter
and broker API; no live capability was tested for this design.

| Broker | Reuse and verify | Cases requiring explicit coverage |
| --- | --- | --- |
| IBKR | Existing order outcome / execution reconciliation; verify client/session order ID versus permanent identity and account | Gateway reconnect, partials, late executions, options legs, executions unavailable despite terminal status |
| Schwab | Existing archived submission/order identity and order/execution readback | Outer report success versus inner status, replaced child orders, receipt time skew and source conflicts |
| LongBridge | Existing account-scoped order details and executions producer | Market/account separation, decimal quantities, delayed updates, cancelled partials |
| Binance | Existing account/product-scoped order and trade facts | Spot versus derivatives, client/order/trade ID scope, cumulative fills, fees and decimal precision |
| Firstrade | Existing order-history/execution adapter if available and approved | Session expiry, insufficient final-status evidence, history lag; unsupported reads remain unconfirmed |

Do not infer confirmation from workflow success, a healthy heartbeat, an object
upload, HTTP acceptance alone, a disabled runtime or absence of an order from a
partial listing. Do not add a broker call to the central summary to fill a
capability gap.

## Receipt times and source conflicts

Separate scheduled due time, source start/finish, broker execution time, receipt
observation time and storage updated time. A receipt published 70 seconds after
a schedule is not by itself a clock-skew failure. It cannot override an inner
blocked/failed execution status. A receipt outside its recorded source interval,
in the future or without a timezone remains unconfirmed in notification
projection; never widen a live acceptance gate to make a summary green.

Projection is reproducible from immutable evidence: normalize only equivalent
representations such as timezone offsets for the same instant and documented
optional null defaults. Preserve conflicts in identities, counts, execution
status, terminal proof and observations. A validated later observation may amend
a run only through an explicit future revision contract; do not weaken today's
same-source conflict protection to silently replace facts.

## Unconfirmed alert and eventual resolution

At the observation deadline, persist the gap before asking the existing
notification mechanism to alert. The proposed alert key includes protected order
attempt and gap state. Use durable reservation plus acknowledgement; a crashed,
negative or ambiguous delivery remains delivery unknown and is not blindly
resent. A later verified resolution is a separate state transition and may have
its own idempotent notice under the existing notification policy. Gap alerts,
terminal notices and digest delivery are distinct acknowledgements.

The summary must say unconfirmed while the gap exists, show any known fills,
and retain whole-window unknown totals when coverage is incomplete. An alert
acknowledgement never changes order finality. Candidate publication failure must
remain an evidence-delivery failure rather than a claim that the order failed.
This proposal does not enable these alerts or dispatch a Telegram workflow.

## Future implementation acceptance

Use fake clocks, fake IDs, in-memory storage and broker fakes only. Cover all five
brokers: working-to-filled, deadline expiry, partial then cancelled, rejected,
missing ID, read failure after partial evidence, permission failure, rate limits,
restart recovery, concurrent CAS conflict, out-of-order observations, corrected
executions, multi-leg orders and duplicate fill records. Verify cumulative values
and prices without equating terminal orders with execution counts.

Prove per-call and overall timeout bounds, no resubmission under any read failure,
no weakened risk/execution claims, no stale terminal overwrite, original-window
attribution, receipt skew disclosure, deterministic replay and masked output.
Exercise ambiguous alert delivery with zero blind retries. Freeze each broker's
actual supported read semantics and any missing capabilities before a later
implementation PR; runtime integration and production testing remain separately
authorized work.
