# Synthetic console development

Install the locked frontend dependencies, then run:

```sh
npm ci --prefix web/strategy-switch-console/frontend
npm run dev:synthetic --prefix web/strategy-switch-console/frontend
```

Open `http://127.0.0.1:4173/v2/?qa=ready`. The server listens only on loopback,
does not load `.env` files or the Worker, and serves invented accounts and
proposals. It does not fetch market data, use credentials, or forward requests.
All API writes return 405; unknown API reads return 503. Sign-in is unavailable.

Use `qa=reader`, `anonymous`, `session-error`, `config-error`, `source-error`,
`source-stale`, `no-accounts`, or `many-decisions` to inspect access screens,
failures, empty states, and a long queue. Set `workspace=accounts` or
`workspace=research` to open a page directly. A scenario stays active until
the next navigation with a `qa` parameter; use one scenario at a time.

Check navigation, browser Back/Forward, English/Chinese, light/dark themes,
keyboard focus and 320/375px mobile widths. Review the dev request log at
`/__qa/requests` to confirm no API writes were accepted. Stop with Ctrl-C.

This dev server is not included in the production bundle. It verifies rendering
and read-only interaction, not backend authorization, real balances, order
submission, or production recovery.
