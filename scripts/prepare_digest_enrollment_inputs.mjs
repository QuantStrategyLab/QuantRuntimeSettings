// Offline protected preparation JS step for B3 mapping-mode digest enrollment.
// Runs B2's readback builder + applied-row adapter (exportAppliedRecords) and
// B1's full projectAccountManagement over one coherent DO observation, emitting
// the bundle consumed by `project_digest_display_roster.py prepare-mapping`.
// Zero network calls; synthetic or offline-exported DO observations only.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

const CONSOLE = process.env.QSL_DIGEST_CONSOLE_DIR
  ? pathToFileURL(process.env.QSL_DIGEST_CONSOLE_DIR.replace(/\/?$/, "/"))
  : new URL("../web/strategy-switch-console/", import.meta.url);
const { initializeAccountManagement } = await import(new URL("application/runtime_instances/account_management.js", CONSOLE));
const {
  buildManagementReadback,
  exportAppliedRecords,
  managementReadCapability,
} = await import(new URL("application/runtime_instances/account_management_readback.js", CONSOLE));
const { projectAccountManagement } = await import(new URL("application/runtime_instances/mapping_projection.js", CONSOLE));

const INSTANCE_STATE_DDL = [
  "CREATE TABLE IF NOT EXISTS instance_state (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL, payload TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS instance_history (revision INTEGER PRIMARY KEY, entry TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS account_setting_draft (platform TEXT NOT NULL, account_key TEXT NOT NULL, revision INTEGER NOT NULL, identity_json TEXT NOT NULL, overrides_json TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (platform, account_key))",
  "CREATE TABLE IF NOT EXISTS account_setting_declaration (platform TEXT NOT NULL, account_key TEXT NOT NULL, revision INTEGER NOT NULL, identity_json TEXT NOT NULL, declaration_json TEXT NOT NULL, PRIMARY KEY (platform, account_key))",
  "CREATE TABLE IF NOT EXISTS account_setting_profile_application (request_key TEXT PRIMARY KEY, platform TEXT NOT NULL, account_key TEXT NOT NULL, identity_json TEXT NOT NULL, instance_revision INTEGER NOT NULL, draft_revision INTEGER NOT NULL, old_profile TEXT NOT NULL, new_profile TEXT NOT NULL, approved_by TEXT NOT NULL, approved_at TEXT NOT NULL, status TEXT NOT NULL, workflow_run_id TEXT, workflow_run_attempt TEXT, claimed_at TEXT)",
];
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
    for (const ddl of INSTANCE_STATE_DDL) {
      db.exec(ddl);
    }
    initializeAccountManagement({ exec });
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
