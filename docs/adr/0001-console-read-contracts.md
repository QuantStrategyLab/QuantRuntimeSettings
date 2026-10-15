# Console read contracts and draft saves

Status: accepted

## Context

A console interface needs stable display data without interpreting technical
records or assuming missing financial data are zero. Existing save callers need
their identity and revision conflict behavior preserved.

## Decision

Expose additive read projections and a combined draft-save alias. Keep legacy
routes and exact evidence receipts compatible. Read history from existing stored
records. Reuse the existing save transaction and shared performance calculations.
Publish TypeScript contracts and JSON Schemas. Return availability and coverage
alongside values, and keep evidence prose outside the display projection.

## Consequences

New clients can use a single inbox, structured setting differences and explicit
unavailable states. Existing clients continue using their current routes.
Incomplete cash flows prevent qualified P/L, TWR and drawdown. Unconnected fill
and effect-verification sources remain explicitly unavailable. Draft saves grant
no execution authority and do not apply runtime changes.
