# Console Worker Guidelines

Follow the root [AGENTS.md](../../AGENTS.md) rules together with the Worker module boundaries below.

## Module Boundaries (`application/`)

- Organize domain code under `web/strategy-switch-console/application/<domain>/` with three cohesive layers:
  - `constants.js`: schema versions, KV keys/prefixes, bounds, enum lists, and shared domain constants.
  - `helpers.js`: pure normalization, validation, digest/hash, and projection helpers. Import shared leaf helpers directly (`../http_error.js`, `../research_task/helpers.js`, etc.).
  - `http.js`: HTTP handlers and KV/store orchestration (`*Response`, replay/archive/storage helpers). Inject runtime-owned helpers (`readBoundedJson`, `appendAuditLog`, etc.) through an explicit `deps` parameter.
- **One-way dependency rule**: modules under `application/<domain>/` MUST NEVER import `worker/runtime_support.js` or `worker.js`. Dependency arrows point strictly inward from `worker.js` -> `worker/runtime_support.js` -> `application/<domain>/*`.
- While migrating callers, `application/worker/runtime_support.js` re-exports extracted constants and helpers and exposes thin DI wrappers around `application/<domain>/http.js` handlers so existing imports stay intact.

## Validation Requirements

- Add a dedicated extraction test at `tests/<domain>_extract_validation.mjs` verifying:
  - `runtime_support.js` imports the extracted modules and preserves re-export parity.
  - Extracted modules contain no imports of `runtime_support.js` or `worker.js`.
  - Handler behavior (auth, validation, idempotent replay, conflict/rollback rejection, stale/corrupt fallback) works through injected `deps` and wrappers.
- Register every new extraction test (`node tests/<domain>_extract_validation.mjs`) in `.github/workflows/validate.yml`.

## Public-Hygiene Constraints

- Never include real commit SHAs, KV namespace or bucket names, deployment subdomains, Cloudflare or broker account IDs, tokens, or workstation local paths anywhere in code, fixtures, docs, or comments.
- Run `git clone https://github.com/QuantStrategyLab/.github ../.github && python3 ../.github/scripts/check_style.py --root . --phase 2` from a sibling `.github` checkout when adding or editing documentation.
