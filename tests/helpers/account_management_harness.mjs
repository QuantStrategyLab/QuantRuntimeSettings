// Transaction-capable SQLite harness for the RuntimeInstances management
// store. Each store is a real RuntimeInstances object over a node:sqlite
// database whose storage.transactionSync opens a savepoint, commits on return
// and rolls back on throw, so rollback and commit are observed, not mocked.
// Faults are injected by statement or just before commit. A trap counts
// every outbound fetch; nothing here performs network I/O. Synthetic
// identities only; results carry row IDs, outcome codes and counts.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

const ROOT = new URL("../../", import.meta.url);
const CONSOLE = new URL("web/strategy-switch-console/", ROOT);
export const { RuntimeInstances } = await import(new URL("worker.js", CONSOLE));
export const { accountSettingsIdentity } = await import(new URL("application/account_settings/helpers.js", CONSOLE));
export const management = await import(new URL("application/runtime_instances/account_management.js", CONSOLE));
const fixture = JSON.parse(await readFile(new URL("tests/fixtures/account-mapping-roster.synthetic.json", ROOT), "utf8"));

export const PROVISIONER = "account-mapping-policy-provisioner";
const TS = "2026-01-01T00:00:00.000Z";
// The fixture roster, each deployment given a synthetic account scope so the
// settings identity is complete for the approval paths.
export const INSTANCES = fixture.instances.map((item, index) => ({
  ...item, config: { ...item.config, account_scope: `SYN-SCOPE-${String(index + 1).padStart(2, "0")}` },
  kind: "existing", enabled: null, platform_applied: null, application_status: "unknown", retirement_status: "none", created_at: TS, updated_at: TS,
}));
export const INSTANCE_REVISION = fixture.instance_revision;
export const POLICY_REVISION = fixture.policy.policy_revision;
export const FIXTURE_ACCOUNTS = fixture.policy.accounts.map(account => [account.management_class, account.deployments]);
export const ref = text => { const at = text.indexOf("/"); return [text.slice(0, at), text.slice(at + 1)]; };

export function policyOf(accounts, instances = INSTANCES, revision = POLICY_REVISION) {
  return { format: fixture.policy.format, policy_revision: revision, accounts: accounts.map(([managementClass, deployments]) => ({
    management_class: managementClass,
    deployments: deployments.map(text => {
      const [platform, key] = ref(text);
      return { platform, legacy_key: key, identity: accountSettingsIdentity(instances.find(item => item.platform === platform && item.key === key)) };
    }),
  })) };
}

// Outbound trap: any fetch is counted and refused.
export const outbound = { count: 0 };
globalThis.fetch = async () => { outbound.count += 1; throw new Error("outbound_call_trapped"); };

let sequence = 0;
export function createStore({ file = ":memory:", seed = true, instances = INSTANCES, revision = INSTANCE_REVISION } = {}) {
  const db = new DatabaseSync(file);
  const faults = { exec: null, beforeCommit: null, writes: [] };
  const cursor = rows => Object.assign(rows.values(), { toArray: () => rows, one: () => rows[0] });
  const exec = (statement, ...bindings) => {
    const text = String(statement);
    if (/^\s*(INSERT|UPDATE|DELETE)/i.test(text)) {
      faults.writes.push(text.trim().split(/\s+/).slice(0, 3).join(" "));
      if (faults.exec && faults.exec(text, faults.writes.length - 1)) throw new Error("injected_fault");
    }
    if (/^\s*(SELECT|WITH|PRAGMA)/i.test(text)) return cursor(db.prepare(text).all(...bindings));
    if (bindings.length) { db.prepare(text).run(...bindings); return cursor([]); }
    db.exec(text);
    return cursor([]);
  };
  const storage = {
    sql: { exec },
    transactionSync(fn) {
      const name = `qrt_tx_${sequence++}`;
      db.exec(`SAVEPOINT ${name}`);
      try {
        const result = fn();
        if (faults.beforeCommit && faults.beforeCommit()) throw new Error("injected_commit_fault");
        db.exec(`RELEASE ${name}`);
        return result;
      } catch (error) {
        db.exec(`ROLLBACK TO ${name}`);
        db.exec(`RELEASE ${name}`);
        throw error;
      }
    },
  };
  const object = Object.create(RuntimeInstances.prototype);
  object.storage = storage;
  object.sqlStorage = storage.sql;
  object.storageInitialized = false;
  object.initializeStorage();
  if (seed) db.prepare("INSERT OR IGNORE INTO instance_state (id, revision, payload) VALUES (1, ?, ?)").run(revision, JSON.stringify(instances));
  const store = {
    db, object, faults,
    async call(command) {
      const response = await object.fetch(new Request("https://runtime-instances/", { method: "POST", body: JSON.stringify(command) }));
      return { status: response.status, body: await response.json() };
    },
    state() { return object.read(); },
    instance(platform, key) { return object.read().instances.find(item => item.platform === platform && item.key === key); },
    identity(platform, key) { return accountSettingsIdentity(store.instance(platform, key)); },
    resolve(platform, key) { return management.resolveManagement(management.readManagementSnapshot(object.sql, object.read()), platform, key); },
    rows(table) { return db.prepare(`SELECT * FROM ${table}`).all(); },
    count(table) { return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n; },
    // The full content of the management and instance tables, for exact
    // before/after comparison.
    dump() {
      return Object.fromEntries(["account_mapping_policy", "account_management_draft", "account_management_applied", "account_management_change",
        "account_management_requests", "instance_state", "instance_history", "account_setting_draft", "account_setting_profile_application",
        "risk_profile_authority", "research_promotion_applications", "human_decision_record"]
        .map(table => [table, JSON.stringify(db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())]));
    },
    close() { db.close(); },
  };
  return store;
}

let keys = 0;
export const requestKey = () => `00000000-0000-4000-8000-${String(++keys).padStart(12, "0")}`;

// A management command addressed through one deployment, with the current
// revisions read from the store unless overridden.
export function managementCommand(store, action, platform, key, overrides = {}) {
  const resolution = store.resolve(platform, key);
  const command = {
    action, actor: "synthetic-admin", platform, key, identity: store.identity(platform, key), request_key: requestKey(),
    expected_instance_revision: store.state().revision, expected_policy_revision: resolution.policy_revision,
    expected_management_draft_revision: resolution.draft ? resolution.draft.revision : 0,
    expected_management_revision: resolution.applied ? resolution.applied.revision : 0,
    ...(action === "account_management_draft_save" ? { management_enabled: true } : {}),
  };
  return { ...command, ...overrides };
}

export async function provision(store, policy, expected = 0) {
  return store.call({ action: "account_mapping_policy_replace", actor: PROVISIONER, expected_policy_revision: expected, policy });
}

// Save then apply one physical account's value through one deployment.
export async function setManagement(store, text, enabled, actor = "synthetic-admin") {
  const [platform, key] = ref(text);
  const saved = await store.call(managementCommand(store, "account_management_draft_save", platform, key, { management_enabled: enabled, actor }));
  assert.equal(saved.status, 200, `draft save ${saved.body?.error || ""}`);
  const applied = await store.call(managementCommand(store, "account_management_apply", platform, key, { actor }));
  assert.equal(applied.status, 200, `apply ${applied.body?.error || ""}`);
  return { saved: saved.body, applied: applied.body };
}

// Baseline: the fixture policy provisioned and every eligible physical
// account explicitly initialized as managed. Synthetic, never inferred.
export async function baselineStore(options = {}) {
  const store = createStore(options);
  const provisioned = await provision(store, policyOf(FIXTURE_ACCOUNTS));
  assert.equal(provisioned.status, 200);
  for (const [managementClass, deployments] of FIXTURE_ACCOUNTS) {
    if (managementClass === "eligible") await setManagement(store, deployments[0], true);
  }
  return store;
}

export const statuses = (store, texts = INSTANCES.map(item => `${item.platform}/${item.key}`)) => {
  const counts = {};
  for (const text of texts) { const status = store.resolve(...ref(text)).management_status; counts[status] = (counts[status] || 0) + 1; }
  return counts;
};

// Machine-readable evidence: per row, named outcome codes and counts only.
export function evidence(suite) {
  const rows = {};
  return {
    rows,
    record(row, outcome) { (rows[row] ||= { checks: 0, outcomes: {} }); rows[row].checks += 1; rows[row].outcomes[outcome] = (rows[row].outcomes[outcome] || 0) + 1; },
    report() { return JSON.stringify({ suite, outbound_calls: outbound.count, rows }, null, 2); },
  };
}
