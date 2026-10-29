# IBKR native interval return

`POST /api/account-facts/period-return/sync` uses the existing IBKR-only sync credential and protected account binding. The exact `ibkr_account_period_return.v1` payload contains `target_id`, `source_binding_id`, `account_scope`, one native `account_ids` entry, fresh `observed_at`, native base `currency`, `period={from,to}`, `method=native_ibkr_twr`, `source=ChangeInNAV.twr`, `source_unit=percent`, decimal-string `source_value`, `unit=ratio`, and decimal-string `value`. The receiver verifies percent/100=ratio exactly and checks native identity against the current server-side binding and account configuration. Caller-supplied console identity is forbidden.

The existing private Durable Object keeps one latest interval per account, with transactional replay, stale-write and equal-instant conflict protection. Binding changes hide old intervals. This is a website read model, not a replacement ledger. The authenticated `/api/account-facts` response exposes the interval, currency, method and values without native identity. A stale or absent balance does not invalidate a separately verified historical interval. The overview displays it separately, without fabricating daily observations, a portfolio return or a benchmark comparison.

Run `node tests/ibkr_period_return_validation.mjs` and the existing account/React/localization/build checks. Real publication still requires the approved cloud entry, original Flex credentials and verified native account. This contract grants no authentication, Gateway research access or schedule changes.

Source: [IBKR Change in NAV](https://www.ibkrguides.com/reportingreference/reportguide/changeinnav_fq.htm).
