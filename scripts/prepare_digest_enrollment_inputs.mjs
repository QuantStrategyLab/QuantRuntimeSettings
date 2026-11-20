// Offline protected preparation JS step for B3 mapping-mode digest enrollment.
// Runs B2's readback builder + applied-row adapter (exportAppliedRecords) and
// B1's full projectAccountManagement over one coherent DO observation, emitting
// the bundle consumed by `project_digest_display_roster.py prepare-mapping`.
// Zero network calls; synthetic or offline-exported DO observations only.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

const CONSOLE = new URL("../web/strategy-switch-console/", import.meta.url);
const { RuntimeInstances } = await import(new URL("worker.js", CONSOLE));
const {
  buildManagementReadback,
  exportAppliedRecords,
  managementReadCapability,
} = await import(new URL("application/runtime_instances/account_management_readback.js", CONSOLE));
const { projectAccountManagement } = await import(new URL("application/runtime_instances/mapping_projection.js", CONSOLE));

const cursorOf = items => Object.assign(items.values(), { toArray: () => items, one: () => items[0] });

function parseArgs(argv) {
  let inputPath = null;
  let outputPath = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input") { inputPath = argv[++i]; }
    else if (arg === "--output") { outputPath = argv[++i]; }
    else { throw new Error(`unknown_argument:${arg}`); }
  }
  if (!inputPath) throw new Error("missing_input_argument");
  return { inputPath, outputPath };
}

// Coherent single-observation bundle builder: takes one DO observation
// snapshot (`instances`, `instance_revision`, `policy`, `applied_rows`,
// `observed_at`, `inventory`, `collection`, `enrollment_links`).
export async function composeEnrollmentInputs(observation) {
  assert.ok(observation && typeof observation === "object" && !Array.isArray(observation), "invalid_do_observation");
  const db = new DatabaseSync(":memory:");
  try {
    const exec = (statement, ...bindings) => {
      const text = String(statement);
      if (/^\s*(SELECT|WITH|PRAGMA)/i.test(text)) return cursorOf(db.prepare(text).all(...bindings));
      if (bindings.length) { db.prepare(text).run(...bindings); return cursorOf([]); }
      db.exec(text);
      return cursorOf([]);
    };
    const instance = Object.create(RuntimeInstances.prototype);
    instance.sqlStorage = { exec };
    instance.storageInitialized = false;
    instance.initializeStorage();
    db.prepare("INSERT INTO instance_state (id, revision, payload) VALUES (1, ?, ?)").run(
      observation.instance_revision,
      JSON.stringify(observation.instances),
    );
    if (observation.policy) {
      db.prepare("INSERT INTO account_mapping_policy (id, policy_revision, policy_json, updated_at) VALUES (1, ?, ?, ?)").run(
        observation.policy.policy_revision,
        JSON.stringify(observation.policy),
        observation.observed_at,
      );
    }
    for (const row of observation.applied_rows || []) {
      db.prepare("INSERT INTO account_management_applied (platform, account_key, revision, identity_json, membership_json, management_enabled, effective_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        row.platform,
        row.account_key,
        row.revision,
        typeof row.identity_json === "string" ? row.identity_json : JSON.stringify(row.identity_json),
        typeof row.membership_json === "string" ? row.membership_json : JSON.stringify(row.membership_json),
        row.management_enabled,
        row.effective_at,
      );
    }
    const readCapability = managementReadCapability({ sql: { exec } });
    const readback = buildManagementReadback(readCapability.sql, observation.observed_at);
    const appliedRows = db.prepare("SELECT * FROM account_management_applied ORDER BY platform, account_key").all();
    const effective = exportAppliedRecords(appliedRows);
    const state = { initialized: true, revision: observation.instance_revision, instances: observation.instances };
    const projection = projectAccountManagement({
      state,
      inventory: observation.inventory,
      policy: observation.policy,
      collection: observation.collection,
      effective,
      links: observation.enrollment_links || [],
    });
    return {
      instances: observation.instances,
      enrollment_links: observation.enrollment_links || [],
      readback,
      effective_export: effective,
      projection,
    };
  } finally {
    db.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { inputPath, outputPath } = parseArgs(process.argv.slice(2));
  const raw = JSON.parse(await readFile(inputPath, "utf8"));
  const result = await composeEnrollmentInputs(raw);
  const text = `${JSON.stringify(result, null, 2)}\n`;
  if (outputPath) {
    await writeFile(outputPath, text, { encoding: "utf8", mode: 0o600 });
  } else {
    process.stdout.write(text);
  }
}
