import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js";

// B2-A17: the frontend platform rollup judges management evidence before
// duplicate removal. A duplicate or a scope-conflict row carrying unknown or
// conflicting evidence vetoes the total; clean duplicates and known paper
// rows stay plain exclusions. Synthetic in-memory rows only.
const root = new URL("../web/strategy-switch-console/frontend/", import.meta.url).pathname;
const directory = await mkdtemp(join(tmpdir(), "management-rollup-"));
try {
  const outfile = join(directory, "rollup.cjs");
  await build({ stdin: { contents: "export { platformCurrencyTotals } from './src/lib/accountFacts';", resolveDir: root },
    bundle: true, platform: "node", format: "cjs", outfile, loader: { ".css": "empty" }, define: { "import.meta.env": "{}" } });
  const { platformCurrencyTotals } = createRequire(import.meta.url)(outfile);
  const fact = extra => ({
    platform: "ibkr", account_key: "synthetic-main", binding_status: "bound", identity_status: "partial_identity", identity_mismatch: false,
    data_status: "fresh", broker_environment: "live", account_scope: "LIVE", observation_date: "2026-10-20",
    observed_started_at: "2026-10-20T02:00:00Z", observed_finished_at: "2026-10-20T02:00:05Z", aggregation_status: "included",
    balances: [{ currency: "USD", net_assets: "100" }], cash: [{ currency: "USD", cash_balance: "10" }],
    management_status: "managed", evidence_state: "known", management_revision: 1, ...extra,
  });
  const managed = fact();
  const duplicate = extra => fact({ account_key: "synthetic-duplicate", aggregation_status: "duplicate", ...extra });
  assert.ok(platformCurrencyTotals([managed], 1).length > 0, "positive control: a known managed account sums");
  assert.ok(platformCurrencyTotals([managed, duplicate({})], 2).length > 0, "a clean duplicate stays a plain exclusion");
  assert.equal(platformCurrencyTotals([managed, duplicate({ management_status: "unknown", evidence_state: "conflict", management_revision: null })], 2).length, 0,
    "a duplicate carrying a management conflict vetoes the total before it is removed");
  assert.ok(platformCurrencyTotals([managed, duplicate({ broker_environment: "paper", account_scope: "paper", management_status: "unknown", evidence_state: "unknown", management_revision: null })], 2).length > 0,
    "a known paper row with unknown management stays excluded");
  assert.equal(platformCurrencyTotals([managed, duplicate({ broker_environment: "paper", account_scope: "paper", management_scope_conflict: true })], 2).length, 0,
    "a paper label contradicting its group's live scope vetoes the total");
  // B04: a user declaration alone never hides unresolved scope from the veto.
  const declaredPaper = fact({ account_key: "synthetic-declared", broker_environment: null, account_scope: null, aggregation_status: "included",
    user_declaration: { source: "user_declared", environment: "paper", account_type: null },
    management_status: "unknown", evidence_state: "unknown", management_revision: null });
  assert.equal(platformCurrencyTotals([managed, declaredPaper], 2).length, 0, "an unresolved row declaring paper vetoes the platform total");
  const trustedPaper = { ...declaredPaper, broker_environment: "paper", account_scope: "paper" };
  assert.ok(platformCurrencyTotals([managed, trustedPaper], 2).length > 0, "a proved-paper row stays a plain exclusion");
  // The server judges the same mixed rows the same way.
  const { aggregateAccountFactsTotals } = await import("../web/strategy-switch-console/account_facts.js");
  const { managementCohort } = await import("../web/strategy-switch-console/application/account_mapping/management_cohort.js");
  const dep = key => ({ platform: "ibkr", key });
  const cohort = managementCohort({ format: "qsl_account_management_readback.v1", status: "available", physical_grouping_complete: true,
    evidence_scope: "synthetic", observed_at: "2026-11-18T00:00:00.000Z", instance_revision: 1, policy_revision: 1,
    groups: [{ deployments: [dep("synthetic-main")], management_status: "managed", evidence_state: "known", scope: "live" }] });
  const serverRow = (row, key) => ({ ...row, platform: "ibkr", account_key: key, binding_status: "bound", data_status: "fresh", balances: [{ currency: "USD", net_assets: "100" }], cash: [{ currency: "USD", available_cash: "10", cash_balance: "10" }] });
  const serverRows = [serverRow(managed, "synthetic-main"), serverRow(declaredPaper, "synthetic-declared")];
  const identities = new Map(serverRows.map(row => [row, JSON.stringify(row.account_key)]));
  assert.equal(aggregateAccountFactsTotals(serverRows, identities, cohort).status, "unavailable", "the server withholds the same total");
  const serverControl = [serverRow(managed, "synthetic-main")];
  assert.equal(aggregateAccountFactsTotals(serverControl, new Map(serverControl.map(row => [row, "x"])), cohort).status, "by_currency", "known-live control still sums");
  console.log("management_rollup_veto_validation ok");
} finally {
  await rm(directory, { recursive: true, force: true });
}
