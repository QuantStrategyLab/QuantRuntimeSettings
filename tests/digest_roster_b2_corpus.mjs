// B3 corpus of landed-B2 outputs for the Python digest-roster core tests.
// Every readback is produced by B2's real builder (buildManagementReadback)
// through the SELECT-only read facade of a real RuntimeInstances object over
// node:sqlite, after real policy provisioning and draft/apply commands; the
// preparation projections come from the full B1 projectAccountManagement
// over a real #1173 inventory collection with B2's applied-row adapter
// (exportAppliedRecords). Storage faults are injected by SQL on the
// synthetic store only. The wall clock is pinned so the corpus is
// deterministic. Synthetic identities only; no network (outbound trap).
//
//   node tests/digest_roster_b2_corpus.mjs           # check the committed corpus
//   node tests/digest_roster_b2_corpus.mjs --write   # regenerate it
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

// Pinned clock: every argument-free Date reads a deterministic, advancing
// instant, so applied effective times and journal stamps are reproducible.
const RealDate = Date;
const EPOCH = RealDate.parse("2026-11-19T20:00:00.000Z");
let tick = EPOCH;
// Every synthetic store starts from the same instant, so one authority
// lineage carries one applied tuple per revision across scenarios.
const restartClock = () => { tick = EPOCH; };
globalThis.Date = class extends RealDate {
  constructor(...args) { if (args.length) super(...args); else { super(tick); tick += 1000; } }
  static now() { tick += 1000; return tick - 1000; }
};

const ROOT = new URL("../", import.meta.url);
const CONSOLE = new URL("web/strategy-switch-console/", ROOT);
const OUTPUT = new URL("python/tests/fixtures/digest_roster_b2_corpus.json", ROOT);
const harness = await import("./helpers/account_management_harness.mjs");
const { FIXTURE_ACCOUNTS, INSTANCES, INSTANCE_REVISION, baselineStore, createStore, managementCommand, outbound, policyOf, provision, readback, ref, setManagement } = harness;
const { collectInventory, instanceStateRow } = await import("./helpers/account_identity_inventory_collect.mjs");
const { projectAccountManagement } = await import(new URL("application/runtime_instances/mapping_projection.js", CONSOLE));
const { MANAGEMENT_STATUS_TEXT, MANAGEMENT_EVIDENCE_TEXT } = await import(new URL("application/runtime_instances/account_management_text.js", CONSOLE));
const fixture = JSON.parse(await readFile(new URL("tests/fixtures/account-mapping-roster.synthetic.json", ROOT), "utf8"));

// The generation observation time every corpus readback carries; Python
// tests pin their render clock relative to it.
const OBSERVED_AT = "2026-11-19T23:00:00.000Z";
const META = { observedAt: "2026-11-19T22:00:00.000Z", sourceRef: "inventory_export:synthetic-b3" };
const ELIGIBLE = FIXTURE_ACCOUNTS.filter(([managementClass]) => managementClass === "eligible").map(([, deployments]) => deployments);
const PAIR = ELIGIBLE.find(deployments => deployments.length === 2);
const sql = store => store.object.managementRead.sql;
const read = store => readback.buildManagementReadback(sql(store), OBSERVED_AT);
const applied = store => store.db.prepare("SELECT * FROM account_management_applied ORDER BY platform, account_key").all();
const run = (store, statement, ...bindings) => store.db.prepare(statement).run(...bindings);

// The registered DO read path and the builder agree byte-for-byte apart
// from the server observation time.
async function routeAgrees(store) {
  const { status, body, headers } = await store.read();
  assert.equal(status, 200);
  assert.equal(headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(body, readback.buildManagementReadback(sql(store), body.observed_at));
}

async function withStore(build) {
  restartClock();
  const store = await baselineStore();
  try { await build(store); await routeAgrees(store); return read(store); } finally { store.close(); }
}

const byKey = (platform, key) => [platform, key];
const off = deployments => store => setManagement(store, deployments[0], false);
const scenarios = {};

scenarios.all_on = await withStore(async () => {});
scenarios.all_off = await withStore(async store => { for (const deployments of ELIGIBLE) await off(deployments)(store); });
// Four on (three live, one paper), five off; the paper group is the eligible paper deployment.
const paper = ELIGIBLE.find(deployments => INSTANCES.find(item => `${item.platform}/${item.key}` === deployments[0]).config.broker_environment === "paper");
const liveOn = ELIGIBLE.filter(deployments => deployments !== paper && INSTANCES.find(item => `${item.platform}/${item.key}` === deployments[0]).config.broker_environment === "live").slice(0, 3);
scenarios.four_on = await withStore(async store => {
  for (const deployments of ELIGIBLE) if (deployments !== paper && !liveOn.includes(deployments)) await off(deployments)(store);
});
const liveOff = ELIGIBLE.filter(deployments => deployments.length === 1 && deployments !== paper
  && INSTANCES.find(item => `${item.platform}/${item.key}` === deployments[0]).config.broker_environment === "live").at(-1);
scenarios.one_off = await withStore(off(liveOff));
scenarios.paper_off = await withStore(off(paper));
// A saved OFF draft only: no applied change.
scenarios.draft_off_only = await withStore(async store => {
  const [platform, key] = ref(liveOff[0]);
  const saved = await store.call(managementCommand(store, "account_management_draft_save", platform, key, { management_enabled: false }));
  assert.equal(saved.status, 200);
});
// Applied rows removed by storage fault (synthetic store only).
const single = ELIGIBLE.find(deployments => deployments.length === 1 && deployments !== paper);
scenarios.missing_one = await withStore(async store => { run(store, "DELETE FROM account_management_applied WHERE platform = ? AND account_key = ?", ...ref(single[0])); });
scenarios.missing_all = await withStore(async store => { run(store, "DELETE FROM account_management_applied"); });
// Sibling contradictions on the two-deployment group, each with its records
// written in both orders (delete and reinsert reversed).
async function reversed(store) {
  const rows = applied(store).reverse();
  run(store, "DELETE FROM account_management_applied");
  for (const row of rows) run(store, "INSERT INTO account_management_applied (platform, account_key, revision, identity_json, membership_json, management_enabled, effective_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    row.platform, row.account_key, row.revision, row.identity_json, row.membership_json, row.management_enabled, row.effective_at);
}
const [pairA, pairB] = PAIR.map(ref);
const contradictions = {
  sibling_flag_disagree: store => run(store, "UPDATE account_management_applied SET management_enabled = 0 WHERE platform = ? AND account_key = ?", ...pairB),
  sibling_revision_disagree: store => run(store, "UPDATE account_management_applied SET revision = revision + 5 WHERE platform = ? AND account_key = ?", ...pairB),
  sibling_missing_malformed: store => { run(store, "DELETE FROM account_management_applied WHERE platform = ? AND account_key = ?", ...pairA); run(store, "UPDATE account_management_applied SET management_enabled = 2 WHERE platform = ? AND account_key = ?", ...pairB); },
  sibling_missing_only: store => run(store, "DELETE FROM account_management_applied WHERE platform = ? AND account_key = ?", ...pairB),
  display_only_enabled: store => {
    const [platform, key] = ref(FIXTURE_ACCOUNTS.find(([managementClass]) => managementClass === "display_only")[1][0]);
    const [template] = applied(store);
    run(store, "INSERT INTO account_management_applied (platform, account_key, revision, identity_json, membership_json, management_enabled, effective_at) VALUES (?, ?, ?, ?, ?, 1, ?)",
      platform, key, 1, JSON.stringify(store.identity(platform, key)), JSON.stringify([{ platform, legacy_key: key }]), template.effective_at);
  },
};
for (const [name, fault] of Object.entries(contradictions)) {
  scenarios[name] = await withStore(async store => { fault(store); });
  scenarios[`${name}_reversed`] = await withStore(async store => { fault(store); await reversed(store); });
}
// Global revision axes, each varied with the other fixed.
scenarios.policy_bumped = await withStore(async store => {
  const response = await provision(store, policyOf(FIXTURE_ACCOUNTS, INSTANCES, fixture.policy.policy_revision + 1), fixture.policy.policy_revision);
  assert.equal(response.status, 200);
});
scenarios.instance_bumped = await withStore(async store => { run(store, "UPDATE instance_state SET revision = revision + 1 WHERE id = 1"); });
// Unavailable variants: uninitialized state and a missing policy.
{
  const store = createStore({ seed: false });
  scenarios.uninitialized = read(store);
  store.close();
  const bare = createStore();
  scenarios.policy_missing = read(bare);
  bare.close();
}

// Preparation: the full projection at the same revisions as the baseline
// readback, over a real inventory collection, with B2's adapter rows.
async function preparation(build = async () => {}, { collect = {}, effective: transform = rows => rows } = {}) {
  restartClock();
  const store = await baselineStore();
  try {
    await build(store);
    const inventory = (await collectInventory({ statements: [instanceStateRow(INSTANCE_REVISION, INSTANCES)], ...collect })).private;
    const live = read(store);
    const effective = transform(readback.exportAppliedRecords(applied(store)));
    const projection = projectAccountManagement({ state: store.object.read(), inventory, policy: policyOf(FIXTURE_ACCOUNTS), collection: META, effective, links: fixture.enrollment_links });
    return { readback: live, effective_export: effective, projection };
  } finally { store.close(); }
}
const preparations = {
  complete: await preparation(),
  // An inventory missing its final collection pass (#1173 incomplete).
  inventory_incomplete: await preparation(undefined, { collect: { kvPasses: 1 } }),
  // The adapter given a duplicate deployment record.
  duplicate_record: await preparation(undefined, { effective: rows => [...rows, rows[0]] }),
  // Sibling effective times differ under an agreeing value and revision.
  sibling_effective_time_disagree: await preparation(async store => {
    run(store, "UPDATE account_management_applied SET effective_at = ? WHERE platform = ? AND account_key = ?", "2026-11-19T20:30:00.000Z", ...pairB);
  }),
};

// B1's two merged projection entries with absent and null options (controls).
const controls = { absent: projectAccountManagement(), null: projectAccountManagement(null) };

const corpus = {
  $comment: "Generated by tests/digest_roster_b2_corpus.mjs from the landed B2 readback builder and B1 projection over synthetic stores. Do not edit by hand.",
  observed_at: OBSERVED_AT,
  fixture: { instance_revision: INSTANCE_REVISION, policy_revision: fixture.policy.policy_revision, enrollment_links: fixture.enrollment_links,
    instances: INSTANCES.map(item => ({ platform: item.platform, key: item.key, broker_environment: item.config.broker_environment ?? null })) },
  roles: { pair: PAIR, paper, live_on: liveOn, live_off: liveOff, missing_one: single,
    display_only: FIXTURE_ACCOUNTS.find(([managementClass]) => managementClass === "display_only")[1] },
  status_text: { status: MANAGEMENT_STATUS_TEXT, evidence: MANAGEMENT_EVIDENCE_TEXT },
  scenarios, preparations, controls,
};
assert.equal(outbound.count, 0, "zero outbound calls");
const text = `${JSON.stringify(corpus, null, 2)}\n`;
if (process.argv.includes("--write")) {
  await writeFile(OUTPUT, text);
  console.log(JSON.stringify({ suite: "digest_roster_b2_corpus", written: true, scenarios: Object.keys(scenarios).length, preparations: Object.keys(preparations).length, outbound_calls: outbound.count }));
} else {
  const current = await readFile(OUTPUT, "utf8").catch(() => "");
  assert.equal(current, text, "python/tests/fixtures/digest_roster_b2_corpus.json is out of date; run node tests/digest_roster_b2_corpus.mjs --write");
  console.log(JSON.stringify({ suite: "digest_roster_b2_corpus", current: true, scenarios: Object.keys(scenarios).length, preparations: Object.keys(preparations).length, outbound_calls: outbound.count }));
}
