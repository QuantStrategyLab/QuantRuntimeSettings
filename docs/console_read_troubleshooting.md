# Console data and chart troubleshooting

The browser uses same-origin `/api/*` GET requests with `credentials: "same-origin"`.
No separate API origin or browser bearer token is required. Keep the existing
session and authorization policy; an HTTP 401/403 requires the owner to restore
their session through the normal login flow.

An HTTP 200 is not a guarantee of current business data. Inspect the documented
read-model status and error codes: stale account snapshots are excluded from
current balances, and stale decision sources do not establish an empty queue.
Restore those producers separately; do not extend freshness limits or bypass
reconciliation, admission, or trading guards to make a chart appear.

The homepage exposes the existing account/currency/range chart navigation.
Asset history is an asset-value series, not an account-return series. The four
market benchmarks use their own stored closing-price scales and are explicitly
separate from qualified broker period returns. Missing observations remain gaps;
missing benchmark points are not backfilled or replaced with synthetic prices.

`console_chart_visibility_validation.mjs` runs synthetic native-shaped snapshots
through the account receiver/read-model and benchmark HTTP loader, then renders
the actual homepage. It checks visible asset history and all four benchmark SVGs,
and that missing data and paper-only accounts do not invent a return curve.

UI screenshots and request diagnostics should contain only redacted metadata.
Never retain cookies, authorization headers, response bodies, account identifiers,
or real market-price payloads in local reports or test fixtures.
