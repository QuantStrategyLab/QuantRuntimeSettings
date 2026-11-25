# C-SA-22 Specification — XNYS Sessions Calendar (`csa22-v1`)

> **PUBLISHED:** This specification package was formally published on
> 2026-11-21 by Pigbibi (coordinator, QuantStrategyLab) under registration R-3
> of `docs/BRIEF-SH-1.md`. It supersedes the provisional fixture whose
> `spec_digest` was
> `9444245b899b285b0e8f7c9e8a0340ebc6b54683abf797f9884ed7cb11660f7e`;
> consumers bind to the `spec_digest` recorded in `manifest.json`.

## Metadata

- **Contract:** C-SA-22 (`BRIEF-SH-1.md` §5.3)
- **Calendar Version:** `csa22-v1`
- **Status:** `published`
- **Exchange:** `XNYS`
- **Timezone:** `America/New_York`
- **Coverage Window:** `2025-01-01` through `2025-12-31` (inclusive)
- **Authoritative Exceptions Input:** `exceptions-2025.json`

## Rules

1. **Digest Verification:** Consumers MUST verify the SHA-256 digests recorded in
   `manifest.json` across `SPEC.md`, `exceptions-2025.json`,
   `generate_expected_2025.py`, and `expected-2025.json` before resolving any
   session. Any digest mismatch fails closed.
2. **Regular Sessions (Mon–Fri not in exceptions):**
   - `session_state = "regular"`, `is_trading_day = true`, `reason = null`,
     `holiday_name = null`.
   - `open_local = "09:30"`, `close_local = "16:00"`.
   - Default `cutoff_local = close_local`; any registered cutoff earlier than
     `close_local` sets `order_cutoff_utc = min(registered_cutoff_utc, close_utc)`.
   - `order_window = {"start_utc": open_utc, "end_utc": order_cutoff_utc, "half_open": true}`
     (representing `[open, cutoff)` capped by `close`).
3. **Half-Day Sessions (Early Closes):**
   - Listed in `exceptions-2025.json` (`2025-07-03`, `2025-11-28`, `2025-12-24`).
   - `session_state = "half_day"`, `is_trading_day = true`,
     `reason = "early_close: <name>"`, `holiday_name = "<name>"`.
   - `open_local = "09:30"`, `close_local = "13:00"` (converted in
     `America/New_York`, handling both EDT and EST).
   - Default `cutoff_local = "13:00"`; `order_window` is `[open_utc, order_cutoff_utc)`
     capped by `close_utc`.
4. **Weekends, Holidays, and Unscheduled Closures:**
   - Saturday / Sunday: `session_state = "closed"`, `is_trading_day = false`,
     `reason = "weekend"`, `holiday_name = null`, null open/close/cutoff/window.
   - Scheduled XNYS holidays: `session_state = "closed"`, `is_trading_day = false`,
     `reason = "holiday: <name>"`, `holiday_name = "<name>"`, null times/window.
   - Unscheduled closures (e.g., `2025-01-09`): `session_state = "unscheduled_closure"`,
     `is_trading_day = false`, `reason = "unscheduled_closure: <name>"`,
     `holiday_name = "<name>"`, null times/window.
5. **Unsupported Venue, Out-of-Range Date, or Observed Disagreement:**
   - Any venue other than `XNYS` returns `session_state = "unknown"`,
     `is_trading_day = false`, `reason = "unsupported_venue"`, null times/window,
     `blocks_orders = true`, `blocks_eligibility = true`.
   - Any date outside `2025-01-01..2025-12-31` returns `session_state = "unknown"`,
     `is_trading_day = false`, `reason = "out_of_range"`, null times/window,
     `blocks_orders = true`, `blocks_eligibility = true`.
   - Any disagreement with an observed venue status marks `blocks_orders = true`
     and `blocks_eligibility = true`.
6. **Timestamp Precision & DST:**
   - All UTC timestamps use ISO-8601 millisecond precision `YYYY-MM-DDTHH:MM:SS.mmmZ`.
   - `is_dst` is evaluated in `America/New_York` at `12:00` local time on `trade_date`.
