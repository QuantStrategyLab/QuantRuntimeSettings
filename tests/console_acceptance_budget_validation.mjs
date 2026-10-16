import assert from "node:assert/strict";
import { createAcceptanceBudget, legacyListCost } from "../scripts/console_acceptance_budget.mjs";
let network = 0;
const budget = createAcceptanceBudget({ maxApiRequests: 2, maxLegacyLists: 3, legacy: true });
const url = "https://synthetic.invalid/api/decisions-inbox";
const get = () => { network++; return { status: 503, error: "fixture_failure" }; };
const first = budget.read(url, get);
assert.equal(first, budget.read(url, get));
assert.equal((await first).status, 503);
assert.equal(network, 1);
assert.equal((await budget.read(url, get)).error, "fixture_failure");
assert.throws(() => budget.read("https://synthetic.invalid/api/runtime-daily", get), /budget_exceeded/);
assert.equal(network, 1, "the budget rejects before network I/O");
assert.equal(legacyListCost("https://synthetic.invalid/api/runtime-daily?include_history=false"), 1,
  "an old Worker may ignore the new list-free parameter");
const failed = createAcceptanceBudget();
await assert.rejects(failed.read(url, () => { throw Error("fixture_transport"); }), /fixture_transport/);
await assert.rejects(failed.read(url, () => assert.fail("must not retry")), /fixture_transport/);
console.log("console_acceptance_budget_validation: PASS (bounded unique reads, retained failures, no retries)");
