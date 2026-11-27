# Phase 11 BREADTH — Low-Correlation Cross-Asset Research Pre-Registration

- **Status date:** `2026-11-28`
- **Authorization posture:** Research pre-registration only (`live=OFF`, `paper=OFF`, `no_admission=True`, `no_order=True`, `no_capital=True`). Recording this document authorizes no code changes, no market data downloads, no broker configuration edits, and no paper or live admission.
- **Related documents:** [decisions-rebase.md](decisions-rebase.md) | [pilot-preregistration.md](pilot-preregistration.md) | [pilot-results.md](pilot-results.md) | [cost-model.md](cost-model.md) | [definitions-contract.md](definitions-contract.md) | [experiment-ledger.md](experiment-ledger.md)

---

## 1. Purpose and Strategic Rationale

Per [decisions-rebase.md](decisions-rebase.md) §5 and §(b) `R2`, adding correlated US technology leveraged sleeves (e.g., `TQQQ` + `SOXL`, where `PREREG-R5` measured tail correlation `0.7162 >= 0.70`) consumes the shared cash collateral buffer without expanding the drawdown-governed risk budget (`D = 30%` under `BALANCED_COMPOUNDING`, `P-D = 0.0`).

Phase 11 (`BREADTH`) evaluates orthogonal, low-correlation cross-asset sleeves that diversify away from Nasdaq-100 / semiconductor drawdowns before any future `BOOK` (`Phase 13`) multi-sleeve capital expansion is considered.

---

## 2. Candidate Research Universe (Non-Exhaustive Examples)

Per the Owner's open market-scope decision ([decisions-rebase.md](decisions-rebase.md) §5), candidate asset classes are **examples only, neither a whitelist nor a hard limit**:

1. **Physical / spot-backed Gold ETFs** (e.g., low-fee unlevered gold proxies).
2. **Long-duration US Treasuries** (only under explicit duration and rate-regime stress checks).
3. **Broad non-US / ex-tech equity benchmarks** (developed ex-US or non-US broad indices).
4. **Cross-asset trend / commodity sleeves** (liquid listed proxies with clean corporate-action histories).

All initial candidates are **1× unlevered** unless a separate leverage justification is pre-registered after clearing 1× baseline hurdle checks.

---

## 3. Mandatory Admission Gates (All Required Before `PAPER` Consideration)

A candidate sleeve may be considered for separate Owner review only after clearing every gate below on a pre-registered dataset:

1. **Tail Diversification (`< 0.50` bar):**
   - Lower-tail conditional correlation against Nasdaq-100 (`QQQ`) and pilot sleeve (`TQQQ` / `SOXL`) drawdown sessions must stay strictly **`< 0.50`**, with its `95%` one-sided stationary-bootstrap upper confidence bound also **`< 0.50`**.
2. **Point-in-Time Data Integrity (`YARDSTICK` `O1`–`O9`):**
   - Verified point-in-time adjusted close/total-return history, exact split/distribution accounting, zero missing session gaps, and frozen SHA-256 dataset manifest prior to evaluation.
3. **Exact Cost & Small-Account Viability (`OI-COST-*`):**
   - Net performance evaluated under next-close execution, per-trade bid-ask spread (plus `2×` and `3×` spread stress), IBKR `PRO_TIERED` whole-share execution (`US$0.35` minimum ticket fee), and configurable tax-rate stress assumptions.
4. **`FUSE` & Loss-Budget Composability:**
   - Must compose cleanly with `flow_adjusted_hwm` (`#816`), `H = 0` cash-only execution, `V1`–`V7` vehicle-integrity / spread collars, and `L0`–`L6` bankroll drawdown controls.
5. **Multiple-Testing Accounting (`experiment-ledger.md`):**
   - Every candidate variant must be logged in [experiment-ledger.md](experiment-ledger.md) prior to execution (`K_trials` incremented deterministically) and evaluated with `DSR` / `PBO` luck-adjustment; zero post-hoc parameter tuning.

---

## 4. Non-Admission Boundary

Passing offline Phase 11 `BREADTH` research produces documented evidence only. Admission into `PAPER` or `LIVE-GATE` remains blocked until Phase 9 `PAPER` (`TQQQ` / `SOXL` `policy v0`) completes stability verification and the Owner signs an explicit phase-admission decision.
