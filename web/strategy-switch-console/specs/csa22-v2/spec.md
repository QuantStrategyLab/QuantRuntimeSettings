# C-SA-22 Specification — XNYS Sessions Calendar (`csa22-v2`)

> **PUBLISHED:** This specification package was formally published on
> 2026-11-22 by Pigbibi (coordinator, QuantStrategyLab) under the C-SA-22
> focused adjudication Q2 ruling, which requires a published calendar
> version covering the full 2026 calendar year before either lane builds
> against 2026 dates and before SH-2 forward-clock acceptance. It extends
> coverage alongside `csa22-v1`, which remains published and immutable for
> 2025 replay; consumers bind to the `spec_digest` recorded in
> `manifest.json`.

## Metadata

- **Contract:** C-SA-22 (`BRIEF-SH-1.md` §5.3)
- **Calendar Version:** `csa22-v2`
- **Status:** `published`
- **Exchange:** `XNYS`
- **Timezone:** `America/New_York`
- **Coverage Window:** `2026-01-01` through `2026-12-31` (inclusive)
- **Authoritative Exceptions Input:** `exceptions-2026.json`
- **Calendar Source:** NYSE, "Holidays & Trading Hours",
  https://www.nyse.com/markets/hours-calendars (2026 schedule, accessed
  2026-11-22).

## Rules

1. **Digest Verification:** Consumers MUST verify the SHA-256 digests recorded in
   `manifest.json` across `SPEC.md`, `exceptions-2026.json`,
   `generate_expected_2026.py`, and `expected-2026.json` before resolving any
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
   - Listed in `exceptions-2026.json` (`2026-11-27`, `2026-12-24`).
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
   - For 2026, Independence Day falls on Saturday, July 4; NYSE observes
     the holiday on Friday, `2026-07-03`, recorded in
     `exceptions-2026.json` as "Independence Day (observed)".
   - Unscheduled closures (e.g., a national day of mourning):
     `session_state = "unscheduled_closure"`,
     `is_trading_day = false`, `reason = "unscheduled_closure: <name>"`,
     `holiday_name = "<name>"`, null times/window.
  No unscheduled closures are known at publication for 2026;
  `exceptions-2026.json` records an empty set. Any unscheduled closure
  declared later creates a new calendar version; this version is immutable.
5. **Unsupported Venue, Out-of-Range Date, or Observed Disagreement:**
   - Any venue other than `XNYS` returns `session_state = "unknown"`,
     `is_trading_day = false`, `reason = "unsupported_venue"`, null times/window,
     `blocks_orders = true`, `blocks_eligibility = true`.
   - Any date outside `2026-01-01..2026-12-31` returns `session_state = "unknown"`,
     `is_trading_day = false`, `reason = "out_of_range"`, null times/window,
     `blocks_orders = true`, `blocks_eligibility = true`.
   - Any disagreement with an observed venue status marks `blocks_orders = true`
     and `blocks_eligibility = true`.
6. **Timestamp Precision & DST:**
   - All UTC timestamps use ISO-8601 millisecond precision `YYYY-MM-DDTHH:MM:SS.mmmZ`.
   - `is_dst` is evaluated in `America/New_York` at `12:00` local time on `trade_date`.
7. **Consumer Projection of Closure Labels:**
   - The calendar's only state authority is the verbatim `session_state`
     enum emitted under Rules 2–5, including `unscheduled_closure`.
     Persisted calendar records and replay evidence retain only the
     verbatim `session_state`, together with the calendar version and
     `spec_digest`; no second persisted calendar state may be created.
   - A downstream view that requires a single known-closed label MAY
     project both `closed` and `unscheduled_closure` as `closed`. The
     projection is derived from the resolved `session_state` alone —
     never from `is_trading_day` or from a `blocks_orders` /
     `blocks_eligibility` flag — and `unknown` projects as `unknown`.
   - The projection is a display derivation only, never a decision input.
     Operational blocking uses the published `blocks_orders` and
     `blocks_eligibility` fields. Known closures do not create
     missing-session staleness or an incomplete month.
