import assert from "node:assert/strict";
import { boundDailyAccounts } from "../web/strategy-switch-console/frontend/src/pages/health/dailySelection.ts";

const accounts = [
  { platform: "synthetic-a", account_alias: "shared-alias" },
  { platform: "synthetic-b", account_alias: "shared-alias" },
  { platform: "synthetic-a", account_alias: "unconnected" },
];
const binding = { platform: "synthetic-a", account_key: "shared-alias", target_key: "synthetic-target", status: "bound" };
assert.deepEqual(boundDailyAccounts(accounts, [binding]), [accounts[0]], "a configured platform is eligible without a private platform whitelist");
assert.deepEqual(boundDailyAccounts(accounts, []), [], "missing metadata must not trigger daily reads");
assert.deepEqual(boundDailyAccounts(accounts, [{ ...binding, status: "unresolved" }]), []);
assert.deepEqual(boundDailyAccounts(accounts, [{ ...binding, account_key: null }]), []);
assert.deepEqual(boundDailyAccounts(accounts, [{ ...binding, target_key: "" }]), []);
assert.deepEqual(boundDailyAccounts(accounts, [binding, binding]), [], "ambiguous ownership must not trigger reads");
assert.deepEqual(boundDailyAccounts(accounts, [binding, { ...binding, platform: "synthetic-b" }]), accounts.slice(0, 2), "account aliases are scoped by platform");
assert.deepEqual(boundDailyAccounts(accounts, [binding, { ...binding, account_key: null, status: "read_failed" }, { ...binding, platform: "synthetic-b" }]), [accounts[1]], "failure blocks that platform without hiding other platforms");
console.log("console_runtime_daily_selection_validation: PASS");
