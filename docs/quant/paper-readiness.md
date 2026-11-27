# Phase 9 PAPER — IBKR Readiness Specification (`Policy v0`)

- **Status date:** `2026-11-27`
- **Authorization posture:** Documentation and gate-inventory specification only. Authorizes **no** live trading (`live=OFF`), no paper order dispatch, no secret changes, and no cloud runtime flips without explicit Owner approval.
- **Related documents:** [pilot-results.md](pilot-results.md) | [pilot-preregistration.md](pilot-preregistration.md) | [cost-model.md](cost-model.md) | [definitions-contract.md](definitions-contract.md) | [sizing-unit.md](sizing-unit.md)

---

## 1. Approved Starting Policy (`Policy v0` — Option A)

Per completed `PREREG-R5` empirical evaluation ([pilot-results.md](pilot-results.md) §7) and Owner selection of **Option A**, the Phase 9 `PAPER` candidate configuration is locked as:

| Parameter | Starter (`Balanced`) | Conservative | Aggressive | Source / Rule |
| --- | ---: | ---: | ---: | --- |
| Drawdown budget `D` | **`30%`** | `15%` | `50%` | [pilot-preregistration.md](pilot-preregistration.md) |
| Calibrated max exposure `M_full(D)` | **`0.27`** | `0.16` | `0.46` | [pilot-results.md](pilot-results.md) §2 (`S1_2000_02` binding) |
| `SOXL` beta floor `β_SOXL` | `1.50` | `1.50` | `1.50` | [pilot-results.md](pilot-results.md) §3 |
| `P-D` diversification credit | **`0.0`** | `0.0` | `0.0` | Rejected (`L-048`, `TQQQ`–`SOXL` tail `0.7162 ≥ 0.70`) |
| `P-C` no-trade band | **`10%`** | `10%` | `20%` | Adopted (`L-039`, `L-042`, `L-046`) |
| `vol_scale` / `dd_scale` | **`OFF`** | `OFF` | `OFF` | Option A (`x_ML(c)` proportional cushion only) |
| Kelly sizing | **`OFF`** | `OFF` | `OFF` | Computed and recorded only (`live=OFF`) |
| Stop-loss return rule | **`OFF`** | `OFF` | `OFF` | Standing invariant |
| External reserve `H` / margin | **`0` / `OFF`** | `0` / `OFF` | `0` / `OFF` | Cash-only execution (`cash_only=ON`) |
| Venue & session boundary | **IBKR (`XNYS` regular)** | `IBKR` | `IBKR` | `09:30–16:00 ET` regular hours (`20:00 ET+` next-day booking) |

---

## 2. Engineering Prerequisites Completed

1. **`Phase 5 FUSE` + `P0 Flow-Adjusted HWM & Split Reconciliation`:**
   - `FuseControl` (`FUSE-1`, `csa22-v3`), `QuantPlatformKit#815` (`FUSE-3` shared state-store readback), and `QuantPlatformKit#816` (`flow_adjusted_hwm` + forward/reverse split reconciliation) merged into `main`.
   - Downstream broker adoption pinned across `InteractiveBrokersPlatform#1033`, `CharlesSchwabPlatform#724`, and `LongBridgePlatform#769`.
2. **`Phase 6 WATCH` & Daily Digest:**
   - `QuantInternalOps#12` (`ops-watch` `dry_run`), `#13` (bilingual P0 emergency-stop & alert-triage runbooks), and Azure daily-digest package fix (`.github#89`, `QuantRuntimeSettings#1239`, OIDC deploy verified) are active.
3. **`Phase 7 SUPPLY-B` Code Path:**
   - `InteractiveBrokersPlatform#1028` (`20:00 ET` overnight execution attribution) and temporary Azure IAM cleanup merged.
4. **`Phase 8 PILOT` (`QuantRuntimeSettings#1238`):**
   - Full `28`-slot `PREREG-R5` evidence and ledger (`L-027`–`L-054`) merged into `main`.

---

## 3. Known Fractional-Share & API Tradeoff (`10242/10243` vs `P-E`)

- **What `PILOT` `P-E` measured:** Simulated IBKR fractional shares (`L-052`) outperformed whole shares (`L-051`) by `+175 bps/yr` real ETF net growth (`3.80%` vs `2.05%`) under the pre-registered `P-E` viability test tier, though both recorded `NOT_MET` on the `< 10%` fixed-fee efficiency ratio ([pilot-results.md](pilot-results.md) §6).
- **What IBKR API enforces today:** IBKR TWS / Client Portal APIs hard-reject fractional equity orders and fractional order modifications (`10242` / `10243`), enforced fail-closed in `InteractiveBrokersPlatform` (`runtime_execution_policy.py`).
- **Practical `PAPER` consequence:** Automated IBKR `PAPER` execution uses **whole-share integer quantities** (`round`/`floor` quantization) unless an Owner-verified API path supports programmatic fractional US ETF orders. `IBKR Pro Tiered` (`US$0.35` minimum ticket fee vs `US$1.00` under `Fixed`, [cost-model.md](cost-model.md) §5.1) is the recommended pricing plan to keep per-ticket fixed-fee drag lower while validating live paper fills, spreads, and reconciliation prior to scaling allocation.

---

## 4. Remaining Owner & Pre-Launch Gates Before Switching `PAPER` On

1. **`OA-SH2-2` (`SHADOW` `CLK-01` Clock Unlock):** Authorize/observe first `seq=0` EOD commit on `ShadowResearch` (`80e8771`) and validate/rotate the trusted genesis digest for the 20-trading-day out-of-sample `SHADOW` run.
2. **`OI-COST-3` (Account Pricing Plan & Whole-Share Confirmation):** Owner confirms whether the IBKR paper/live account uses **IBKR Pro Tiered** (recommended) or **Fixed**, and confirms starting IBKR `PAPER` with **whole-share API sizing** under `10242/10243`.
3. **`OI-COST-4` (Realized Spread & `V7` Abnormal-Spread Collar):** Verify observed `TQQQ` / `SOXL` / short-duration T-bill quotes on IBKR paper and calibrate the `V7` live spread collar threshold ([cost-model.md](cost-model.md) §5.2).
4. **`OA-4/5/6` (IBKR Flex & Security Hygiene Confirmation):** Confirm IBKR Activity Flex Query (`IBKR_FLEX_QUERY_ID`) timezone and `Trades` section via read-only diagnostics, confirm account 2FA, API withdrawal lock, and IP allowlist, then grant explicit Owner sign-off to activate `PAPER` (`live` remains `OFF`).
