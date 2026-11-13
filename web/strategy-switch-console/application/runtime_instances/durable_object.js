import { dateOnlyExternalFlow, externalFlowEnabled, initializeExternalFlow, normalizeExternalFlow, putExternalFlow, readExternalFlow, readExternalFlowCoverage } from "../account_facts/external_flow.js";
import { initializeExecutions, normalizeExecutions, putExecutions, readExecutions } from "../account_facts/executions.js";
import { DeskError } from "../desk/http.js";
import { DeskReadbackStore, readbackTargets } from "../desk/readback.js";
import { HttpError } from "../http_error.js";
import { KvDirectory, DIRECTORY_PATH } from "../../kv_directory.js";
import { initializeSecretRotation, durableRotationCommand } from "../../secretRotation.js";
import { initializeCredentialMaintenance } from "../../credentialMaintenance.js";
import { runtimeInstanceAccountOptions } from "./command.js";
import { ux1MutateJob, ux1SelectSlot, ux1SlotPayload } from "../ux1/research.js";
import {
  ACCOUNT_DIAGNOSIS_DEDUPE_WINDOW_MS,
  ACCOUNT_DIAGNOSIS_DO_ACTIONS,
  ACCOUNT_DIAGNOSIS_STATUSES,
} from "../account_diagnosis/constants.js";
import { accountDiagnosisConflict, accountDiagnosisTaskFromRow } from "../account_diagnosis/helpers.js";
import { researchPromotionApplicationFromRow } from "./promotion_application_row.js";
import {
  CycleHealthError,
  canonicalCycleJson, compareCycleInstants, cycleCoverageComplete,
  cycleHealthAttemptKey, cycleHealthFaultCategory, cycleHealthFaultTime, normalizeCycleInstant,
} from "../../runtime_cycle_health.js";
import { CredentialMaintenanceError, credentialMaintenanceCommand } from "../../credentialMaintenance.js";
import { RotationError } from "../../secretRotationStepUp.js";

import { accountFactsIdentityDates } from "../account_facts/read.js";
import { runtimeInstanceConflict } from "./command.js";
import { deskErrorResponse } from "../desk/http.js";
import { binanceDetailCommand } from "../../binance_detail_archive.js";
import {
  ACCOUNT_FACTS_FUTURE_SKEW_MS,
  ACCOUNT_FACTS_STALE_MS,
  canonicalizeAccountFactsHistory,
  decideAccountFactsDailyUpsert,
  decideAccountFactsPut,
  historyRetentionCutoff,
  normalizeIbkrPeriodReturn,
  publicIbkrPeriodReturn,
  validFirstradeAccountId,
} from "../../account_facts.js";
import { normalizeBinanceWalletHistoryEntry } from "../../binance_account_facts.js";
import { normalizeMarketBenchmarkSyncPayload } from "../../infrastructure/market_benchmark/market_benchmark.js";
import { BROKER_ENVIRONMENTS } from "../../account_options_schema.js";
import {
  accountSettingsIdentity,
  accountSettingsIdentityIsComplete,
  accountSettingsProfileName,
  applyAccountSettingOverrides,
  canonicalResearchTaskJson,
  deskTargetReadback,
  hkStopDigestOrEmpty,
  hkStopIdentityComplete,
  hkStopSourceIdentity,
  isDcaProfile,
  json,
  normalizeControlPlaneIdentifier,
  promotionMaterialReviewBinding,
  promotionReviewBindingsMatch,
  readRiskProfileLegacy,
  riskProfileBindingTargets,
  riskProfileScopeId,
  runtimeControlIdentityIsComplete,
  runtimeDailyCalendarDate,
  supportedBrokerEnvironmentsForPlatform,
  updateAccountOptionsDefaultStrategy,
  HUMAN_DECISION_DO_ACTIONS,
  ACCOUNT_SETTINGS_DO_ACTIONS,
  ACCOUNT_FACTS_DO_ACTIONS,
  MARKET_BENCHMARK_DO_ACTIONS,
  V7_PAPER_APPLICATION_DO_ACTIONS,
  RUNTIME_CONTROL_DO_ACTIONS,
  HK_STOP_DO_ACTIONS,
  CYCLE_HEALTH_HISTORY_PAGE_SIZE,
  CYCLE_HEALTH_SUMMARY_SCHEMA_VERSION,
} from '../worker/runtime_support.js';

export class RuntimeInstances {
  constructor(ctx, env) {
    this.directory = new KvDirectory(ctx.storage, env?.STRATEGY_SWITCH_CONFIG, env);
    this.storage = ctx.storage;
    this.sql = ctx.storage.sql;
    initializeExecutions(this.sql);
    this.externalFlowEnabled = externalFlowEnabled(env);
    initializeExternalFlow(this.sql);
    initializeCredentialMaintenance(this.sql);
    initializeSecretRotation(this.sql);
    this.rotationEnv = env;
    this.deskReadbacks = new DeskReadbackStore(ctx.storage, async (id, actor) => {
      const state = this.read();
      const target = readbackTargets({ options: runtimeInstanceAccountOptions(state.instances), revision: state.revision }).find(target => target.id === id);
      if (!target) throw new DeskError("not_found", 404);
      let observed = null;
      try { observed = this.readAccountSettings({ platform: target.platform, key: target.key, legacy: await readRiskProfileLegacy(env) }); } catch { /* Degrade saved independently. */ }
      return deskTargetReadback(env, target, actor, observed);
    });
    // Native intervals remain in the existing private account read-model store.
    this.sql.exec(`CREATE TABLE IF NOT EXISTS account_period_return (
      account_key TEXT PRIMARY KEY, payload_json TEXT NOT NULL
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS account_daily_native_return (
      account_key TEXT NOT NULL, source_binding_id TEXT NOT NULL, currency TEXT NOT NULL,
      observation_date TEXT NOT NULL, payload_json TEXT NOT NULL,
      PRIMARY KEY(account_key, source_binding_id, currency, observation_date)
    )`);
    // Dormant: only an independent protected provisioning step may seed admission.
    // There is deliberately no ingress/admin command that writes an admission.
    this.sql.exec(`CREATE TABLE IF NOT EXISTS runtime_cycle_health_source (
      source_id TEXT PRIMARY KEY, target_id TEXT NOT NULL UNIQUE, binding_fingerprint TEXT NOT NULL,
      configuration_sha256 TEXT NOT NULL, authority_revision INTEGER NOT NULL,
      required_from TEXT NOT NULL, observed_at TEXT, observation_json TEXT,
      observation_sha256 TEXT, received_at TEXT, checkpoint_revision INTEGER
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS runtime_cycle_health_checkpoint (
      target_id TEXT NOT NULL, binding_fingerprint TEXT NOT NULL, source_id TEXT NOT NULL,
      revision INTEGER NOT NULL, payload_json TEXT NOT NULL,
      PRIMARY KEY (target_id, binding_fingerprint)
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS runtime_cycle_health_incident (
      target_id TEXT NOT NULL, binding_fingerprint TEXT NOT NULL, source_id TEXT NOT NULL,
      cycle_id TEXT NOT NULL, cycle_json TEXT NOT NULL, category TEXT NOT NULL,
      active_category TEXT, latest_fault_at TEXT NOT NULL, attempt_count INTEGER NOT NULL,
      resolution_history_json TEXT NOT NULL,
      PRIMARY KEY (target_id, binding_fingerprint, source_id, cycle_id)
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS runtime_cycle_health_attempt (
      history_id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_id TEXT NOT NULL, binding_fingerprint TEXT NOT NULL, source_id TEXT NOT NULL,
      cycle_id TEXT NOT NULL, attempt_key TEXT NOT NULL, fault_at TEXT NOT NULL,
      category TEXT NOT NULL, configuration_sha256 TEXT NOT NULL, cycle_json TEXT NOT NULL,
      resolution_ref TEXT,
      UNIQUE (target_id, binding_fingerprint, source_id, attempt_key)
    )`);
    this.sql.exec("CREATE INDEX IF NOT EXISTS runtime_cycle_health_history_page ON runtime_cycle_health_attempt (target_id, source_id, history_id)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS instance_state (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL, payload TEXT NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS instance_history (revision INTEGER PRIMARY KEY, entry TEXT NOT NULL)");
    this.sql.exec(`CREATE TABLE IF NOT EXISTS account_diagnosis_tasks (
      request_id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      account_key TEXT NOT NULL,
      target_id TEXT NOT NULL,
      trigger TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      checks_json TEXT NOT NULL,
      state_fingerprint TEXT NOT NULL,
      status TEXT NOT NULL,
      workflow_run_id TEXT,
      workflow_run_attempt TEXT,
      job_id TEXT,
      summary TEXT NOT NULL,
      reason_code TEXT NOT NULL,
      dispatch_state TEXT NOT NULL,
      recheck_dispatch_state TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    try { this.sql.exec("ALTER TABLE account_diagnosis_tasks ADD COLUMN auto_source TEXT NOT NULL DEFAULT 'manual'"); } catch { /* already present */ }
    try { this.sql.exec("ALTER TABLE account_diagnosis_tasks ADD COLUMN native_json TEXT"); } catch { /* already present */ }
    this.sql.exec("CREATE INDEX IF NOT EXISTS account_diagnosis_tasks_fingerprint ON account_diagnosis_tasks (target_id, state_fingerprint, updated_at)");
    this.sql.exec(`CREATE TABLE IF NOT EXISTS research_promotion_applications (
      application_id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      status TEXT NOT NULL,
      dispatch_state TEXT NOT NULL,
      claim_token TEXT NOT NULL,
      platform_id TEXT NOT NULL,
      account_key TEXT NOT NULL,
      account_scope TEXT NOT NULL,
      account_selector TEXT NOT NULL,
      service_name TEXT NOT NULL,
      broker_environment TEXT NOT NULL,
      expected_revision INTEGER NOT NULL,
      expected_strategy_profile TEXT NOT NULL,
      strategy_profile TEXT NOT NULL,
      candidate_id TEXT NOT NULL,
      config_sha256 TEXT NOT NULL,
      source_commit TEXT NOT NULL,
      approved_ues_revision TEXT NOT NULL,
      desired_state TEXT NOT NULL,
      workflow_run_id TEXT,
      workflow_run_attempt TEXT,
      reason_code TEXT NOT NULL,
      readback_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    // A rejected application is a terminal record, but an explicitly
    // re-qualified user request may create a new attempt. Keep history while
    // deduplicating all still-active/uncertain attempts.
    this.sql.exec("DROP INDEX IF EXISTS research_promotion_applications_ticket_account");
    this.sql.exec("CREATE INDEX IF NOT EXISTS research_promotion_applications_ticket_account_idx ON research_promotion_applications (ticket_id, platform_id, account_key, status)");
    this.sql.exec(`CREATE TABLE IF NOT EXISTS ux1_research_slot (
      login TEXT PRIMARY KEY,
      revision INTEGER NOT NULL,
      draft_json TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      preview_json TEXT,
      intent_json TEXT,
      job_json TEXT
    )`);
    try {
      this.sql.exec("ALTER TABLE ux1_research_slot ADD COLUMN job_json TEXT");
    } catch {
      /* already migrated */
    }
    this.sql.exec(`CREATE TABLE IF NOT EXISTS human_decision_material (
      kind TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      material_key TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      eligible INTEGER NOT NULL,
      expires_at_ms INTEGER,
      legacy_state TEXT NOT NULL,
      legacy_block TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (kind, subject_id)
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS human_decision_record (
      request_key TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      material_key TEXT NOT NULL,
      action TEXT NOT NULL,
      actor TEXT NOT NULL,
      decided_at TEXT NOT NULL,
      target_json TEXT NOT NULL,
      payload_json TEXT NOT NULL
    )`);
    this.sql.exec("CREATE INDEX IF NOT EXISTS human_decision_record_subject ON human_decision_record (kind, subject_id, material_key)");
    this.sql.exec(`CREATE TABLE IF NOT EXISTS human_decision_source_material (
      kind TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      material_key TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      eligible INTEGER NOT NULL,
      expires_at_ms INTEGER,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (kind, subject_id, source_id)
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS risk_profile_authority (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      revision INTEGER NOT NULL,
      imported INTEGER NOT NULL,
      bindings_json TEXT NOT NULL
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS account_setting_draft (
      platform TEXT NOT NULL,
      account_key TEXT NOT NULL,
      revision INTEGER NOT NULL,
      identity_json TEXT NOT NULL,
      overrides_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (platform, account_key)
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS account_setting_declaration (
      platform TEXT NOT NULL, account_key TEXT NOT NULL, revision INTEGER NOT NULL,
      identity_json TEXT NOT NULL, declaration_json TEXT NOT NULL,
      PRIMARY KEY (platform, account_key)
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS account_setting_profile_application (
      request_key TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      account_key TEXT NOT NULL,
      identity_json TEXT NOT NULL,
      instance_revision INTEGER NOT NULL,
      draft_revision INTEGER NOT NULL,
      old_profile TEXT NOT NULL,
      new_profile TEXT NOT NULL,
      approved_by TEXT NOT NULL,
      approved_at TEXT NOT NULL,
      status TEXT NOT NULL,
      workflow_run_id TEXT,
      workflow_run_attempt TEXT,
      claimed_at TEXT
    )`);
    this.sql.exec("CREATE INDEX IF NOT EXISTS account_setting_profile_application_target ON account_setting_profile_application (platform, account_key, status)");
    this.sql.exec(`CREATE TABLE IF NOT EXISTS account_facts_observation (
      platform TEXT NOT NULL,
      account_key TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      observed_finished_at TEXT NOT NULL,
      observation_date TEXT NOT NULL,
      target_id TEXT NOT NULL,
      source_binding_id TEXT NOT NULL,
      account_scope TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (platform, account_key)
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS account_facts_daily (
      platform TEXT NOT NULL,
      account_key TEXT NOT NULL,
      observation_date TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      observed_finished_at TEXT NOT NULL,
      target_id TEXT NOT NULL,
      source_binding_id TEXT NOT NULL,
      account_scope TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (platform, account_key, observation_date)
    )`);
    this.sql.exec("CREATE INDEX IF NOT EXISTS account_facts_daily_account ON account_facts_daily (platform, account_key, observation_date)");
    this.sql.exec(`CREATE TABLE IF NOT EXISTS market_benchmark_daily (
      series_id TEXT NOT NULL,
      observation_date TEXT NOT NULL,
      close TEXT NOT NULL,
      source TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (series_id, observation_date)
    )`);
    this.sql.exec("CREATE INDEX IF NOT EXISTS market_benchmark_daily_date ON market_benchmark_daily (observation_date)");
    this.sql.exec(`CREATE TABLE IF NOT EXISTS market_benchmark_revision_ledger (
      proposal_sha256 TEXT NOT NULL,
      entry_index INTEGER NOT NULL,
      series_id_sha256 TEXT NOT NULL,
      observation_date TEXT NOT NULL,
      prior_close_sha256 TEXT NOT NULL,
      new_close_sha256 TEXT NOT NULL,
      candidate_source TEXT NOT NULL,
      reason TEXT NOT NULL,
      applied_at TEXT NOT NULL,
      PRIMARY KEY (proposal_sha256, entry_index)
    )`);
    this.sql.exec("CREATE INDEX IF NOT EXISTS market_benchmark_revision_ledger_date ON market_benchmark_revision_ledger (observation_date)");
    this.sql.exec(`CREATE TABLE IF NOT EXISTS hk_stop_request (
      request_id TEXT PRIMARY KEY,
      target_id TEXT NOT NULL,
      identity_json TEXT NOT NULL,
      source_revision INTEGER NOT NULL,
      action TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      phase TEXT NOT NULL,
      dispatch_result TEXT,
      workflow_run_id TEXT,
      workflow_run_attempt TEXT,
      updated_at TEXT NOT NULL
    )`);
    this.sql.exec("CREATE INDEX IF NOT EXISTS hk_stop_request_target ON hk_stop_request (target_id, requested_at)");
    for (const column of ["source_identity_sha256", "runtime_identity_sha256", "result_json", "stopped_at"]) {
      try { this.sql.exec(`ALTER TABLE hk_stop_request ADD COLUMN ${column} TEXT`); } catch { /* already present */ }
    }
  }

  emptyCycleHealthState(targetId, bindingId) {
    return {
      schema_version: CYCLE_HEALTH_SUMMARY_SCHEMA_VERSION,
      target_id: targetId, source_binding_id: bindingId,
      incident_count: 0, fault_attempt_count: 0, unresolved_count: 0,
      highest_severity: null, active_category: null, latest_fault_at: null,
      resolution_history_count: 0, history_complete: false,
      execution_authority_granted: false,
    };
  }

  cycleHealthHistoryCursor(sourceId, targetId, bindingFingerprint, throughId, afterId) {
    return [sourceId, targetId, bindingFingerprint, throughId, afterId].join(":");
  }

  cycleHealthHistoryPage(sourceId, targetId, bindingFingerprint, cursor = null) {
    let throughId, afterId;
    if (cursor) {
      const parts = cursor.split(":");
      if (parts.length !== 5 || parts[0] !== sourceId || parts[1] !== targetId || parts[2] !== bindingFingerprint) {
        throw new HttpError("cycle_health_history_cursor_mismatch", 400);
      }
      throughId = Number(parts[3]); afterId = Number(parts[4]);
      if (!Number.isSafeInteger(throughId) || throughId < 0 || !Number.isSafeInteger(afterId) || afterId < 0 || afterId > throughId) {
        throw new HttpError("cycle_health_history_cursor_invalid", 400);
      }
    } else {
      throughId = Number(this.sql.exec("SELECT COALESCE(MAX(history_id), 0) AS highwater FROM runtime_cycle_health_attempt WHERE target_id = ? AND source_id = ?", targetId, sourceId).toArray()[0]?.highwater || 0);
      afterId = 0;
    }
    const rows = this.sql.exec(`SELECT a.history_id, a.binding_fingerprint, a.cycle_id, a.attempt_key, a.fault_at,
        a.category, a.configuration_sha256, a.cycle_json, a.resolution_ref, i.resolution_history_json
      FROM runtime_cycle_health_attempt a JOIN runtime_cycle_health_incident i
        ON i.target_id = a.target_id AND i.binding_fingerprint = a.binding_fingerprint
        AND i.source_id = a.source_id AND i.cycle_id = a.cycle_id
      WHERE a.target_id = ? AND a.source_id = ? AND a.history_id > ? AND a.history_id <= ?
      ORDER BY a.history_id ASC LIMIT ?`, targetId, sourceId, afterId, throughId, CYCLE_HEALTH_HISTORY_PAGE_SIZE + 1).toArray();
    const hasMore = rows.length > CYCLE_HEALTH_HISTORY_PAGE_SIZE;
    const selected = rows.slice(0, CYCLE_HEALTH_HISTORY_PAGE_SIZE);
    const items = selected.map(row => {
      let cycle, resolutionHistory;
      try { cycle = JSON.parse(row.cycle_json); resolutionHistory = JSON.parse(row.resolution_history_json); }
      catch { throw new HttpError("cycle_health_history_stored_invalid", 409); }
      return {
        history_id: row.history_id, binding_fingerprint: row.binding_fingerprint,
        continuity: row.binding_fingerprint === bindingFingerprint ? "same_binding" : "unconfirmed",
        cycle_id: row.cycle_id, attempt_key: row.attempt_key, fault_at: row.fault_at,
        category: row.category, configuration_sha256: row.configuration_sha256,
        cycle, resolution_ref: row.resolution_ref, resolution_history: resolutionHistory,
      };
    });
    const nextCursor = hasMore && selected.length
      ? this.cycleHealthHistoryCursor(sourceId, targetId, bindingFingerprint, throughId, selected.at(-1).history_id)
      : null;
    return {
      items, snapshot_through_id: throughId, complete: !hasMore,
      next_cursor: nextCursor,
    };
  }

  cycleHealthRecordAttempt({ targetId, bindingFingerprint, sourceId, configurationSha, cycle, resolutionRef = null, resolutionHistory = null, state }) {
    const category = cycleHealthFaultCategory(cycle);
    const attemptKey = cycleHealthAttemptKey(cycle);
    const cycleJson = canonicalCycleJson(cycle);
    const oldAttempt = this.sql.exec(`SELECT cycle_json FROM runtime_cycle_health_attempt
      WHERE target_id = ? AND binding_fingerprint = ? AND source_id = ? AND attempt_key = ?`,
    targetId, bindingFingerprint, sourceId, attemptKey).toArray()[0];
    if (oldAttempt) {
      if (oldAttempt.cycle_json !== cycleJson) throw new HttpError("cycle_health_fault_receipt_conflict", 409);
      return { state, inserted: false };
    }
    if (!category) return { state, inserted: false };
    const faultAt = cycleHealthFaultTime(cycle);
    const prior = this.sql.exec(`SELECT * FROM runtime_cycle_health_incident
      WHERE target_id = ? AND binding_fingerprint = ? AND source_id = ? AND cycle_id = ?`,
    targetId, bindingFingerprint, sourceId, cycle.cycle_id).toArray()[0] || null;
    let incidentCycle = cycle, incidentCategory = category, latestFaultAt = faultAt;
    let activeCategory = resolutionRef === null ? category : null;
    let attemptCount = 1;
    let history = resolutionHistory || [];
    if (prior) {
      let oldCycle;
      try { oldCycle = JSON.parse(prior.cycle_json); history = JSON.parse(prior.resolution_history_json); }
      catch { throw new HttpError("cycle_health_checkpoint_invalid", 409); }
      const oldRank = prior.category === "execution_uncertainty" ? 2 : 1;
      const newRank = category === "execution_uncertainty" ? 2 : 1;
      const timeOrder = compareCycleInstants(faultAt, prior.latest_fault_at);
      if (newRank > oldRank || (newRank === oldRank && (timeOrder > 0 || (timeOrder === 0 && attemptKey > cycleHealthAttemptKey(oldCycle))))) {
        incidentCycle = cycle;
      } else {
        incidentCycle = oldCycle;
      }
      incidentCategory = newRank > oldRank ? category : prior.category;
      latestFaultAt = timeOrder > 0 ? faultAt : prior.latest_fault_at;
      attemptCount = prior.attempt_count + 1;
      if (resolutionRef === null) {
        const priorActiveRank = prior.active_category === "execution_uncertainty" ? 2 : prior.active_category === "operational" ? 1 : 0;
        activeCategory = newRank > priorActiveRank ? category : prior.active_category;
      } else activeCategory = prior.active_category;
    }
    this.sql.exec(`INSERT INTO runtime_cycle_health_attempt (
      target_id, binding_fingerprint, source_id, cycle_id, attempt_key, fault_at,
      category, configuration_sha256, cycle_json, resolution_ref
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, targetId, bindingFingerprint, sourceId,
    cycle.cycle_id, attemptKey, faultAt, category, configurationSha, cycleJson, resolutionRef);
    this.sql.exec(`INSERT INTO runtime_cycle_health_incident (
      target_id, binding_fingerprint, source_id, cycle_id, cycle_json, category,
      active_category, latest_fault_at, attempt_count, resolution_history_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(target_id, binding_fingerprint, source_id, cycle_id) DO UPDATE SET
      cycle_json = excluded.cycle_json, category = excluded.category,
      active_category = excluded.active_category, latest_fault_at = excluded.latest_fault_at,
      attempt_count = excluded.attempt_count, resolution_history_json = excluded.resolution_history_json`,
    targetId, bindingFingerprint, sourceId, cycle.cycle_id, canonicalCycleJson(incidentCycle), incidentCategory,
    activeCategory, latestFaultAt, attemptCount, JSON.stringify(history));
    const next = { ...state };
    if (!prior) next.incident_count += 1;
    next.fault_attempt_count += 1;
    if (activeCategory !== null && (!prior || prior.active_category === null)) next.unresolved_count += 1;
    if (!prior && Array.isArray(history)) next.resolution_history_count += history.length;
    if (activeCategory !== null && !next.active_category) next.active_category = activeCategory;
    const stateRank = next.highest_severity === "execution_uncertainty" ? 2 : next.highest_severity === "operational" ? 1 : 0;
    const incidentRank = incidentCategory === "execution_uncertainty" ? 2 : 1;
    if (incidentRank > stateRank) next.highest_severity = incidentCategory;
    const activeRank = next.active_category === "execution_uncertainty" ? 2 : next.active_category === "operational" ? 1 : 0;
    const nextActiveRank = activeCategory === "execution_uncertainty" ? 2 : activeCategory === "operational" ? 1 : 0;
    if (nextActiveRank > activeRank) next.active_category = activeCategory;
    if (!next.latest_fault_at || compareCycleInstants(faultAt, next.latest_fault_at) > 0) next.latest_fault_at = faultAt;
    next.history_complete = false;
    return { state: next, inserted: true };
  }

  migrateCycleHealthCheckpoint(row) {
    let checkpoint;
    try { checkpoint = JSON.parse(row.payload_json); } catch { throw new HttpError("cycle_health_checkpoint_invalid", 409); }
    if (checkpoint?.state?.schema_version === CYCLE_HEALTH_SUMMARY_SCHEMA_VERSION) return checkpoint;
    const oldState = checkpoint?.state;
    if (!oldState || !Array.isArray(oldState.incidents)) throw new HttpError("cycle_health_checkpoint_invalid", 409);
    let state = this.emptyCycleHealthState(row.target_id, oldState.source_binding_id);
    for (const incident of oldState.incidents) {
      if (!incident || !Array.isArray(incident.fault_attempts) || !incident.fault_attempts.length) throw new HttpError("cycle_health_checkpoint_invalid", 409);
      for (const attempt of incident.fault_attempts) {
        if (!attempt?.cycle || typeof attempt.configuration_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(attempt.configuration_sha256)
          || (attempt.resolution_ref !== null && (typeof attempt.resolution_ref !== "string" || !/^[a-f0-9]{64}$/.test(attempt.resolution_ref)))) {
          throw new HttpError("cycle_health_checkpoint_invalid", 409);
        }
        state = this.cycleHealthRecordAttempt({ targetId: row.target_id, bindingFingerprint: row.binding_fingerprint,
          sourceId: row.source_id, configurationSha: attempt.configuration_sha256, cycle: attempt.cycle,
          resolutionRef: attempt.resolution_ref, resolutionHistory: incident.resolution_history || [], state }).state;
      }
    }
    checkpoint.state = state;
    checkpoint.schema_version = "qsl_runtime_cycle_health_checkpoint_state.v2";
    checkpoint.covered_through = null;
    checkpoint.coverage_complete = false;
    checkpoint.coverage_incomplete_reason = "legacy_watermark_unavailable";
    const source = this.sql.exec("SELECT binding_fingerprint, configuration_sha256, required_from, observed_at, observation_json FROM runtime_cycle_health_source WHERE source_id = ?", row.source_id).toArray()[0];
    if (row.binding_fingerprint === source?.binding_fingerprint && checkpoint.baseline_established === true
      && checkpoint.configuration_sha256 === source.configuration_sha256 && checkpoint.required_from === source.required_from
      && source.observation_json && source.observed_at) {
      try {
        const observation = JSON.parse(source.observation_json);
        const coverage = observation?.targets?.[0]?.cycle_health?.coverage;
        if (observation.computed_at === source.observed_at && compareCycleInstants(coverage?.through, observation.computed_at) <= 0
          && cycleCoverageComplete(coverage, { since: source.required_from, through: source.required_from })) {
          checkpoint.covered_through = coverage.through;
          checkpoint.coverage_complete = true;
          checkpoint.coverage_incomplete_reason = null;
        }
      } catch { /* Keep legacy coverage unproven when the stored source record is invalid. */ }
    }
    this.sql.exec("UPDATE runtime_cycle_health_checkpoint SET payload_json = ? WHERE target_id = ? AND binding_fingerprint = ? AND source_id = ? AND revision = ?",
      JSON.stringify(checkpoint), row.target_id, row.binding_fingerprint, row.source_id, row.revision);
    return checkpoint;
  }

  cycleHealthCommand(command) {
    const rows = [...this.sql.exec("SELECT * FROM runtime_cycle_health_source WHERE source_id = ?", command.source_id)];
    const a = rows[0];
    if (!a || a.target_id !== command.target_id || a.binding_fingerprint !== command.binding_fingerprint
      || !/^[a-f0-9]{64}$/.test(a.configuration_sha256)
      || !Number.isSafeInteger(a.authority_revision) || a.authority_revision < 1) throw new HttpError("cycle_health_source_not_admitted", 409);
    try { normalizeCycleInstant(a.required_from); } catch { throw new HttpError("cycle_health_baseline_not_admitted", 409); }
    if (command.action === "cycle_health_admission") return {
      authority_revision: a.authority_revision, configuration_sha256: a.configuration_sha256, required_from: a.required_from,
    };
    if (command.authority_revision !== a.authority_revision || command.configuration_sha256 !== a.configuration_sha256
      || command.required_from !== a.required_from) throw new HttpError("cycle_health_admission_changed", 409);
    let partitions = [...this.sql.exec("SELECT * FROM runtime_cycle_health_checkpoint WHERE target_id = ? AND source_id = ?", a.target_id, a.source_id)];
    const owner = [...this.sql.exec("SELECT source_id FROM runtime_cycle_health_checkpoint WHERE target_id = ? AND binding_fingerprint = ?", a.target_id, a.binding_fingerprint)][0];
    if (owner && owner.source_id !== a.source_id) throw new HttpError("cycle_health_source_partition_conflict", 409);
    partitions = partitions.map(row => ({ ...row, checkpoint: this.migrateCycleHealthCheckpoint(row) }));
    const row = partitions.find(p => p.binding_fingerprint === a.binding_fingerprint) || null;
    const previous = row?.checkpoint || null;
    const priorPartitions = partitions.filter(p => p.binding_fingerprint !== a.binding_fingerprint).map(p => ({
      checkpoint_revision: p.revision, checkpoint: p.checkpoint,
    }));
    if (row && a.checkpoint_revision !== row.revision) throw new HttpError("cycle_health_checkpoint_revision_conflict", 409);
    const state = previous?.state || this.emptyCycleHealthState(a.target_id, command.source_binding_id);
    const admissionTransition = previous && (previous.configuration_sha256 !== a.configuration_sha256 || previous.required_from !== a.required_from);
    const effectiveCheckpoint = admissionTransition ? {
      ...previous, baseline_established: false, covered_through: null, coverage_complete: false,
      coverage_incomplete_reason: "admission_changed",
    } : previous;
    const result = (status, checkpoint = previous, revision = row?.revision || 0) => ({
      ok: true, schema_version: "qsl_runtime_cycle_health_checkpoint.v2", status,
      source_id: a.source_id, target_id: a.target_id, authority_revision: a.authority_revision,
      configuration_sha256: a.configuration_sha256, source_binding_id: command.source_binding_id,
      checkpoint_revision: revision, observed_at: a.observed_at, observation_sha256: a.observation_sha256,
      received_at: a.received_at, required_from: a.required_from, checkpoint,
      covered_through: checkpoint?.covered_through || null,
      coverage_complete: checkpoint?.coverage_complete === true,
      coverage_incomplete_reason: checkpoint?.coverage_incomplete_reason || null,
      ...(command.action === "cycle_health_read"
        ? { history_page: this.cycleHealthHistoryPage(a.source_id, a.target_id, a.binding_fingerprint, command.history_cursor || null) }
        : {}),
      prior_partitions: priorPartitions, continuity: priorPartitions.length ? "unconfirmed" : "same_binding",
      adopted: false, no_order: true, execution_authority_granted: false,
    });
    if (command.action === "cycle_health_read") {
      const r = result(!previous ? "uninitialized" : state.unresolved_count || priorPartitions.length ? "blocked"
        : !effectiveCheckpoint.baseline_established || effectiveCheckpoint.coverage_complete !== true ? "incomplete" : "complete", effectiveCheckpoint);
      if (a.observed_at && (Date.now() - Date.parse(a.observed_at) > ACCOUNT_FACTS_STALE_MS || Date.parse(a.observed_at) - Date.now() > ACCOUNT_FACTS_FUTURE_SKEW_MS)) r.status = "stale";
      if (previous && (previous.configuration_sha256 !== a.configuration_sha256 || previous.required_from !== a.required_from)) r.status = "incomplete";
      if (priorPartitions.length || state.unresolved_count) r.status = "blocked";
      return r;
    }
    if (command.action !== "cycle_health_put") throw new HttpError("unsupported_cycle_health_action", 400);
    const packet = command.observation;
    if (packet.targets[0].cycle_health.configuration_sha256 !== a.configuration_sha256) throw new HttpError("cycle_health_configuration_not_admitted", 409);
    const order = a.observed_at ? compareCycleInstants(packet.computed_at, a.observed_at) : 1;
    if (order < 0) throw new HttpError("cycle_health_stale_observation", 409);
    if (order === 0) {
      if (command.observation_json !== a.observation_json || command.observation_sha256 !== a.observation_sha256) throw new HttpError("cycle_health_observation_conflict", 409);
      return { ...result("unchanged"), schema_version: "qsl_runtime_cycle_health_ack.v1", result: "unchanged" };
    }
    const h = packet.targets[0].cycle_health;
    const transition = previous && (previous.configuration_sha256 !== a.configuration_sha256 || previous.required_from !== a.required_from);
    const expectedCoverageFrom = !transition && previous?.covered_through ? previous.covered_through : a.required_from;
    const scanComplete = cycleCoverageComplete(h.coverage);
    const coverageContinuous = scanComplete
      && compareCycleInstants(h.coverage.from, expectedCoverageFrom) <= 0
      && compareCycleInstants(h.coverage.through, expectedCoverageFrom) >= 0;
    const coveredThrough = coverageContinuous ? h.coverage.through : transition ? null : previous?.covered_through || null;
    const incompleteReason = coverageContinuous ? null : !scanComplete ? "scan_incomplete"
      : compareCycleInstants(h.coverage.from, expectedCoverageFrom) > 0 ? "coverage_gap" : "coverage_not_advanced";
    let nextState = structuredClone(state);
    for (const cycle of h.cycles) {
      nextState = this.cycleHealthRecordAttempt({ targetId: a.target_id, bindingFingerprint: a.binding_fingerprint,
        sourceId: a.source_id, configurationSha: h.configuration_sha256, cycle, state: nextState }).state;
    }
    const baselineEstablished = coverageContinuous
      ? (!previous || transition || previous.baseline_established || !previous.covered_through)
      : Boolean(previous && !transition && previous.baseline_established);
    const checkpoint = {
      schema_version: "qsl_runtime_cycle_health_checkpoint_state.v2",
      configuration_sha256: a.configuration_sha256, required_from: a.required_from,
      baseline_established: baselineEstablished,
      covered_through: coveredThrough, coverage_complete: coverageContinuous,
      coverage_incomplete_reason: incompleteReason,
      state: nextState,
    };
    const revision = (row?.revision || 0) + 1;
    this.sql.exec("UPDATE runtime_cycle_health_source SET observed_at = ?, observation_json = ?, observation_sha256 = ?, received_at = ?, checkpoint_revision = ? WHERE source_id = ?",
      packet.computed_at, command.observation_json, command.observation_sha256, command.received_at, revision, a.source_id);
    this.sql.exec(`INSERT INTO runtime_cycle_health_checkpoint (target_id, binding_fingerprint, source_id, revision, payload_json)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(target_id, binding_fingerprint) DO UPDATE SET revision = excluded.revision, payload_json = excluded.payload_json`,
    a.target_id, a.binding_fingerprint, a.source_id, revision, JSON.stringify(checkpoint));
    a.observed_at = packet.computed_at; a.observation_sha256 = command.observation_sha256; a.received_at = command.received_at;
    return { ...result("stored", checkpoint, revision), schema_version: "qsl_runtime_cycle_health_ack.v1", result: "stored" };
  }

  cycleHealthProvisionCommand(command) {
    const { source_id: sourceId, target_id: targetId, binding_fingerprint: bindingFingerprint,
      configuration_sha256: configurationSha, required_from: requiredFrom,
      expected_authority_revision: expectedRevision } = command || {};
    if (targetId !== "longbridge.paper" || !/^[a-f0-9]{64}$/.test(bindingFingerprint || "")
      || !/^[a-f0-9]{64}$/.test(configurationSha || "")
      || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new HttpError("cycle_health_admission_request_invalid", 400);
    }
    const normalizedSourceId = normalizeControlPlaneIdentifier(sourceId, "source_id", false);
    let normalizedRequiredFrom;
    try { normalizedRequiredFrom = normalizeCycleInstant(requiredFrom); }
    catch { throw new HttpError("cycle_health_baseline_not_admitted", 400); }
    const current = [...this.sql.exec("SELECT * FROM runtime_cycle_health_source WHERE target_id = ?", targetId)][0] || null;
    const sourceOwner = [...this.sql.exec("SELECT * FROM runtime_cycle_health_source WHERE source_id = ?", normalizedSourceId)][0] || null;
    if (sourceOwner && sourceOwner.target_id !== targetId) throw new HttpError("cycle_health_source_target_conflict", 409);
    if (current && current.source_id !== normalizedSourceId) throw new HttpError("cycle_health_source_id_change_requires_support", 409);
    if (current?.binding_fingerprint !== bindingFingerprint
      && [...this.sql.exec("SELECT 1 AS found FROM runtime_cycle_health_checkpoint WHERE target_id = ? AND binding_fingerprint = ?", targetId, bindingFingerprint)][0]) {
      throw new HttpError("cycle_health_binding_partition_reuse_requires_support", 409);
    }
    const currentRevision = current?.authority_revision || 0;
    const sameAdmission = current && current.binding_fingerprint === bindingFingerprint
      && current.configuration_sha256 === configurationSha && current.required_from === normalizedRequiredFrom;
    if (sameAdmission) {
      if (expectedRevision > currentRevision || expectedRevision < currentRevision - 1) {
        throw new HttpError("cycle_health_admission_revision_conflict", 409);
      }
      return {
      ok: true, schema_version: "qsl_runtime_cycle_health_admission.v1", result: "unchanged",
      source_id: normalizedSourceId, target_id: targetId, authority_revision: currentRevision,
      configuration_sha256: configurationSha, required_from: normalizedRequiredFrom,
      status: "admission_unchanged", adopted: false, no_order: true,
      execution_authority_granted: false,
      };
    }
    if (expectedRevision !== currentRevision) throw new HttpError("cycle_health_admission_revision_conflict", 409);
    if (current && compareCycleInstants(normalizedRequiredFrom, current.required_from) > 0) {
      throw new HttpError("cycle_health_baseline_range_shrink_rejected", 409);
    }
    const nextRevision = currentRevision + 1;
    if (!Number.isSafeInteger(nextRevision)) throw new HttpError("cycle_health_admission_revision_exhausted", 409);
    if (!current) {
      this.sql.exec(`INSERT INTO runtime_cycle_health_source (
        source_id, target_id, binding_fingerprint, configuration_sha256,
        authority_revision, required_from, observed_at, observation_json,
        observation_sha256, received_at, checkpoint_revision
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL)`,
      normalizedSourceId, targetId, bindingFingerprint, configurationSha, nextRevision, normalizedRequiredFrom);
    } else {
      const bindingChanged = current.binding_fingerprint !== bindingFingerprint;
      this.sql.exec(`UPDATE runtime_cycle_health_source SET binding_fingerprint = ?, configuration_sha256 = ?,
        authority_revision = ?, required_from = ?, observed_at = ?, observation_json = ?, observation_sha256 = ?,
        received_at = ?, checkpoint_revision = ? WHERE source_id = ? AND authority_revision = ?`,
      bindingFingerprint, configurationSha, nextRevision, normalizedRequiredFrom,
      bindingChanged ? null : current.observed_at,
      bindingChanged ? null : current.observation_json,
      bindingChanged ? null : current.observation_sha256,
      bindingChanged ? null : current.received_at,
      bindingChanged ? null : current.checkpoint_revision,
      normalizedSourceId, currentRevision);
      if (this.sql.exec("SELECT changes() AS changed").toArray()[0]?.changed !== 1) {
        throw new HttpError("cycle_health_admission_revision_conflict", 409);
      }
    }
    return {
      ok: true, schema_version: "qsl_runtime_cycle_health_admission.v1", result: "stored",
      source_id: normalizedSourceId, target_id: targetId, authority_revision: nextRevision,
      configuration_sha256: configurationSha, required_from: normalizedRequiredFrom,
      status: "admission_configured", adopted: false, no_order: true,
      execution_authority_granted: false,
    };
  }

  accountFactsCommand(command) {
    if (!command || typeof command.action !== "string") throw new HttpError("unsupported_account_facts_action", 400);
    if (command.action === "account_daily_native_return_research_read") return this.researchNativeDailyReturns(command);
    if (["binance_detail_put", "binance_detail_read"].includes(command.action)) return binanceDetailCommand(this.sql, command);
    if (command.action === "binance_wallet_history_put" || command.action === "binance_wallet_history_read") {
      return this.binanceWalletHistoryCommand(command);
    }
    if (command.action === "account_period_return_put" || command.action === "account_period_return_read") return this.accountPeriodReturnCommand(command);
    if (["account_executions_put", "account_executions_read"].includes(command.action)) {
      const context = this.accountFactsStorageContext(command);
      if (context.platform !== "ibkr") throw new HttpError("invalid_execution_platform", 400);
      return command.action === "account_executions_read"
        ? { ok: true, executions: readExecutions(this.sql, context) }
        : { ok: true, ...putExecutions(this.sql, context, command.payload) };
    }
    if (command.action === "account_external_flow_put") {
      const context = this.accountFactsStorageContext(command);
      const flow = normalizeExternalFlow(command.externalFlow);
      if (!this.externalFlowEnabled && !dateOnlyExternalFlow(flow)) throw new HttpError("external_flow_disabled", 409);
      const source = { ibkr: "ibkr_flex", schwab: "schwab_transactions", longbridge: "longbridge_cashflow" }[context.platform];
      if (!source || flow.windows.some(w => w.source !== source)) throw new HttpError("external_flow_source_mismatch", 409);
      const stored = putExternalFlow(this.sql, context, flow);
      const readback = readExternalFlow(this.sql, context);
      const readbackVerified = flow.windows.every(w => readback?.windows.some(saved => JSON.stringify(saved) === JSON.stringify(w)));
      if (!readbackVerified) throw new HttpError("external_flow_readback_failed", 503);
      return { ok: true, ...stored, readback_verified: true };
    }
    if (command.action === "account_facts_put") return this.putAccountFactsObservation(command);
    if (command.action === "account_facts_history_put") return this.putAccountFactsHistoricalObservation(command);
    if (command.action === "account_facts_read") return this.readAccountFactsObservation(command);
    if (command.action === "account_facts_list") return this.listAccountFactsObservations(command);
    if (command.action === "account_facts_history_read") return this.readAccountFactsDailyHistory(command);
    throw new HttpError("unsupported_account_facts_action", 400);
  }


  marketBenchmarkCommand(command) {
    if (!command || typeof command.action !== "string") throw new HttpError("unsupported_market_benchmark_action", 400);
    if (command.action === "market_benchmark_read") return this.readMarketBenchmarkPoints(command);
    if (command.action === "market_benchmark_put") return this.putMarketBenchmarkPoints(command);
    if (command.action === "market_benchmark_revise") return this.reviseMarketBenchmarkPoints(command);
    throw new HttpError("unsupported_market_benchmark_action", 400);
  }

  readMarketBenchmarkPoints(command = {}) {
    const rows = this.sql.exec(
      `SELECT series_id, observation_date, close, source FROM market_benchmark_daily
       ORDER BY series_id ASC, observation_date ASC`,
    ).toArray();
    const points = rows.map((row) => ({
      seriesId: row.series_id,
      observationDate: row.observation_date,
      close: row.close,
      ...(row.source ? { source: row.source } : {}),
    }));
    if (command.performance === true) return { ok: true, points };
    return { ok: true, ...publicMarketBenchmarkReadModel(points) };
  }

  putMarketBenchmarkPoints(command) {
    let normalized;
    try {
      normalized = normalizeMarketBenchmarkSyncPayload(command.payload || command);
    } catch (error) {
      if (error instanceof MarketBenchmarkError) throw new HttpError(error.code, error.status || 400);
      throw error;
    }
    const updatedAt = new Date().toISOString();
    let written = 0;
    let unchanged = 0;
    for (const point of normalized.points) {
      const existing = this.sql.exec(
        `SELECT close, source FROM market_benchmark_daily WHERE series_id = ? AND observation_date = ?`,
        point.seriesId,
        point.observationDate,
      ).toArray()[0];
      if (existing && existing.close === point.close
          && (existing.source || null) === (point.source || null)) {
        unchanged += 1;
        continue;
      }
      if (existing && existing.close !== point.close) {
        throw new HttpError("market_benchmark_point_conflict", 409);
      }
      this.sql.exec(
        `INSERT INTO market_benchmark_daily (series_id, observation_date, close, source, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(series_id, observation_date) DO UPDATE SET
           close = excluded.close,
           source = excluded.source,
           updated_at = excluded.updated_at`,
        point.seriesId,
        point.observationDate,
        point.close,
        point.source || null,
        updatedAt,
      );
      written += 1;
    }
    return {
      ok: true,
      stored: true,
      schema_version: MARKET_BENCHMARK_SCHEMA,
      inception_date: this.readMarketBenchmarkPoints().inception_date,
      written,
      unchanged,
      points: normalized.points.length,
    };
  }

  reviseMarketBenchmarkPoints(command) {
    const appliedAt = typeof command.applied_at === "string" && !Number.isNaN(Date.parse(command.applied_at))
      ? command.applied_at
      : new Date().toISOString();
    // Plan is validated by the HTTP layer (hashes + concrete updates); DO only applies.
    const plan = command.plan;
    if (!plan || !Array.isArray(plan.updates) || !Array.isArray(plan.ledger_entries)) {
      throw new HttpError("benchmark_revision_plan_required", 400);
    }
    if (plan.overwrites !== plan.updates.length || plan.deletes !== 0) {
      throw new HttpError("benchmark_revision_plan_invalid", 400);
    }
    const existingProposal = this.sql.exec(
      `SELECT proposal_sha256 FROM market_benchmark_revision_ledger WHERE proposal_sha256 = ? LIMIT 1`,
      plan.proposal_sha256,
    ).toArray()[0];
    if (existingProposal) throw new HttpError("benchmark_revision_already_applied", 409);
    let written = 0;
    for (const point of plan.updates) {
      const existing = this.sql.exec(
        `SELECT close, source FROM market_benchmark_daily WHERE series_id = ? AND observation_date = ?`,
        point.seriesId,
        point.observationDate,
      ).toArray()[0];
      if (!existing) throw new HttpError("benchmark_revision_target_missing", 404);
      if (existing.close === point.close) throw new HttpError("benchmark_revision_noop", 400);
      this.sql.exec(
        `UPDATE market_benchmark_daily SET close = ?, source = ?, updated_at = ? WHERE series_id = ? AND observation_date = ?`,
        point.close,
        point.source || null,
        appliedAt,
        point.seriesId,
        point.observationDate,
      );
      written += 1;
    }
    for (const entry of plan.ledger_entries) {
      this.sql.exec(
        `INSERT INTO market_benchmark_revision_ledger (
           proposal_sha256, entry_index, series_id_sha256, observation_date,
           prior_close_sha256, new_close_sha256, candidate_source, reason, applied_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        entry.proposal_sha256,
        entry.entry_index,
        entry.series_id_sha256,
        entry.observation_date,
        entry.prior_close_sha256,
        entry.new_close_sha256,
        entry.candidate_source,
        entry.reason,
        entry.applied_at || appliedAt,
      );
    }
    return {
      ok: true,
      applied: true,
      proposal_sha256: plan.proposal_sha256,
      overwrites: written,
      deletes: 0,
      ledger_entries: plan.ledger_entries.length,
    };
  }


  binanceWalletHistoryContext(command) {
    const accountKey = command?.account_key;
    const sourceBindingId = command?.source_binding_id;
    if (typeof accountKey !== "string" || !accountKey
        || typeof sourceBindingId !== "string" || !/^[a-f0-9]{64}$/.test(sourceBindingId)
        || command.storage_account_key !== `${accountKey}:${sourceBindingId}`
        || typeof command.target_id !== "string" || !command.target_id
        || typeof command.account_scope !== "string" || !command.account_scope) {
      throw new HttpError("invalid_binance_wallet_history_account", 400);
    }
    return {
      account_key: command.storage_account_key,
      target_id: command.target_id,
      account_scope: command.account_scope,
      source_binding_id: sourceBindingId,
      binding: {
        target_id: command.target_id,
        account_scope: command.account_scope,
        source_binding: { kind: "binance_readonly_scope_revision", id: sourceBindingId },
      },
    };
  }

  binanceWalletHistoryCommand(command) {
    const context = this.binanceWalletHistoryContext(command);
    if (command.action === "binance_wallet_history_read") {
      const rows = this.sql.exec(
        `SELECT payload_json, target_id, source_binding_id, account_scope FROM account_facts_daily
         WHERE platform = 'binance' AND account_key = ? ORDER BY observation_date ASC`,
        context.account_key,
      ).toArray();
      const days = [];
      for (const row of rows) {
        if (row.target_id !== context.target_id || row.source_binding_id !== context.source_binding_id
            || row.account_scope !== context.account_scope) {
          throw new HttpError("binance_wallet_history_identity_mismatch", 409);
        }
        let payload;
        try { payload = JSON.parse(row.payload_json); }
        catch { throw new HttpError("binance_wallet_history_stored_invalid", 409); }
        try { days.push(normalizeBinanceWalletHistoryEntry(payload, context.binding)); }
        catch { throw new HttpError("binance_wallet_history_stored_invalid", 409); }
      }
      return { ok: true, days };
    }

    let history;
    try { history = normalizeBinanceWalletHistoryEntry(command.history, context.binding); }
    catch { throw new HttpError("invalid_binance_wallet_history", 400); }
    const row = this.sql.exec(
      `SELECT payload_json, target_id, source_binding_id, account_scope FROM account_facts_daily
       WHERE platform = 'binance' AND account_key = ? AND observation_date = ?`,
      context.account_key,
      history.observation_date,
    ).toArray()[0];
    let existing = null;
    if (row) {
      if (row.target_id !== context.target_id || row.source_binding_id !== context.source_binding_id
          || row.account_scope !== context.account_scope) {
        throw new HttpError("binance_wallet_history_identity_mismatch", 409);
      }
      try { existing = normalizeBinanceWalletHistoryEntry(JSON.parse(row.payload_json), context.binding); }
      catch { throw new HttpError("binance_wallet_history_stored_invalid", 409); }
    }
    if (existing) {
      const existingTime = Date.parse(existing.report_observed_finished_at);
      const incomingTime = Date.parse(history.report_observed_finished_at);
      if (incomingTime < existingTime) return { ok: true, unchanged: true };
      if (incomingTime === existingTime) {
        if (JSON.stringify(existing) !== JSON.stringify(history)) {
          throw new HttpError("binance_wallet_history_conflict", 409);
        }
        return { ok: true, unchanged: true };
      }
    }
    const updatedAt = new Date().toISOString();
    this.sql.exec(
      `INSERT INTO account_facts_daily (
        platform, account_key, observation_date, payload_json, observed_finished_at,
        target_id, source_binding_id, account_scope, updated_at
      ) VALUES ('binance', ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(platform, account_key, observation_date) DO UPDATE SET
        payload_json = excluded.payload_json,
        observed_finished_at = excluded.observed_finished_at,
        target_id = excluded.target_id,
        source_binding_id = excluded.source_binding_id,
        account_scope = excluded.account_scope,
        updated_at = excluded.updated_at`,
      context.account_key,
      history.observation_date,
      JSON.stringify(history),
      history.report_observed_finished_at,
      context.target_id,
      context.source_binding_id,
      context.account_scope,
      updatedAt,
    );
    const latestDate = this.sql.exec(
      "SELECT MAX(observation_date) AS latest_date FROM account_facts_daily WHERE platform = 'binance' AND account_key = ?",
      context.account_key,
    ).toArray()[0]?.latest_date;
    const cutoff = historyRetentionCutoff(latestDate, BINANCE_WALLET_HISTORY_MAX_DAYS);
    if (cutoff) {
      this.sql.exec("DELETE FROM account_facts_daily WHERE platform = 'binance' AND account_key = ? AND observation_date < ?",
        context.account_key, cutoff);
    }
    return { ok: true, unchanged: false };
  }

  accountPeriodReturnCommand(command) {
    const context = this.accountFactsStorageContext(command);
    if (context.platform !== "ibkr") throw new HttpError("invalid_account_period_return", 400);
    const binding = { ...context, source_binding: { id: context.source_binding_id } };
    const sourceIds = [context.source_binding_id, ...(context.history_source_binding_ids || [])];
    const sources = new Set(sourceIds);
    const readStored = (payloadJson) => {
      const payload = JSON.parse(payloadJson);
      if (!sources.has(payload?.source_binding_id)) throw new HttpError("account_period_return_source_unqualified", 409);
      return normalizeIbkrPeriodReturn(payload, {
        binding: { ...binding, source_binding: { id: payload.source_binding_id } }, enforceFresh: false,
      });
    };
    const existing = this.sql.exec("SELECT payload_json FROM account_period_return WHERE account_key = ?", context.account_key).toArray()[0];
    let prior = null;
    if (existing) {
      try { prior = readStored(existing.payload_json); }
      catch { /* Keep the latest interval unavailable; independently qualify daily rows below. */ }
    }
    if (command.action === "account_period_return_read") {
      const dailyByDay = new Map();
      let conflictingDailyValues = false;
      const conflictingNav = new Set();
      const navByDay = new Map();
      const addDaily = (row) => {
        const key = `${row.currency}:${row.period.to}`;
        const old = dailyByDay.get(key);
        if (old && Number(old.value) !== Number(row.value)) {
          conflictingDailyValues = true;
          return;
        }
        if (row.nav_change) {
          const nav = canonicalResearchTaskJson(row.nav_change);
          if (navByDay.has(key) && navByDay.get(key) !== nav) conflictingNav.add(key);
          else navByDay.set(key, nav);
        }
        if (!old || row.source_binding_id === context.source_binding_id
            || (old.source_binding_id !== context.source_binding_id
              && Date.parse(row.observed_at) > Date.parse(old.observed_at))) dailyByDay.set(key, row);
      };
      const rows = this.sql.exec(`SELECT payload_json FROM account_daily_native_return
        WHERE account_key = ? AND source_binding_id IN (${sourceIds.map(() => "?").join(",")})
        ORDER BY observation_date DESC LIMIT ?`, context.account_key, ...sourceIds, 366 * sourceIds.length);
      for (const stored of rows) {
        let row;
        try { row = readStored(stored.payload_json); } catch { continue; }
        addDaily(row);
      }
      if (prior && prior.period.from === prior.period.to) addDaily(prior);
      if (conflictingDailyValues) return { ok: true, return: {
        ...ACCOUNT_FACTS_RETURN_UNAVAILABLE, reason: "native_return_history_conflict",
      } };
      const daily = [...dailyByDay.values()].sort((a, b) => b.period.to.localeCompare(a.period.to)).slice(0, 366);
      const latest = prior ? publicIbkrPeriodReturn(prior) : { ...ACCOUNT_FACTS_RETURN_UNAVAILABLE };
      if (prior && prior.period.from === prior.period.to && conflictingNav.has(`${prior.currency}:${prior.period.to}`)) delete latest.nav_change;
      return { ok: true, return: { ...latest,
        daily: daily.sort((a, b) => a.period.to.localeCompare(b.period.to)).map(row => {
          const projected = publicIbkrPeriodReturn(row);
          if (conflictingNav.has(`${row.currency}:${row.period.to}`)) delete projected.nav_change;
          return projected;
        }) } };
    }
    const incoming = normalizeIbkrPeriodReturn(command.payload, { binding });
    const historical = command.historical === true;
    if (historical && (incoming.period.from !== incoming.period.to || Date.now() - Date.parse(incoming.period.to + "T00:00:00Z") > 366 * 86400000)) throw new HttpError("invalid_account_daily_return", 400);
    if (prior && !historical) {
      if (incoming.period.to < prior.period.to || Date.parse(incoming.observed_at) < Date.parse(prior.observed_at)) throw new HttpError("account_period_return_stale_write", 409);
      if (incoming.observed_at === prior.observed_at && canonicalResearchTaskJson(incoming) !== canonicalResearchTaskJson(prior)) throw new HttpError("account_period_return_conflict", 409);
    }
    if (incoming.period.from === incoming.period.to) {
      const oldDay = this.sql.exec("SELECT payload_json FROM account_daily_native_return WHERE account_key = ? AND source_binding_id = ? AND currency = ? AND observation_date = ?", context.account_key, context.source_binding_id, incoming.currency, incoming.period.to).toArray()[0];
      if (oldDay) {
        const old = normalizeIbkrPeriodReturn(JSON.parse(oldDay.payload_json), { binding, enforceFresh: false });
        if (Date.parse(incoming.observed_at) < Date.parse(old.observed_at)) throw new HttpError("account_daily_return_stale_write", 409);
        if (incoming.observed_at === old.observed_at && canonicalResearchTaskJson(incoming) !== canonicalResearchTaskJson(old)) throw new HttpError("account_daily_return_conflict", 409);
      }
      this.sql.exec("INSERT INTO account_daily_native_return (account_key, source_binding_id, currency, observation_date, payload_json) VALUES (?, ?, ?, ?, ?) ON CONFLICT(account_key, source_binding_id, currency, observation_date) DO UPDATE SET payload_json = excluded.payload_json", context.account_key, context.source_binding_id, incoming.currency, incoming.period.to, JSON.stringify(incoming));
    }
    if (historical && prior && (incoming.period.to < prior.period.to || Date.parse(incoming.observed_at) < Date.parse(prior.observed_at))) return { ok: true, unchanged: false };
    if (prior && canonicalResearchTaskJson(incoming) === canonicalResearchTaskJson(prior)) return { ok: true, unchanged: true };
    this.sql.exec("INSERT INTO account_period_return (account_key, payload_json) VALUES (?, ?) ON CONFLICT(account_key) DO UPDATE SET payload_json = excluded.payload_json", context.account_key, JSON.stringify(incoming));
    return { ok: true, unchanged: false };
  }

  // Internal only: a future authorized caller must supply verified account and
  // source bindings. The browser/session and publisher routes do not call this.
  researchNativeDailyReturns(command) {
    const context = this.accountFactsStorageContext(command);
    const from = runtimeDailyCalendarDate(command.from), to = runtimeDailyCalendarDate(command.to);
    const start = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`);
    if (context.platform !== "ibkr" || !/^[a-f0-9]{64}$/.test(context.source_binding_id)
      || !context.account_scope || !context.account_selector || !context.target_id
      || typeof command.currency !== "string" || !/^[A-Z]{3}$/.test(command.currency)
      || !from || !to || end < start || (end - start) / 86400000 >= 366)
      throw new HttpError("invalid_native_return_research_range", 400);
    const sources = new Set([context.source_binding_id, ...(context.history_source_binding_ids || [])]);
    let stored;
    try {
      stored = this.sql.exec(`SELECT source_binding_id, currency, observation_date, payload_json
        FROM account_daily_native_return WHERE account_key = ? AND currency = ? AND observation_date >= ? AND observation_date <= ?
        ORDER BY observation_date, source_binding_id LIMIT ?`, context.account_key, command.currency, from, to, 366 * 65 + 1).toArray();
    } catch { throw new HttpError("native_return_read_failed", 503); }
    if (stored.length > 366 * 65) throw new HttpError("native_return_read_limit_exceeded", 503);
    const byDate = new Map();
    const navByDate = new Map();
    const decimal = text => {
      const [whole, fraction = ""] = text.split(".");
      return { number: BigInt(whole + fraction), scale: fraction.length };
    };
    const decimalEqual = (left, right) => {
      const a = decimal(left), b = decimal(right);
      return a.number * 10n ** BigInt(b.scale) === b.number * 10n ** BigInt(a.scale);
    };
    const navFields = ["startingValue", "endingValue", "depositsWithdrawals", "internalCashTransfers", "assetTransfers", "linkingAdjustments"];
    for (const item of stored) {
      const date = runtimeDailyCalendarDate(item.observation_date);
      if (!date) return { ok: false, error: "native_return_record_invalid", date: null };
      if (!sources.has(item.source_binding_id)) return { ok: false, error: "native_return_source_unqualified", date };
      let raw;
      try {
        raw = JSON.parse(item.payload_json);
        const validated = normalizeIbkrPeriodReturn(raw, { binding: { ...context, source_binding: { id: item.source_binding_id } }, enforceFresh: false });
        if (validated.currency !== item.currency || validated.period.from !== date || validated.period.to !== date) throw Error();
      } catch { return { ok: false, error: "native_return_record_invalid", date }; }
      const previous = byDate.get(date);
      if (previous) {
        if (!decimalEqual(previous.value, raw.value))
          return { ok: false, error: "native_return_history_conflict", date };
      }
      if (raw.nav_change) {
        const priorNav = navByDate.get(date), nav = raw.nav_change;
        if (priorNav && (!decimalEqual(priorNav.amount, nav.amount)
          || navFields.some(field => !decimalEqual(priorNav.components[field], nav.components[field]))))
          return { ok: false, error: "native_return_nav_conflict", date };
        navByDate.set(date, nav);
      }
      // SQL order is deterministic; prefer the currently configured source.
      if (!previous || raw.source_binding_id === context.source_binding_id) byDate.set(date, raw);
    }
    const rows = [...byDate.values()];
    const datesWithoutRecords = [];
    for (let day = start; day <= end; day += 86400000) {
      const date = new Date(day).toISOString().slice(0, 10);
      if (!byDate.has(date)) datesWithoutRecords.push(date);
    }
    return { ok: true, status: "ok", currency: command.currency, from, to, rows,
      source_row_count: stored.length, duplicate_row_count: stored.length - rows.length,
      returned_from: rows[0]?.period.to || null, returned_to: rows.at(-1)?.period.to || null,
      dates_without_records: datesWithoutRecords, calendar_qualification: "unknown", published_at: null, historical_pit: "unknown" };
  }

  accountFactsStorageContext(command) {
    if (!ACCOUNT_FACTS_SUPPORTED_PLATFORMS.includes(command?.platform)
        || typeof command.account_key !== "string" || !command.account_key
        || typeof command.account_scope !== "string"
        || typeof command.account_selector !== "string"
        || typeof command.target_id !== "string"
        || typeof command.source_binding_id !== "string") {
      throw new HttpError("invalid_account_facts_account", 400);
    }
    const historyIds = command.history_source_binding_ids;
    if (historyIds !== undefined && (!["account_facts_history_read", "account_facts_history_put", "account_period_return_read", "account_period_return_put", "account_daily_native_return_research_read", "account_executions_read", "account_executions_put"].includes(command.action)
        || !Array.isArray(historyIds) || historyIds.length < 1 || historyIds.length > 64
        || new Set(historyIds).size !== historyIds.length
        || historyIds.some(id => typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id)
          || id === command.source_binding_id))) throw new HttpError("invalid_account_facts_history_sources", 400);
    const brokerAccountId = command.platform === FIRSTRADE_ACCOUNT_FACTS_PLATFORM ? command.broker_account_id : null;
    if (command.platform === FIRSTRADE_ACCOUNT_FACTS_PLATFORM && !validFirstradeAccountId(brokerAccountId)) {
      throw new HttpError("invalid_account_facts_account", 400);
    }
    const brokerAccountHash = command.platform === SCHWAB_ACCOUNT_FACTS_PLATFORM
      ? command.broker_account_hash
      : null;
    if (command.platform === SCHWAB_ACCOUNT_FACTS_PLATFORM
        && (typeof brokerAccountHash !== "string" || !brokerAccountHash || brokerAccountHash.length > 256)) {
      throw new HttpError("invalid_account_facts_account", 400);
    }
    return {
      platform: command.platform,
      ...(command.platform === FIRSTRADE_ACCOUNT_FACTS_PLATFORM ? { broker_account_id: brokerAccountId } : {}),
      account_key: command.account_key,
      account_scope: command.account_scope,
      account_selector: command.account_selector,
      target_id: command.target_id,
      source_binding_id: command.source_binding_id,
      ...(historyIds ? { history_source_binding_ids: [...historyIds] } : {}),
      ...(command.platform === SCHWAB_ACCOUNT_FACTS_PLATFORM
        ? { broker_account_hash: brokerAccountHash }
        : {}),
    };
  }

  validateAccountFactsStoragePayload(payload, context, { historical = false } = {}) {
    try {
      const normalize = historical ? normalizeAccountFactsHistoricalPayload : normalizeAccountFactsHistoryPayload;
      return normalize(payload, {
        expectedPlatform: context.platform,
        expectedTargetId: context.target_id,
        expectedBindingId: context.source_binding_id,
        expectedOptionScope: context.account_scope,
        expectedAccountSelector: context.platform === IBKR_ACCOUNT_FACTS_PLATFORM
          ? context.account_selector
          : null,
        expectedBrokerAccountHash: context.platform === SCHWAB_ACCOUNT_FACTS_PLATFORM
          ? context.broker_account_hash
          : null,
        expectedBrokerAccountId: context.platform === FIRSTRADE_ACCOUNT_FACTS_PLATFORM ? context.broker_account_id : null,
        enforceObservationWindow: false,
      });
    } catch (error) {
      if (error instanceof AccountFactsError) throw new HttpError(error.code, error.status || 400);
      throw error;
    }
  }

  validatePriorAccountFactsForAccount(row, context) {
    if (!row) return null;
    if (row.platform !== context.platform || row.account_key !== context.account_key
        || row.account_scope !== context.account_scope || row.target_id !== context.target_id) {
      throw new HttpError("account_facts_identity_mismatch", 409);
    }
    const priorBindingId = row.payload?.source_binding?.id;
    if (typeof priorBindingId !== "string") throw new HttpError("account_facts_stored_invalid", 409);
    const priorContext = { ...context, source_binding_id: priorBindingId };
    const payload = this.validateAccountFactsStoragePayload(row.payload, priorContext);
    if (row.source_binding_id !== priorBindingId
        || payload.target_id !== row.target_id
        || payload.source_binding.id !== row.source_binding_id) {
      throw new HttpError("account_facts_identity_mismatch", 409);
    }
    return { ...row, payload };
  }

  readAccountFactsRow(platform, accountKey, context = null) {
    const row = this.sql.exec(
      "SELECT payload_json, observed_finished_at, observation_date, target_id, source_binding_id, account_scope FROM account_facts_observation WHERE platform = ? AND account_key = ?",
      platform,
      accountKey,
    ).toArray()[0];
    if (!row) return null;
    let payload;
    try { payload = JSON.parse(row.payload_json); } catch { throw new HttpError("account_facts_stored_invalid", 409); }
    if (context) {
      if (platform !== context.platform || accountKey !== context.account_key
          || row.target_id !== context.target_id
          || row.source_binding_id !== context.source_binding_id
          || row.account_scope !== context.account_scope) {
        throw new HttpError("account_facts_identity_mismatch", 409);
      }
      payload = this.validateAccountFactsStoragePayload(payload, context);
    }
    return {
      platform,
      account_key: accountKey,
      payload,
      observed_finished_at: row.observed_finished_at,
      observation_date: row.observation_date,
      target_id: row.target_id,
      source_binding_id: row.source_binding_id,
      account_scope: row.account_scope,
    };
  }

  putAccountFactsObservation(command) {
    const context = this.accountFactsStorageContext(command);
    if (!command.history || typeof command.history !== "object" || Array.isArray(command.history)) {
      throw new HttpError("invalid_account_facts_history", 400);
    }
    let history;
    try {
      history = this.validateAccountFactsStoragePayload(command.history, context);
    } catch (error) {
      if (error instanceof AccountFactsError) throw new HttpError(error.code, error.status || 400);
      throw error;
    }
    const existingRow = this.validatePriorAccountFactsForAccount(
      this.readAccountFactsRow(command.platform, command.account_key),
      context,
    );
    const decision = decideAccountFactsPut(existingRow?.payload || null, history);
    if (decision.action === "reject") throw new HttpError(decision.reason, decision.status || 409);
    let flowChanged = false;
    if (command.externalFlow !== undefined) {
      if (!this.externalFlowEnabled) throw new HttpError("external_flow_disabled", 409);
      const flow = normalizeExternalFlow(command.externalFlow);
      const source = { ibkr: "ibkr_flex", schwab: "schwab_transactions", longbridge: "longbridge_cashflow" }[context.platform];
      const currencies = new Set(history.broker_reported_balances.map(b => b.currency));
      if (flow.windows.some(w => w.source !== source || !currencies.has(w.currency)
          || Date.parse(w.period_end) > Date.parse(history.observed_finished_at))) {
        throw new HttpError("external_flow_observation_mismatch", 409);
      }
      flowChanged = !putExternalFlow(this.sql, context, flow).unchanged;
    }
    if (decision.action === "keep") {
      // Latest table unchanged; still ensure the accepted day is retained.
      this.upsertAccountFactsDaily(context, history);
      return {
        ok: true,
        stored: true,
        unchanged: !flowChanged,
        platform: command.platform,
        account_key: command.account_key,
        observation_date: existingRow.observation_date,
        observed_finished_at: existingRow.observed_finished_at,
      };
    }
    const updatedAt = new Date().toISOString();
    const payloadJson = JSON.stringify(history);
    this.sql.exec(
      `INSERT INTO account_facts_observation (
        platform, account_key, payload_json, observed_finished_at, observation_date,
        target_id, source_binding_id, account_scope, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(platform, account_key) DO UPDATE SET
        payload_json = excluded.payload_json,
        observed_finished_at = excluded.observed_finished_at,
        observation_date = excluded.observation_date,
        target_id = excluded.target_id,
        source_binding_id = excluded.source_binding_id,
        account_scope = excluded.account_scope,
        updated_at = excluded.updated_at`,
      command.platform,
      command.account_key,
      payloadJson,
      history.observed_finished_at,
      history.observation_date,
      history.target_id,
      history.source_binding.id,
      command.account_scope,
      updatedAt,
    );
    this.upsertAccountFactsDaily(context, history);
    return {
      ok: true,
      stored: true,
      unchanged: false,
      platform: command.platform,
      account_key: command.account_key,
      observation_date: history.observation_date,
      observed_finished_at: history.observed_finished_at,
    };
  }

  putAccountFactsHistoricalObservation(command) {
    const context = this.accountFactsStorageContext(command);
    const sourceId = command.history?.source_binding?.id;
    if (![context.source_binding_id, ...(context.history_source_binding_ids || [])].includes(sourceId)) {
      throw new HttpError("account_facts_binding_unmatched", 409);
    }
    const history = this.validateAccountFactsStoragePayload(command.history,
      { ...context, source_binding_id: sourceId }, { historical: true });
    // Deliberately bypass latest observation and external-flow writes. Reuse
    // daily storage with replacement and retention deletion disabled.
    return { ok: true, stored: true, ...this.upsertAccountFactsDaily(context, history, { appendOnly: true }) };
  }

  readAccountFactsDailyRow(platform, accountKey, observationDate, context = null) {
    const row = this.sql.exec(
      `SELECT payload_json, observed_finished_at, observation_date, target_id, source_binding_id, account_scope
       FROM account_facts_daily WHERE platform = ? AND account_key = ? AND observation_date = ?`,
      platform,
      accountKey,
      observationDate,
    ).toArray()[0];
    if (!row) return null;
    let payload;
    try { payload = JSON.parse(row.payload_json); } catch { throw new HttpError("account_facts_stored_invalid", 409); }
    if (context) {
      if (platform !== context.platform || accountKey !== context.account_key
          || row.target_id !== context.target_id
          || row.source_binding_id !== context.source_binding_id
          || row.account_scope !== context.account_scope) {
        throw new HttpError("account_facts_identity_mismatch", 409);
      }
      payload = this.validateAccountFactsStoragePayload(payload, context);
    }
    return {
      platform,
      account_key: accountKey,
      observation_date: row.observation_date,
      payload,
      observed_finished_at: row.observed_finished_at,
      target_id: row.target_id,
      source_binding_id: row.source_binding_id,
      account_scope: row.account_scope,
    };
  }

  upsertAccountFactsDaily(context, history, { appendOnly = false } = {}) {
    const { platform, account_key: accountKey, account_scope: accountScope } = context;
    const existing = this.validatePriorAccountFactsForAccount(
      this.readAccountFactsDailyRow(platform, accountKey, history.observation_date),
      context,
    );
    if (appendOnly && existing) {
      if (existing.observed_finished_at !== history.observed_finished_at
          || canonicalizeAccountFactsHistory(existing.payload) !== canonicalizeAccountFactsHistory(history)) {
        throw new HttpError("account_facts_daily_conflict", 409);
      }
      return { unchanged: true };
    }
    let decision;
    try {
      decision = decideAccountFactsDailyUpsert(existing?.payload || null, history);
    } catch (error) {
      if (error instanceof AccountFactsError) throw new HttpError(error.code, error.status || 400);
      throw error;
    }
    if (decision.action === "reject") throw new HttpError(decision.reason, decision.status || 409);
    if (decision.action === "skip" || decision.action === "keep") {
      this.pruneAccountFactsDaily(platform, accountKey, history.observation_date);
      return { unchanged: true };
    }
    const updatedAt = new Date().toISOString();
    this.sql.exec(
      `INSERT INTO account_facts_daily (
        platform, account_key, observation_date, payload_json, observed_finished_at,
        target_id, source_binding_id, account_scope, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ${appendOnly ? "" : `ON CONFLICT(platform, account_key, observation_date) DO UPDATE SET
        payload_json = excluded.payload_json,
        observed_finished_at = excluded.observed_finished_at,
        target_id = excluded.target_id,
        source_binding_id = excluded.source_binding_id,
        account_scope = excluded.account_scope,
        updated_at = excluded.updated_at`}`,
      platform,
      accountKey,
      history.observation_date,
      JSON.stringify(history),
      history.observed_finished_at,
      history.target_id,
      history.source_binding.id,
      accountScope,
      updatedAt,
    );
    if (!appendOnly) this.pruneAccountFactsDaily(platform, accountKey, history.observation_date);
    return { unchanged: false };
  }

  pruneAccountFactsDaily(platform, accountKey, latestDate) {
    const cutoff = historyRetentionCutoff(latestDate, ACCOUNT_FACTS_HISTORY_MAX_DAYS);
    if (!cutoff) return;
    this.sql.exec(
      "DELETE FROM account_facts_daily WHERE platform = ? AND account_key = ? AND observation_date < ?",
      platform,
      accountKey,
      cutoff,
    );
  }

  readAccountFactsDailyHistory(command) {
    const context = this.accountFactsStorageContext(command);
    const { platform, account_key: accountKey } = context;
    if (command.projection === "external-flow-coverage") {
      return { ok: true, ...readExternalFlowCoverage(this.sql, context) };
    }
    if (command.projection !== undefined) {
      const dates = accountFactsIdentityDates(command.from, command.to);
      if (command.projection !== "identity" || !dates) {
        throw new HttpError("invalid_account_facts_identity_query", 400);
      }
      // Deliberately exclude payload_json: identity inspection must not read assets.
      const rows = this.sql.exec(
        `SELECT observation_date, observed_finished_at, target_id, source_binding_id, account_scope
         FROM account_facts_daily WHERE platform = ? AND account_key = ?
         AND observation_date >= ? AND observation_date <= ? ORDER BY observation_date ASC`,
        platform, accountKey, dates[0], dates.at(-1),
      ).toArray();
      const same = (value, expected) => typeof value === "string" && value.length > 0 && value.length <= 512
        ? value === expected : null;
      return { ok: true, records: dates.map(date => {
        const matches = rows.filter(row => row.observation_date === date);
        const row = matches.length === 1 ? matches[0] : null;
        const source = row?.source_binding_id;
        return {
          observation_date: date, observed_finished_at: row?.observed_finished_at ?? null,
          target_id_matches: same(row?.target_id, context.target_id),
          source_binding_id_matches: same(source, context.source_binding_id),
          account_scope_matches: same(row?.account_scope, context.account_scope),
          record_revision: null,
          row_present: matches.length > 1 ? null : Boolean(row),
          source_binding_id_trusted: typeof source === "string" && source.length > 0 && source.length <= 512
            ? [context.source_binding_id, ...(context.history_source_binding_ids || [])].includes(source) : null,
          stored_source_binding_id: typeof source === "string" && /^[a-f0-9]{64}$/.test(source) ? source : null,
        };
      }) };
    }
    const rows = this.sql.exec(
      `SELECT payload_json, observed_finished_at, observation_date, target_id, source_binding_id, account_scope
       FROM account_facts_daily WHERE platform = ? AND account_key = ? ORDER BY observation_date ASC`,
      platform,
      accountKey,
    ).toArray();
    const days = [];
    for (const row of rows) {
      // Same-account history may use an explicitly qualified prior source.
      // Current observations and ordinary sync still require the current source.
      if (row.target_id !== context.target_id
          || ![context.source_binding_id, ...(context.history_source_binding_ids || [])].includes(row.source_binding_id)
          || row.account_scope !== context.account_scope) continue;
      let payload;
      try { payload = JSON.parse(row.payload_json); } catch { throw new HttpError("account_facts_stored_invalid", 409); }
      payload = this.validateAccountFactsStoragePayload(payload, { ...context, source_binding_id: row.source_binding_id });
      days.push({
        observation_date: row.observation_date,
        payload,
        observed_finished_at: row.observed_finished_at,
        target_id: row.target_id,
        source_binding_id: row.source_binding_id,
        account_scope: row.account_scope,
      });
    }
    return { ok: true, days,
      externalFlow: readExternalFlow(this.sql, context, { dateOnly: !this.externalFlowEnabled }),
    };
  }

  readAccountFactsObservation(command) {
    const context = this.accountFactsStorageContext(command);
    const row = this.readAccountFactsRow(context.platform, context.account_key, context);
    return { ok: true, observation: row };
  }

  listAccountFactsObservations(command) {
    const wanted = Array.isArray(command.accounts) ? command.accounts : [];
    const observations = [];
    for (const item of wanted) {
      if (!item || typeof item.platform !== "string" || typeof item.account_key !== "string") continue;
      const context = this.accountFactsStorageContext(item);
      try {
        const row = this.readAccountFactsRow(context.platform, context.account_key, context);
        if (row) observations.push(row);
      } catch (error) {
        // A trusted binding rotation makes older rows ineligible for display.
        // Keep them stored for audit, but treat them as absent until refreshed.
        if (!(error instanceof HttpError) || error.message !== "account_facts_identity_mismatch") throw error;
      }
    }
    return { ok: true, observations };
  }

  accountSettingsCommand(command) {
    if (!command || typeof command.actor !== "string" || !command.actor) throw new HttpError("runtime_instance_actor_required", 400);
    if (command.action === "risk_profile_read") return this.readRiskProfileAuthority(command.legacy);
    if (command.action === "risk_profile_replace") return this.replaceRiskProfileAuthority(command);
    if (command.action === "risk_profile_set") return this.setRiskProfileAuthority(command);
    if (command.action === "account_declarations_read") {
      const state = this.read();
      if (!state.initialized) throw new HttpError("runtime_instances_not_initialized", 409);
      return { declarations: state.instances.filter(item => item.kind === "existing").map(item => ({
        platform: item.platform, key: item.key, binding_environment: accountSettingsIdentity(item).broker_environment,
        ...this.accountSettingDeclaration(item, accountSettingsIdentity(item)),
      })) };
    }
    if (command.action === "account_settings_read") return this.readAccountSettings(command);
    if (command.action === "account_settings_save") return this.saveAccountSettings(command);
    if (command.action === "account_settings_profile_application_lookup") return this.readAccountSettingsProfileApplication(command);
    if (command.action === "account_settings_profile_application_approve") return this.approveAccountSettingsProfileApplication(command);
    if (command.action === "account_settings_profile_application_claim") return this.claimAccountSettingsProfileApplication(command);
    throw new HttpError("unsupported_account_settings_action", 400);
  }

  ensureRiskProfileAuthority(legacy) {
    const row = this.sql.exec("SELECT revision, imported, bindings_json FROM risk_profile_authority WHERE id = 1").toArray()[0];
    if (row) return row;
    if (legacy?.state === "blocked") throw new HttpError("risk_profile_bindings_invalid", 409);
    const bindings = legacy?.state === "valid" && Array.isArray(legacy.bindings) ? legacy.bindings : [];
    const payload = JSON.stringify(bindings);
    this.sql.exec("INSERT INTO risk_profile_authority (id, revision, imported, bindings_json) VALUES (1, 0, 1, ?)", payload);
    return { revision: 0, imported: 1, bindings_json: payload };
  }

  storedRiskBindings(row) {
    let bindings;
    try { bindings = JSON.parse(row.bindings_json); } catch { throw new HttpError("risk_profile_bindings_invalid", 409); }
    if (!Array.isArray(bindings)) throw new HttpError("risk_profile_bindings_invalid", 409);
    return bindings;
  }

  assertStoredRiskBinding(binding, accountOptions) {
    if (!binding || Array.isArray(binding) || typeof binding !== "object") throw new HttpError("invalid_risk_profile_binding", 400);
    if (binding.no_order !== true || binding.execution_authority_granted !== false) throw new HttpError("risk_profile_execution_authority_rejected", 400);
    if (binding.scope_id !== riskProfileScopeId(binding.platform, binding.target_name)) throw new HttpError("invalid_risk_profile_binding", 400);
    if (!RISK_PROFILE_PREFERENCES.includes(binding.profile_selection?.risk_preference)) throw new HttpError("invalid_risk_profile_binding", 400);
    const policy = RISK_TIER_POLICY_BINDINGS[binding.profile_selection?.risk_preference];
    if (!policy || binding.profile_selection?.profile_id !== policy.profile_id) {
      throw new HttpError("risk_profile_policy_binding_invalid", 409);
    }
    if (!riskProfileBindingTargets(accountOptions).some((target) => target.platform === binding.platform && target.target_name === binding.target_name)) {
      throw new HttpError("risk_profile_binding_target_not_configured", 409);
    }
  }

  writeRiskProfileAuthority(row, bindings) {
    const current = this.storedRiskBindings(row);
    const same = canonicalResearchTaskJson(current) === canonicalResearchTaskJson(bindings);
    const revision = same ? Number(row.revision) : Number(row.revision) + 1;
    if (!same) this.sql.exec("UPDATE risk_profile_authority SET revision = ?, bindings_json = ? WHERE id = 1", revision, JSON.stringify(bindings));
    const state = this.read();
    return {
      ok: true,
      revision,
      bindings,
      account_options: runtimeInstanceAccountOptions(state.instances),
      instance_revision: state.revision,
      initialized: state.initialized,
      no_order: true,
      execution_authority_granted: false,
    };
  }

  readRiskProfileAuthority(legacy) {
    const row = this.ensureRiskProfileAuthority(legacy);
    const state = this.read();
    return {
      ok: true,
      revision: Number(row.revision),
      bindings: this.storedRiskBindings(row),
      account_options: runtimeInstanceAccountOptions(state.instances),
      instance_revision: state.revision,
      initialized: state.initialized,
      no_order: true,
      execution_authority_granted: false,
    };
  }

  requireRiskRevision(command, row) {
    if (!Number.isSafeInteger(command.expected_revision) || command.expected_revision !== Number(row.revision)) {
      throw new HttpError("risk_profile_revision_conflict", 409);
    }
  }

  replaceRiskProfileAuthority(command) {
    const row = this.ensureRiskProfileAuthority(command.legacy);
    this.requireRiskRevision(command, row);
    const options = runtimeInstanceAccountOptions(this.read().instances);
    if (!Array.isArray(command.bindings)) throw new HttpError("invalid_risk_profile_binding", 400);
    for (const binding of command.bindings) this.assertStoredRiskBinding(binding, options);
    const bindings = [...command.bindings].sort((left, right) => left.scope_id.localeCompare(right.scope_id));
    return this.writeRiskProfileAuthority(row, bindings);
  }

  setRiskProfileAuthority(command) {
    const row = this.ensureRiskProfileAuthority(command.legacy);
    this.requireRiskRevision(command, row);
    const options = runtimeInstanceAccountOptions(this.read().instances);
    if (!riskProfileBindingTargets(options).some((target) => target.platform === command.platform && target.target_name === command.target_name)) {
      throw new HttpError("risk_profile_binding_target_not_configured", 409);
    }
    const scopeId = riskProfileScopeId(command.platform, command.target_name);
    const current = this.storedRiskBindings(row).filter((binding) => binding.scope_id !== scopeId);
    if (command.risk_change === "clear") return this.writeRiskProfileAuthority(row, current);
    if (command.risk_change !== "set") throw new HttpError("invalid_risk_profile_change", 400);
    this.assertStoredRiskBinding(command.binding, options);
    if (command.binding.scope_id !== scopeId) throw new HttpError("invalid_risk_profile_binding", 400);
    current.push(command.binding);
    current.sort((left, right) => left.scope_id.localeCompare(right.scope_id));
    return this.writeRiskProfileAuthority(row, current);
  }

  existingAccountInstance(platform, key) {
    const state = this.read();
    if (!state.initialized) throw new HttpError("runtime_instances_not_initialized", 409);
    const item = state.instances.find((candidate) => candidate.kind === "existing" && candidate.platform === platform && candidate.key === key);
    if (!item) throw new HttpError("account_settings_not_found", 404);
    return { state, item, identity: accountSettingsIdentity(item) };
  }

  accountSettingDraftView(item, identity) {
    const row = this.sql.exec(
      "SELECT revision, identity_json, overrides_json FROM account_setting_draft WHERE platform = ? AND account_key = ?",
      item.platform, item.key,
    ).toArray()[0];
    if (!row) return { status: "empty", revision: 0, identity: null, current_identity: identity, overrides: {} };
    let storedIdentity = null;
    let overrides = {};
    try {
      storedIdentity = JSON.parse(row.identity_json);
      overrides = JSON.parse(row.overrides_json);
    } catch {
      throw new HttpError("account_settings_draft_invalid", 409);
    }
    const conflict = canonicalResearchTaskJson(storedIdentity) !== canonicalResearchTaskJson(identity);
    return {
      status: conflict ? "identity_conflict" : "current",
      revision: Number(row.revision),
      identity: storedIdentity,
      current_identity: identity,
      overrides: overrides && typeof overrides === "object" && !Array.isArray(overrides) ? overrides : {},
    };
  }

  accountSettingDeclaration(item, identity) {
    const row = this.sql.exec("SELECT revision, identity_json, declaration_json FROM account_setting_declaration WHERE platform = ? AND account_key = ?", item.platform, item.key).toArray()[0];
    if (!row) return { status: "empty", revision: 0, environment: null, account_type: null, source: "user_declared" };
    const matches = canonicalResearchTaskJson(JSON.parse(row.identity_json)) === canonicalResearchTaskJson(identity);
    const value = JSON.parse(row.declaration_json);
    return { status: matches ? "current" : "identity_conflict", revision: Number(row.revision),
      environment: matches ? value.environment : null, account_type: matches ? value.account_type : null, source: "user_declared" };
  }

  saveAccountSettingDeclaration(item, identity, command) {
    if (!command.identity || canonicalResearchTaskJson(command.identity) !== canonicalResearchTaskJson(identity)) throw new HttpError("account_settings_identity_conflict", 409);
    const current = this.accountSettingDeclaration(item, identity);
    if (!Number.isSafeInteger(command.expected_declaration_revision) || command.expected_declaration_revision !== current.revision) throw new HttpError("account_settings_declaration_revision_conflict", 409);
    if (current.status === "identity_conflict") throw new HttpError("account_settings_identity_conflict", 409);
    const value = command.declaration;
    if (!value || Array.isArray(value) || typeof value !== "object" || Object.keys(value).some(k => !["environment", "account_type"].includes(k))
      || ![null, "live", "paper"].includes(value.environment) || ![null, "cash", "margin"].includes(value.account_type)) throw new HttpError("invalid_account_settings_declaration", 400);
    if (current.status === "current" && current.environment === value.environment && current.account_type === value.account_type) return;
    this.sql.exec("INSERT INTO account_setting_declaration (platform, account_key, revision, identity_json, declaration_json) VALUES (?, ?, ?, ?, ?) ON CONFLICT (platform, account_key) DO UPDATE SET revision = excluded.revision, identity_json = excluded.identity_json, declaration_json = excluded.declaration_json", item.platform, item.key, current.revision + 1, JSON.stringify(identity), JSON.stringify(value));
  }

  readAccountSettings(command) {
    const { state, item, identity } = this.existingAccountInstance(command.platform, command.key);
    const risk = this.readRiskProfileAuthority(command.legacy);
    const scopeId = riskProfileScopeId(item.platform, identity.target_name);
    const binding = risk.bindings.find((entry) => entry.scope_id === scopeId) || null;
    return {
      ok: true,
      found: true,
      platform: item.platform,
      key: item.key,
      instance_revision: state.revision,
      enabled: item.enabled,
      identity,
      config: item.config,
      draft: this.accountSettingDraftView(item, identity),
      declaration: this.accountSettingDeclaration(item, identity),
      risk: {
        revision: risk.revision,
        scope_id: scopeId,
        preference: binding?.profile_selection?.risk_preference || null,
        binding,
      },
      bindings: risk.bindings,
      account_options: risk.account_options,
      no_order: true,
      execution_authority_granted: false,
    };
  }

  saveAccountSettingDraft(item, identity, command) {
    if (!command.identity || Array.isArray(command.identity) || typeof command.identity !== "object") {
      throw new HttpError("account_settings_identity_required", 400);
    }
    if (canonicalResearchTaskJson(command.identity) !== canonicalResearchTaskJson(identity)) {
      throw new HttpError("account_settings_identity_conflict", 409);
    }
    if (!Number.isSafeInteger(command.expected_draft_revision) || command.expected_draft_revision < 0) {
      throw new HttpError("account_settings_draft_revision_conflict", 409);
    }
    const row = this.sql.exec(
      "SELECT revision, identity_json, overrides_json FROM account_setting_draft WHERE platform = ? AND account_key = ?",
      item.platform, item.key,
    ).toArray()[0];
    const now = new Date().toISOString();
    if (!row) {
      if (command.expected_draft_revision !== 0) throw new HttpError("account_settings_draft_revision_conflict", 409);
      const overrides = applyAccountSettingOverrides({}, command.overrides);
      this.sql.exec(
        "INSERT INTO account_setting_draft (platform, account_key, revision, identity_json, overrides_json, updated_at) VALUES (?, ?, 1, ?, ?, ?)",
        item.platform, item.key, JSON.stringify(identity), JSON.stringify(overrides), now,
      );
      return;
    }
    if (command.expected_draft_revision !== Number(row.revision)) throw new HttpError("account_settings_draft_revision_conflict", 409);
    const storedIdentity = JSON.parse(row.identity_json);
    const conflict = canonicalResearchTaskJson(storedIdentity) !== canonicalResearchTaskJson(identity);
    if (conflict && command.acknowledge_identity_conflict !== true) throw new HttpError("account_settings_identity_conflict", 409);
    const storedOverrides = JSON.parse(row.overrides_json);
    const base = conflict ? {} : storedOverrides;
    const overrides = applyAccountSettingOverrides(base, command.overrides);
    if (!conflict && canonicalResearchTaskJson(overrides) === canonicalResearchTaskJson(storedOverrides)) return;
    this.sql.exec(
      "UPDATE account_setting_draft SET revision = ?, identity_json = ?, overrides_json = ?, updated_at = ? WHERE platform = ? AND account_key = ?",
      Number(row.revision) + 1, JSON.stringify(identity), JSON.stringify(overrides), now, item.platform, item.key,
    );
  }

  saveAccountSettings(command) {
    const { item, identity } = this.existingAccountInstance(command.platform, command.key);
    const hasDraft = Object.prototype.hasOwnProperty.call(command, "overrides");
    const hasRisk = Object.prototype.hasOwnProperty.call(command, "risk_change");
    const hasDeclaration = Object.prototype.hasOwnProperty.call(command, "declaration");
    if (!hasDraft && !hasRisk && !hasDeclaration) throw new HttpError("account_settings_change_required", 400);
    if (hasDeclaration) this.saveAccountSettingDeclaration(item, identity, command);
    if (hasDraft) this.saveAccountSettingDraft(item, identity, command);
    if (hasRisk) {
      if (!command.identity || Array.isArray(command.identity) || typeof command.identity !== "object") {
        throw new HttpError("account_settings_identity_required", 400);
      }
      if (canonicalResearchTaskJson(command.identity) !== canonicalResearchTaskJson(identity)) {
        throw new HttpError("account_settings_identity_conflict", 409);
      }
      this.setRiskProfileAuthority({
        ...command,
        platform: identity.platform,
        target_name: identity.target_name,
        expected_revision: command.expected_risk_revision,
      });
    }
    return { ...this.readAccountSettings(command), adopted: false };
  }

  accountSettingsProfileApplicationFromRow(row) {
    if (!row) return null;
    let identity;
    try { identity = JSON.parse(row.identity_json); } catch { throw new HttpError("account_settings_profile_application_invalid", 409); }
    return {
      request_key: row.request_key,
      platform: row.platform,
      key: row.account_key,
      identity,
      instance_revision: Number(row.instance_revision),
      draft_revision: Number(row.draft_revision),
      old_profile: row.old_profile,
      new_profile: row.new_profile,
      approved_by: row.approved_by,
      approved_at: row.approved_at,
      status: row.status,
      workflow_run_id: row.workflow_run_id || null,
      workflow_run_attempt: row.workflow_run_attempt || null,
      claimed_at: row.claimed_at || null,
      runtime_applied: false,
      variables_updated: false,
      no_order: true,
      execution_authority_granted: false,
    };
  }

  readAccountSettingsProfileApplication(command) {
    const requestKey = String(command.request_key || "");
    if (!ACCOUNT_SETTINGS_PROFILE_APPLICATION_REQUEST_KEY.test(requestKey)) {
      throw new HttpError("account_settings_profile_application_request_invalid", 400);
    }
    const row = this.sql.exec("SELECT * FROM account_setting_profile_application WHERE request_key = ?", requestKey).toArray()[0];
    return { ok: true, application: this.accountSettingsProfileApplicationFromRow(row) };
  }

  approveAccountSettingsProfileApplication(command) {
    const requestKey = String(command.request_key || "");
    if (!ACCOUNT_SETTINGS_PROFILE_APPLICATION_REQUEST_KEY.test(requestKey)) {
      throw new HttpError("account_settings_profile_application_request_invalid", 400);
    }
    if (!SUPPORTED_PLATFORMS.includes(command.platform) || typeof command.key !== "string" || !command.key) {
      throw new HttpError("account_settings_account_required", 400);
    }
    if (!Number.isSafeInteger(command.expected_instance_revision) || command.expected_instance_revision < 0
      || !Number.isSafeInteger(command.expected_draft_revision) || command.expected_draft_revision < 0) {
      throw new HttpError("account_settings_profile_application_revision_invalid", 400);
    }
    const identity = command.identity;
    if (!accountSettingsIdentityIsComplete(identity)) throw new HttpError("account_settings_identity_required", 400);
    const identityJson = canonicalResearchTaskJson(identity);
    const oldProfile = accountSettingsProfileName(command.old_profile);
    const newProfile = accountSettingsProfileName(command.new_profile);
    if (!oldProfile || !newProfile || oldProfile === newProfile) throw new HttpError("account_settings_profile_application_profile_invalid", 400);

    const existing = this.sql.exec("SELECT * FROM account_setting_profile_application WHERE request_key = ?", requestKey).toArray()[0];
    if (existing) {
      const sameRequest = existing.platform === command.platform
        && existing.account_key === command.key
        && existing.identity_json === identityJson
        && Number(existing.instance_revision) === command.expected_instance_revision
        && Number(existing.draft_revision) === command.expected_draft_revision
        && existing.old_profile === oldProfile
        && existing.new_profile === newProfile
        && existing.approved_by === command.actor;
      if (!sameRequest) throw new HttpError("account_settings_profile_application_conflict", 409);
      return { ok: true, replayed: true, application: this.accountSettingsProfileApplicationFromRow(existing) };
    }

    if (command.current_profile !== oldProfile || command.runtime_target_enabled !== false) {
      throw new HttpError("account_settings_profile_application_runtime_conflict", 409);
    }
    const { state, item, identity: currentIdentity } = this.existingAccountInstance(command.platform, command.key);
    if (state.revision !== command.expected_instance_revision || identityJson !== canonicalResearchTaskJson(currentIdentity)) {
      throw new HttpError("account_settings_profile_application_identity_conflict", 409);
    }
    const draft = this.accountSettingDraftView(item, currentIdentity);
    if (draft.status !== "current" || draft.revision !== command.expected_draft_revision
      || canonicalResearchTaskJson(draft.identity) !== identityJson
      || Object.keys(draft.overrides).length !== 1
      || draft.overrides.strategy_profile !== newProfile) {
      throw new HttpError("account_settings_profile_application_draft_conflict", 409);
    }
    if (isDcaProfile(oldProfile) || isDcaProfile(newProfile)) {
      throw new HttpError("account_settings_profile_application_profile_only_required", 409);
    }

    const priorApprovals = this.sql.exec(
      "SELECT request_key, identity_json, instance_revision, draft_revision, old_profile, new_profile FROM account_setting_profile_application WHERE platform = ? AND account_key = ? AND status = 'approved'",
      command.platform, command.key,
    ).toArray();
    for (const prior of priorApprovals) {
      const stale = prior.identity_json !== identityJson
        || Number(prior.instance_revision) !== state.revision
        || Number(prior.draft_revision) !== draft.revision
        || prior.old_profile !== oldProfile
        || prior.new_profile !== newProfile;
      if (stale) {
        this.sql.exec(
          "UPDATE account_setting_profile_application SET status = 'invalidated' WHERE request_key = ? AND status = 'approved'",
          prior.request_key,
        );
      }
    }
    const active = this.sql.exec(
      "SELECT request_key FROM account_setting_profile_application WHERE platform = ? AND account_key = ? AND status IN ('approved', 'claimed') LIMIT 1",
      command.platform, command.key,
    ).toArray()[0];
    if (active) throw new HttpError("account_settings_profile_application_pending", 409);

    const approvedAt = new Date().toISOString();
    this.sql.exec(
      `INSERT INTO account_setting_profile_application
       (request_key, platform, account_key, identity_json, instance_revision, draft_revision,
        old_profile, new_profile, approved_by, approved_at, status, workflow_run_id,
        workflow_run_attempt, claimed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', NULL, NULL, NULL)`,
      requestKey, command.platform, command.key, identityJson, command.expected_instance_revision,
      command.expected_draft_revision, oldProfile, newProfile, command.actor, approvedAt,
    );
    const row = this.sql.exec("SELECT * FROM account_setting_profile_application WHERE request_key = ?", requestKey).toArray()[0];
    return { ok: true, replayed: false, application: this.accountSettingsProfileApplicationFromRow(row) };
  }

  claimAccountSettingsProfileApplication(command) {
    const requestKey = String(command.request_key || "");
    if (!ACCOUNT_SETTINGS_PROFILE_APPLICATION_REQUEST_KEY.test(requestKey)) {
      throw new HttpError("account_settings_profile_application_request_invalid", 400);
    }
    const row = this.sql.exec("SELECT * FROM account_setting_profile_application WHERE request_key = ?", requestKey).toArray()[0];
    if (!row) throw new HttpError("account_settings_profile_application_not_found", 404);
    const workflowRunId = String(command.workflow_run_id || "");
    const workflowRunAttempt = String(command.workflow_run_attempt || "");
    if (!/^\d{1,20}$/.test(workflowRunId) || !/^[1-9]\d{0,5}$/.test(workflowRunAttempt)) {
      throw new HttpError("account_settings_profile_application_run_invalid", 400);
    }
    const identityJson = accountSettingsIdentityIsComplete(command.identity)
      ? canonicalResearchTaskJson(command.identity)
      : "";
    const safeResult = { no_order: true, execution_authority_granted: false, runtime_applied: false, variables_updated: false };
    const boundRequest = identityJson === row.identity_json
      && Number(command.expected_instance_revision) === Number(row.instance_revision)
      && Number(command.expected_draft_revision) === Number(row.draft_revision)
      && command.old_profile === row.old_profile
      && command.new_profile === row.new_profile
      && command.current_profile === row.old_profile
      && command.runtime_target_enabled === false;
    if (!boundRequest) throw new HttpError("account_settings_profile_application_conflict", 409);
    if (row.status === "claimed") {
      if (row.workflow_run_id !== workflowRunId || row.workflow_run_attempt !== workflowRunAttempt) {
        throw new HttpError("account_settings_profile_application_already_claimed", 409);
      }
      return { ok: true, claimed: false, replayed: true, application: this.accountSettingsProfileApplicationFromRow(row), ...safeResult };
    }
    if (row.status !== "approved") throw new HttpError("account_settings_profile_application_conflict", 409);
    if (!Number.isSafeInteger(command.expected_instance_revision) || !Number.isSafeInteger(command.expected_draft_revision)) {
      throw new HttpError("account_settings_profile_application_revision_invalid", 409);
    }
    const { state, item, identity: currentIdentity } = this.existingAccountInstance(row.platform, row.account_key);
    if (state.revision !== Number(row.instance_revision)
      || canonicalResearchTaskJson(currentIdentity) !== row.identity_json) {
      throw new HttpError("account_settings_profile_application_identity_conflict", 409);
    }
    const draft = this.accountSettingDraftView(item, currentIdentity);
    if (draft.status !== "current" || draft.revision !== Number(row.draft_revision)
      || canonicalResearchTaskJson(draft.identity) !== row.identity_json
      || Object.keys(draft.overrides).length !== 1
      || draft.overrides.strategy_profile !== row.new_profile) {
      throw new HttpError("account_settings_profile_application_draft_conflict", 409);
    }
    const claimedAt = new Date().toISOString();
    this.sql.exec(
      `UPDATE account_setting_profile_application
       SET status = 'claimed', workflow_run_id = ?, workflow_run_attempt = ?, claimed_at = ?
       WHERE request_key = ? AND status = 'approved'`,
      workflowRunId, workflowRunAttempt, claimedAt, requestKey,
    );
    const claimedRow = this.sql.exec("SELECT * FROM account_setting_profile_application WHERE request_key = ?", requestKey).toArray()[0];
    return { ok: true, claimed: true, replayed: false, application: this.accountSettingsProfileApplicationFromRow(claimedRow), ...safeResult };
  }

  runtimeControlCommand(command) {
    const platform = command?.platform;
    const key = command?.key;
    if (!["ibkr", "schwab"].includes(platform) || typeof key !== "string" || !key) throw new HttpError("runtime_control_target_invalid", 400);
    const found = this.existingAccountInstance(platform, key);
    const identity = found.identity;
    if (!runtimeControlIdentityIsComplete(identity)) throw new HttpError("runtime_control_identity_incomplete", 409);
    const targetId = `${platform}/${identity.target_name}`;
    const latest = () => {
      const row = this.sql.exec("SELECT * FROM hk_stop_request WHERE target_id = ? ORDER BY requested_at DESC, rowid DESC LIMIT 1", targetId).toArray()[0];
      return row ? { ...this.hkStopPublic(row), result_json: row.result_json || null } : null;
    };
    if (command.action === "runtime_control_read") return { ok: true, record: latest() };
    const requestId = String(command.request_id || "");
    if (!HK_STOP_REQUEST_ID.test(requestId)) throw new HttpError("runtime_control_request_invalid", 400);
    const stored = this.hkStopStored(requestId);
    if (command.action === "runtime_control_claim") {
      if (!["enable", "disable"].includes(command.operation) || !Number.isSafeInteger(command.source_revision)
          || found.state.revision !== command.source_revision
          || canonicalResearchTaskJson(identity) !== canonicalResearchTaskJson(command.identity)) throw new HttpError("runtime_control_identity_conflict", 409);
      if (stored) {
        if (stored.target_id !== targetId || stored.action !== command.operation || stored.identity_json !== canonicalResearchTaskJson(identity)) throw new HttpError("runtime_control_identity_conflict", 409);
        return { ok: true, state: "replay", record: stored };
      }
      const open = this.hkStopPublic(this.sql.exec(
        "SELECT * FROM hk_stop_request WHERE target_id = ? AND phase IN ('reserved', 'unknown', 'accepted', 'partial') ORDER BY requested_at ASC LIMIT 1", targetId,
      ).toArray()[0]);
      if (open) return { ok: true, state: "blocked", record: open };
      const now = new Date().toISOString();
      this.sql.exec(`INSERT INTO hk_stop_request
        (request_id, target_id, identity_json, source_revision, action, requested_at, phase, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'reserved', ?)`, requestId, targetId, canonicalResearchTaskJson(identity), command.source_revision, command.operation, now, now);
      return { ok: true, state: "reserved", record: this.hkStopStored(requestId) };
    }
    if (!stored || stored.target_id !== targetId || stored.identity_json !== canonicalResearchTaskJson(identity)) throw new HttpError("runtime_control_identity_conflict", 409);
    if (command.action === "runtime_control_record") {
      if (!["accepted", "unknown", "rejected"].includes(command.phase)) throw new HttpError("runtime_control_result_invalid", 400);
      if (command.run_id != null && !/^[1-9][0-9]*$/.test(String(command.run_id))) throw new HttpError("runtime_control_result_invalid", 400);
      if (stored.workflow_run_id && command.run_id && String(stored.workflow_run_id) !== String(command.run_id)) throw new HttpError("runtime_control_result_invalid", 409);
      if (stored.phase === "reserved") this.sql.exec(
        "UPDATE hk_stop_request SET phase = ?, dispatch_result = ?, workflow_run_id = ?, updated_at = ? WHERE request_id = ? AND phase = 'reserved'",
        command.phase, command.phase, command.run_id || null, new Date().toISOString(), requestId,
      );
      else if (stored.phase === "unknown" && !stored.workflow_run_id && command.run_id) this.sql.exec(
        "UPDATE hk_stop_request SET workflow_run_id = ?, updated_at = ? WHERE request_id = ? AND phase = 'unknown' AND workflow_run_id IS NULL",
        String(command.run_id), new Date().toISOString(), requestId,
      );
      return { ok: true, record: this.hkStopStored(requestId) };
    }
    if (command.action === "runtime_control_capture") {
      if (!stored.workflow_run_id || String(stored.workflow_run_id) !== String(command.run_id)
          || !/^[1-9][0-9]*$/.test(String(command.platform_run_id || ""))) throw new HttpError("runtime_control_result_invalid", 400);
      let details = {};
      try { details = JSON.parse(latest()?.result_json || "{}"); } catch { throw new HttpError("runtime_control_result_invalid", 409); }
      if (details.platform_run_id && details.platform_run_id !== String(command.platform_run_id)) throw new HttpError("runtime_control_result_invalid", 409);
      details.platform_run_id = String(command.platform_run_id);
      if (["platform_result_unavailable", "platform_dispatch_unverified"].includes(command.reason)) details.reason = command.reason;
      this.sql.exec("UPDATE hk_stop_request SET result_json = ?, updated_at = ? WHERE request_id = ?", JSON.stringify(details), new Date().toISOString(), requestId);
      return { ok: true, record: latest() };
    }
    if (command.action === "runtime_control_begin_check") {
      let details = {};
      try { details = JSON.parse(latest()?.result_json || "{}"); } catch { throw new HttpError("runtime_control_result_invalid", 409); }
      if (!["unknown", "accepted", "partial"].includes(stored.phase) || !details.platform_run_id) throw new HttpError("runtime_control_check_unavailable", 409);
      if (details.check_id && !details.check_complete) return { ok: true, state: "replay", record: latest() };
      if (!HK_STOP_REQUEST_ID.test(String(command.check_id || ""))) throw new HttpError("runtime_control_request_invalid", 400);
      Object.assign(details, { check_id: command.check_id, check_run_id: null, check_complete: false, check_requested_at: new Date().toISOString() });
      this.sql.exec("UPDATE hk_stop_request SET result_json = ?, updated_at = ? WHERE request_id = ?", JSON.stringify(details), new Date().toISOString(), requestId);
      return { ok: true, state: "reserved", record: latest() };
    }
    if (command.action === "runtime_control_record_check") {
      let details = {};
      try { details = JSON.parse(latest()?.result_json || "{}"); } catch { throw new HttpError("runtime_control_result_invalid", 409); }
      if (!details.check_id || details.check_id !== command.check_id) throw new HttpError("runtime_control_result_invalid", 409);
      if (command.run_id != null && !/^[1-9][0-9]*$/.test(String(command.run_id))) throw new HttpError("runtime_control_result_invalid", 400);
      if (details.check_run_id && command.run_id && details.check_run_id !== String(command.run_id)) throw new HttpError("runtime_control_result_invalid", 409);
      if (command.run_id) details.check_run_id = String(command.run_id);
      if (command.complete === true) details.check_complete = true;
      if (command.reason === "readback_dispatch_rejected") details.reason = command.reason;
      this.sql.exec("UPDATE hk_stop_request SET result_json = ?, updated_at = ? WHERE request_id = ?", JSON.stringify(details), new Date().toISOString(), requestId);
      return { ok: true, record: latest() };
    }
    if (command.action === "runtime_control_resolve") {
      if (!["applied", "partial", "protected", "rejected"].includes(command.phase) || !command.run_id
          || String(stored.workflow_run_id) !== String(command.run_id)) throw new HttpError("runtime_control_result_invalid", 400);
      if (command.check_id) {
        let check = {};
        try { check = JSON.parse(latest()?.result_json || "{}"); } catch { throw new HttpError("runtime_control_result_invalid", 409); }
        if (check.check_id !== command.check_id || check.check_run_id !== String(command.check_run_id)) throw new HttpError("runtime_control_result_invalid", 409);
      }
      const reason = ["runtime_control_workflow_permission_denied", "runtime_control_workflow_unavailable", "runtime_control_target_unsupported", "stop_source_permission_denied", "stop_source_not_accessible", "platform_dispatch_rejected", "platform_result_unavailable", "platform_dispatch_unverified"].includes(command.reason) ? command.reason : null;
      let details = {};
      try { details = JSON.parse(latest()?.result_json || "{}"); } catch { throw new HttpError("runtime_control_result_invalid", 409); }
      if (["accepted", "unknown", "partial"].includes(stored.phase)) this.sql.exec(
        "UPDATE hk_stop_request SET phase = ?, result_json = ?, updated_at = ? WHERE request_id = ?", command.phase, JSON.stringify({ ...details, reason }), new Date().toISOString(), requestId,
      );
      return { ok: true, record: latest() };
    }
    throw new HttpError("runtime_control_action_invalid", 400);
  }

  hkStopCommand(command) {
    if (command?.action === "hk_stop_read") return { ok: true, record: this.hkStopOpen() || this.hkStopLatest() };
    if (command?.action === "hk_stop_claim") return this.hkStopClaim(command);
    if (command?.action === "hk_stop_record") return this.hkStopRecord(command);
    if (command?.action === "hk_stop_accept_result") return this.hkStopAcceptResult(command);
    throw new HttpError("unsupported_hk_stop_action", 400);
  }

  hkStopPublic(row) {
    if (!row) return null;
    return {
      target_id: row.target_id,
      request_id: row.request_id,
      identity_json: row.identity_json,
      source_revision: Number(row.source_revision),
      action: row.action,
      requested_at: row.requested_at,
      phase: row.phase,
      dispatch_result: row.dispatch_result || null,
      workflow_run_id: row.workflow_run_id || null,
      workflow_run_attempt: row.workflow_run_attempt || null,
      source_identity_sha256: row.source_identity_sha256 || null,
      runtime_identity_sha256: row.runtime_identity_sha256 || null,
      updated_at: row.updated_at,
    };
  }

  hkStopStored(requestId) {
    return this.hkStopPublic(this.sql.exec("SELECT * FROM hk_stop_request WHERE request_id = ?", requestId).toArray()[0]);
  }

  hkStopOpen() {
    return this.hkStopPublic(this.sql.exec(
      "SELECT * FROM hk_stop_request WHERE target_id = ? AND phase IN ('reserved', 'unknown', 'accepted', 'stopped') ORDER BY requested_at ASC",
      HK_STOP_TARGET_ID,
    ).toArray()[0]);
  }

  hkStopLatest() {
    return this.hkStopPublic(this.sql.exec(
      "SELECT * FROM hk_stop_request WHERE target_id = ? ORDER BY requested_at DESC",
      HK_STOP_TARGET_ID,
    ).toArray()[0]);
  }

  hkStopLiveIdentity(sourceRevision, identity) {
    let found;
    try {
      found = this.existingAccountInstance("longbridge", "hk");
    } catch {
      throw new HttpError("hk_stop_source_conflict", 409);
    }
    if (found.state.revision !== sourceRevision) throw new HttpError("hk_stop_source_conflict", 409);
    const live = hkStopSourceIdentity(found.item.config, found.item);
    if (!hkStopIdentityComplete(live) || canonicalResearchTaskJson(live) !== canonicalResearchTaskJson(identity)) {
      throw new HttpError("hk_stop_source_conflict", 409);
    }
    return live;
  }

  hkStopClaim(command) {
    const requestId = String(command.request_id || "").toLowerCase();
    if (!HK_STOP_REQUEST_ID.test(requestId)) throw new HttpError("invalid_hk_stop_request_id", 400);
    if (command.action_name !== "stop") throw new HttpError("hk_stop_action_conflict", 409);
    const identity = command.identity;
    if (!identity || Array.isArray(identity) || typeof identity !== "object") throw new HttpError("hk_stop_identity_incomplete", 400);
    if (!Number.isSafeInteger(command.source_revision)) throw new HttpError("hk_stop_source_conflict", 409);
    const storedIdentity = canonicalResearchTaskJson(identity);
    const existing = this.hkStopStored(requestId);
    if (existing) {
      if (existing.action !== "stop" || existing.identity_json !== storedIdentity) {
        throw new HttpError("hk_stop_identity_conflict", 409);
      }
      return { ok: true, state: "replay", record: existing };
    }
    const open = this.hkStopOpen();
    if (open) {
      if (open.identity_json !== storedIdentity) throw new HttpError("hk_stop_identity_conflict", 409);
      return { ok: true, state: "blocked", record: open };
    }
    this.hkStopLiveIdentity(command.source_revision, identity);
    const sourceHash = hkStopDigestOrEmpty(command.source_identity_sha256);
    const runtimeHash = hkStopDigestOrEmpty(command.runtime_identity_sha256);
    if ((sourceHash === "") !== (runtimeHash === "")) throw new HttpError("hk_stop_identity_incomplete", 400);
    const now = new Date().toISOString();
    this.sql.exec(
      `INSERT INTO hk_stop_request (
        request_id, target_id, identity_json, source_revision, action, requested_at, phase, dispatch_result, workflow_run_id, workflow_run_attempt, source_identity_sha256, runtime_identity_sha256, updated_at
      ) VALUES (?, ?, ?, ?, 'stop', ?, 'reserved', NULL, NULL, NULL, ?, ?, ?)`,
      requestId, HK_STOP_TARGET_ID, storedIdentity, command.source_revision, now, sourceHash || null, runtimeHash || null, now,
    );
    return { ok: true, state: "reserved", record: this.hkStopStored(requestId) };
  }

  hkStopRecord(command) {
    const requestId = String(command.request_id || "").toLowerCase();
    const phase = command.phase;
    if (!HK_STOP_REQUEST_ID.test(requestId) || !["accepted", "rejected", "unknown"].includes(phase)) {
      throw new HttpError("hk_stop_result_rejected", 400);
    }
    const existing = this.hkStopStored(requestId);
    if (!existing) throw new HttpError("hk_stop_request_conflict", 409);
    if (existing.phase === "stopped" || existing.phase !== "reserved") return { ok: true, recorded: false, record: existing };
    const now = new Date().toISOString();
    this.sql.exec(
      "UPDATE hk_stop_request SET phase = ?, dispatch_result = ?, updated_at = ? WHERE request_id = ? AND phase = 'reserved'",
      phase, phase, now, requestId,
    );
    return { ok: true, recorded: true, record: this.hkStopStored(requestId) };
  }

  hkStopAcceptResult(command) {
    const result = command?.result;
    const now = Date.parse(command?.now);
    if (!result?.producer || !result.readback) throw new HttpError("hk_stop_result_rejected", 400);
    const requestId = String(result?.request_id || "").toLowerCase();
    if (!HK_STOP_REQUEST_ID.test(requestId) || !Number.isFinite(now)) throw new HttpError("hk_stop_result_rejected", 400);
    const row = this.sql.exec("SELECT * FROM hk_stop_request WHERE request_id = ?", requestId).toArray()[0];
    if (!row) throw new HttpError("hk_stop_request_conflict", 409);
    if (!row.source_identity_sha256 || !row.runtime_identity_sha256) {
      throw new HttpError("hk_stop_result_unlinked", 409);
    }
    const requestedAt = Date.parse(row.requested_at);
    const observedAt = Date.parse(result.observed_at);
    if (!Number.isFinite(requestedAt) || !Number.isFinite(observedAt)) throw new HttpError("hk_stop_result_rejected", 400);
    if (result.source_revision !== Number(row.source_revision)
      || result.source_identity_sha256 !== row.source_identity_sha256
      || result.runtime_identity_sha256 !== row.runtime_identity_sha256
      || result.target_id !== row.target_id) {
      throw new HttpError("hk_stop_identity_conflict", 409);
    }
    let live;
    try {
      live = this.existingAccountInstance("longbridge", "hk");
    } catch {
      throw new HttpError("hk_stop_identity_conflict", 409);
    }
    const current = hkStopSourceIdentity(live.item.config, live.item);
    if (!hkStopIdentityComplete(current) || canonicalResearchTaskJson(current) !== row.identity_json) {
      throw new HttpError("hk_stop_identity_conflict", 409);
    }
    if (observedAt < requestedAt || observedAt > now + 60000) throw new HttpError("hk_stop_result_stale", 409);
    const canonical = canonicalResearchTaskJson(result);
    const sameRun = row.workflow_run_id === result.producer.run_id && String(row.workflow_run_attempt) === String(result.producer.run_attempt);
    if (row.phase === "stopped") {
      if (row.result_json === canonical && sameRun) return { ok: true, replayed: true, record: this.hkStopStored(requestId) };
      throw new HttpError("hk_stop_result_conflict", 409);
    }
    if (!["reserved", "accepted", "unknown"].includes(row.phase)) throw new HttpError("hk_stop_result_conflict", 409);
    if (now - requestedAt > 24 * 60 * 60 * 1000) throw new HttpError("hk_stop_result_stale", 409);
    const stamp = new Date(now).toISOString();
    this.sql.exec(
      `UPDATE hk_stop_request
       SET phase = 'stopped', workflow_run_id = ?, workflow_run_attempt = ?, result_json = ?, stopped_at = ?, updated_at = ?
       WHERE request_id = ? AND phase IN ('reserved', 'accepted', 'unknown')`,
      result.producer.run_id, String(result.producer.run_attempt), canonical, stamp, stamp, requestId,
    );
    const stored = this.hkStopStored(requestId);
    if (stored?.phase !== "stopped") throw new HttpError("hk_stop_result_conflict", 409);
    return { ok: true, replayed: false, record: stored };
  }

  read() {
    const row = this.sql.exec("SELECT revision, payload FROM instance_state WHERE id = 1").toArray()[0];
    return row ? { revision: row.revision, instances: JSON.parse(row.payload), initialized: true } : { revision: 0, instances: [], initialized: false };
  }

  response(state) {
    return {
      ok: true, ...state, account_options: runtimeInstanceAccountOptions(state.instances),
      history: this.sql.exec("SELECT entry FROM instance_history ORDER BY revision DESC LIMIT 50").toArray().map((row) => JSON.parse(row.entry)),
      no_order: true, execution_authority_granted: false,
    };
  }

  async alarm() { await this.deskReadbacks.alarm(); }

  async fetch(request) {
    try {
      if (new URL(request.url).pathname === DIRECTORY_PATH) {
        if (request.method !== "POST") throw new HttpError("method_not_allowed", 405);
        const result = await this.directory.command(await request.json());
        return json(result, result.ok ? 200 : 503);
      }
      if (request.method === "GET") return json(this.response(this.read()));
      if (request.method !== "POST") throw new HttpError("method_not_allowed", 405);
      let command;
      try { command = await request.json(); } catch { throw new HttpError("invalid_runtime_instance_request", 400); }
      if (["desk_readback_start", "desk_readback_get", "desk_readback_fresh"].includes(command?.action)) {
        try { return json(await this.deskReadbacks.command(command)); }
        catch (error) { return deskErrorResponse(error); }
      }
      if (typeof command?.action === "string" && command.action.startsWith("rotation_")) {
        return json(await durableRotationCommand(this.storage, this.sql, this.rotationEnv, command));
      }
      if (["credential_maintenance_read", "credential_maintenance_save", "credential_maintenance_claim", "credential_maintenance_ack"].includes(command?.action)) {
        return json(this.storage.transactionSync(() => credentialMaintenanceCommand(this.sql, command)));
      }
      if (ACCOUNT_DIAGNOSIS_DO_ACTIONS.has(command?.action)) {
        return json(await this.accountDiagnosisCommand(command));
      }
      if (["console_decision_history", "console_settings_history", "console_account_metadata", "console_audit_events"].includes(command?.action)) {
        return json(this.consoleReadCommand(command));
      }
      if (HUMAN_DECISION_DO_ACTIONS.has(command?.action)) {
        return json(this.humanDecisionCommand(command));
      }
      if (V7_PAPER_APPLICATION_DO_ACTIONS.has(command?.action)) {
        return json(await this.applicationCommand(command));
      }
      if (typeof command?.action === "string" && command.action.startsWith("ux1_")) {
        return json(this.ux1ResearchCommand(command));
      }
      if (["cycle_health_admission", "cycle_health_put", "cycle_health_read", "cycle_health_provision"].includes(command?.action)) {
        if (command.action === "cycle_health_provision") {
          return json(this.storage.transactionSync(() => this.cycleHealthProvisionCommand(command)));
        }
        return json(this.storage.transactionSync(() => this.cycleHealthCommand(command)));
      }
      if (ACCOUNT_SETTINGS_DO_ACTIONS.has(command?.action)) {
        return json(this.storage.transactionSync(() => this.accountSettingsCommand(command)));
      }
      if (ACCOUNT_FACTS_DO_ACTIONS.has(command?.action)) {
        const result = this.storage.transactionSync(() => this.accountFactsCommand(command));
        return json(result, command.action === "account_daily_native_return_research_read" && !result.ok ? 409 : 200);
      }
      if (MARKET_BENCHMARK_DO_ACTIONS.has(command?.action)) {
        return json(this.storage.transactionSync(() => this.marketBenchmarkCommand(command)));
      }
      if (RUNTIME_CONTROL_DO_ACTIONS.has(command?.action)) {
        return json(this.storage.transactionSync(() => this.runtimeControlCommand(command)));
      }
      if (HK_STOP_DO_ACTIONS.has(command?.action)) {
        return json(this.storage.transactionSync(() => this.hkStopCommand(command)));
      }
      // No awaits or external I/O inside this SQLite transaction. Every state
      // change, version advance, and history row commits together or rolls back.
      return json(this.storage.transactionSync(() => {
        const state = this.read();
        if (!command || typeof command.actor !== "string" || !command.actor) throw new HttpError("runtime_instance_actor_required", 400);
        if (command.action !== "sync_defaults") {
          if (!Number.isSafeInteger(command.expected_revision) || command.expected_revision < 0) throw new HttpError("runtime_instance_revision_required", 400);
          if (command.expected_revision !== state.revision) throw new HttpError("runtime_instance_revision_conflict", 409);
        }
        const ts = new Date().toISOString();
        let changed = true;
        let before = null;
        let after = null;
        if (command.action === "initialize") {
          if (state.initialized) throw new HttpError("runtime_instances_already_initialized", 409);
          for (const [platform, options] of Object.entries(command.account_options)) {
            for (const config of options) {
              if (state.instances.some((item) => item.platform === platform && (item.key === config.key || item.config.target_name === config.target_name))) throw new HttpError("runtime_instance_identity_conflict", 409);
              state.instances.push({ platform, key: config.key, kind: "existing", config, enabled: null, platform_applied: null, application_status: "unknown", retirement_status: "none", created_at: ts, updated_at: ts });
            }
          }
          state.initialized = true;
        } else {
          if (!state.initialized) throw new HttpError("runtime_instances_not_initialized", 409);
          const item = state.instances.find((candidate) => candidate.platform === command.platform && candidate.key === command.key);
          if (command.action === "create") {
            if (state.instances.length >= 120) throw new HttpError("runtime_instance_limit_reached", 409);
            runtimeInstanceConflict(state.instances, command.platform, command.config);
            after = { platform: command.platform, key: command.config.key, kind: "draft", config: command.config, enabled: false, platform_applied: false, application_status: "unapplied", retirement_status: "none", created_at: ts, updated_at: ts };
            state.instances.push(after);
          } else if (command.action === "edit") {
            if (!item || item.kind !== "draft" || item.retirement_status !== "none") throw new HttpError("runtime_instance_draft_edit_required", 409);
            if (item.key !== command.config.key) throw new HttpError("runtime_instance_key_immutable", 409);
            runtimeInstanceConflict(state.instances, command.platform, command.config, item.key);
            before = structuredClone(item);
            item.config = command.config;
            item.updated_at = ts;
            after = item;
          } else if (command.action === "request_retirement") {
            if (!item) throw new HttpError("runtime_instance_not_found", 404);
            before = structuredClone(item);
            changed = item.retirement_status !== "requested";
            item.retirement_status = "requested";
            if (changed) item.updated_at = ts;
            after = item;
          } else if (command.action === "set_broker_environment") {
            if (!item || item.kind !== "existing") throw new HttpError("runtime_instance_existing_required", 409);
            if (!BROKER_ENVIRONMENTS.includes(command.broker_environment)
              || !supportedBrokerEnvironmentsForPlatform(command.platform).includes(command.broker_environment)) {
              throw new HttpError("invalid_broker_environment", 400);
            }
            before = structuredClone(item);
            changed = item.config.broker_environment !== command.broker_environment;
            if (changed) {
              item.config = { ...item.config, broker_environment: command.broker_environment };
              item.updated_at = ts;
            }
            after = item;
          } else if (command.action === "sync_defaults") {
            const current = runtimeInstanceAccountOptions(state.instances);
            const update = updateAccountOptionsDefaultStrategy(current, command.inputs);
            changed = update.changed;
            for (const instance of state.instances) {
              if (instance.kind !== "existing") continue;
              const config = update.options[instance.platform]?.find((option) => option.key === instance.key);
              if (config) {
                const defaults = {};
                for (const field of ["default_execution_mode", "default_strategy_profile"]) {
                  if (instance.config[field] !== undefined) defaults[field] = instance.config[field];
                }
                instance.config = { ...config, ...defaults };
              }
            }
          } else {
            throw new HttpError("unsupported_runtime_instance_action", 400);
          }
        }
        if (changed) {
          state.revision += 1;
          this.sql.exec("INSERT INTO instance_state (id, revision, payload) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, payload = excluded.payload", state.revision, JSON.stringify(state.instances));
          try {
            this.sql.exec("INSERT INTO instance_history (revision, entry) VALUES (?, ?)", state.revision, JSON.stringify({ revision: state.revision, ts, login: command.actor, action: command.action, before, after }));
          } catch (error) {
            // Fixture / storage aborts must surface as revision conflicts, not DO crashes.
            throw new HttpError(error?.message || "runtime_instance_transaction_failed", 409);
          }
        }
        return this.response(state);
      }));
    } catch (error) {
      return json({ ok: false, error: error instanceof HttpError || error instanceof CycleHealthError || error instanceof CredentialMaintenanceError || error instanceof RotationError ? error.message : "runtime_instance_transaction_failed" }, error instanceof HttpError || error instanceof CycleHealthError || error instanceof CredentialMaintenanceError || error instanceof RotationError ? error.status : 409);
    }
  }

  accountDiagnosisCommand(command) {
    return this.storage.transactionSync(() => {
      if (!command || typeof command.actor !== "string" || !command.actor) {
        throw new HttpError("runtime_instance_actor_required", 400);
      }
      if (command.action === "diagnosis_create") {
        const autoSource = command.auto_source === "source_sync" ? "source_sync" : "manual";
        // Unclosed work keeps its original obligation regardless of age or fingerprint.
        const unresolved = this.sql.exec("SELECT * FROM account_diagnosis_tasks WHERE target_id = ? AND status IN ('queued', 'running', 'unknown') ORDER BY updated_at DESC LIMIT 1", command.target_id).toArray()[0];
        if (unresolved) return { ok: true, created: false, task: accountDiagnosisTaskFromRow(unresolved) };
        const existing = autoSource === "source_sync"
          ? this.sql.exec(
            "SELECT * FROM account_diagnosis_tasks WHERE target_id = ? AND auto_source = ? AND updated_at >= ? ORDER BY updated_at DESC LIMIT 1",
            command.target_id, autoSource, new Date(Number(command.now) - ACCOUNT_DIAGNOSIS_DEDUPE_WINDOW_MS).toISOString(),
          ).toArray()[0]
          : this.sql.exec(
            "SELECT * FROM account_diagnosis_tasks WHERE target_id = ? AND state_fingerprint = ? ORDER BY updated_at DESC LIMIT 1",
            command.target_id, command.state_fingerprint,
          ).toArray()[0];
        const existingAge = existing ? Date.parse(existing.updated_at) : Number.NaN;
        const existingIsRecent = Number.isFinite(existingAge)
          && existingAge >= Number(command.now) - ACCOUNT_DIAGNOSIS_DEDUPE_WINDOW_MS;
        if (existing && existingIsRecent) return { ok: true, created: false, task: accountDiagnosisTaskFromRow(existing) };
        const task = {
          request_id: command.request_id,
          platform: command.platform,
          key: command.key,
          target_id: command.target_id,
          trigger: command.trigger,
          observed_at: command.observed_at,
          checks: command.checks,
          state_fingerprint: command.state_fingerprint,
          status: "queued",
          workflow_run_id: null,
          workflow_run_attempt: null,
          job_id: null,
          summary: "",
          reason_code: "",
          dispatch_state: "pending",
          recheck_dispatch_state: "not_requested",
          created_at: command.created_at,
          updated_at: command.created_at,
        };
        this.sql.exec(
          `INSERT INTO account_diagnosis_tasks
            (request_id, platform, account_key, target_id, trigger, observed_at, checks_json, state_fingerprint,
             status, workflow_run_id, workflow_run_attempt, job_id, summary, reason_code, dispatch_state,
             recheck_dispatch_state, created_at, updated_at, auto_source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          task.request_id, task.platform, task.key, task.target_id, task.trigger, task.observed_at,
          JSON.stringify(task.checks), task.state_fingerprint, task.status, null, null, null,
          task.summary, task.reason_code, task.dispatch_state, task.recheck_dispatch_state,
          task.created_at, task.updated_at, autoSource,
        );
        return { ok: true, created: true, task };
      }
      if (command.action === "diagnosis_latest") {
        const row = this.sql.exec(
          "SELECT * FROM account_diagnosis_tasks WHERE platform = ? AND account_key = ? ORDER BY updated_at DESC LIMIT 1",
          command.platform, command.key,
        ).toArray()[0];
        return { ok: true, task: accountDiagnosisTaskFromRow(row) };
      }
      const requestId = command.request_id;
      const row = this.sql.exec("SELECT * FROM account_diagnosis_tasks WHERE request_id = ?", requestId).toArray()[0];
      if (!row) throw new HttpError("account_diagnosis_request_not_found", 404);
      if (command.action === "diagnosis_read") return { ok: true, task: accountDiagnosisTaskFromRow(row) };
      if (command.action === "diagnosis_native_intent") {
        if (row.native_json) {
          const old = JSON.parse(row.native_json);
          if (canonicalResearchTaskJson(old.binding) !== canonicalResearchTaskJson(command.native.binding)
            || old.request_sha256 !== command.native.request_sha256) throw accountDiagnosisConflict("account_diagnosis_native_binding_conflict");
          return { ok: true, created: false, task: accountDiagnosisTaskFromRow(row) };
        }
        if (row.workflow_run_id || row.workflow_run_attempt || row.status !== "queued" || row.dispatch_state !== "pending") {
          throw new HttpError("account_diagnosis_legacy_retired", 409);
        }
        this.sql.exec("UPDATE account_diagnosis_tasks SET native_json = ?, updated_at = ? WHERE request_id = ?",
          JSON.stringify(command.native), command.updated_at, requestId);
        return { ok: true, created: true, task: accountDiagnosisTaskFromRow(this.sql.exec("SELECT * FROM account_diagnosis_tasks WHERE request_id = ?", requestId).toArray()[0]) };
      }
      if (command.action === "diagnosis_native_cancel") {
        if (!row.native_json) throw new HttpError("account_diagnosis_legacy_retired", 409);
        const native = JSON.parse(row.native_json);
        // The first durable terminal receipt or cancellation wins atomically.
        if (native.receipt) return { ok: true, send_cancel: false, task: accountDiagnosisTaskFromRow(row) };
        const send = Boolean(native.task_id && !native.cancel_sent);
        native.cancel_requested = true;
        native.cancel_sent = native.cancel_sent || send;
        native.phase = "hold";
        this.sql.exec("UPDATE account_diagnosis_tasks SET native_json = ?, status = 'unknown', summary = '', reason_code = '', recheck_dispatch_state = 'not_requested', updated_at = ? WHERE request_id = ?",
          JSON.stringify(native), command.updated_at, requestId);
        return { ok: true, send_cancel: send, task: accountDiagnosisTaskFromRow(this.sql.exec("SELECT * FROM account_diagnosis_tasks WHERE request_id = ?", requestId).toArray()[0]) };
      }
      if (command.action === "diagnosis_native_save") {
        if (!row.native_json) throw new HttpError("account_diagnosis_legacy_retired", 409);
        const old = JSON.parse(row.native_json), next = command.native;
        for (const field of ["version", "binding", "request", "input_sha256", "request_sha256", "operation_key", "deadline"]) {
          if (canonicalResearchTaskJson(old[field]) !== canonicalResearchTaskJson(next[field])) throw accountDiagnosisConflict("account_diagnosis_native_binding_conflict");
        }
        if ((old.task_id && old.task_id !== next.task_id) || (old.task_deadline !== null && old.task_deadline !== next.task_deadline)
          || (old.claim && canonicalResearchTaskJson(old.claim) !== canonicalResearchTaskJson(next.claim))
          || (old.cancel_sent && !next.cancel_sent) || (old.cancel_requested && !next.cancel_requested)
          || !ACCOUNT_DIAGNOSIS_STATUSES.includes(command.status)) {
          throw accountDiagnosisConflict("account_diagnosis_native_binding_conflict");
        }
        if (old.receipt) {
          if (old.receipt !== next.receipt) throw accountDiagnosisConflict("account_diagnosis_native_binding_conflict");
          return { ok: true, changed: false, task: accountDiagnosisTaskFromRow(row) };
        }
        if (command.status === "succeeded" && (old.cancel_requested || old.cancel_sent
          || Date.now() / 1000 >= Math.min(old.deadline, next.task_deadline ?? Infinity))) {
          throw accountDiagnosisConflict("account_diagnosis_native_binding_conflict");
        }
        const recheck = command.status === "succeeded" ? "pending" : row.recheck_dispatch_state;
        this.sql.exec("UPDATE account_diagnosis_tasks SET native_json = ?, status = ?, summary = ?, reason_code = ?, dispatch_state = 'sent', recheck_dispatch_state = ?, updated_at = ? WHERE request_id = ?",
          JSON.stringify(next), command.status, command.summary, command.reason_code, recheck, command.updated_at, requestId);
        return { ok: true, changed: true, task: accountDiagnosisTaskFromRow(this.sql.exec("SELECT * FROM account_diagnosis_tasks WHERE request_id = ?", requestId).toArray()[0]) };
      }
      if (command.action === "diagnosis_mark_dispatch") {
        if (row.dispatch_state !== "pending") return { ok: true, changed: false, task: accountDiagnosisTaskFromRow(row) };
        if (command.dispatch_state === "unknown" && row.native_json) {
          const native = { ...JSON.parse(row.native_json), phase: "hold" };
          this.sql.exec("UPDATE account_diagnosis_tasks SET dispatch_state = 'unknown', status = 'unknown', native_json = ?, updated_at = ? WHERE request_id = ?",
            JSON.stringify(native), command.updated_at, requestId);
        } else {
          this.sql.exec("UPDATE account_diagnosis_tasks SET dispatch_state = ?, updated_at = ? WHERE request_id = ?", command.dispatch_state, command.updated_at, requestId);
        }
        return { ok: true, changed: true, task: accountDiagnosisTaskFromRow(this.sql.exec("SELECT * FROM account_diagnosis_tasks WHERE request_id = ?", requestId).toArray()[0]) };
      }
      if (command.action === "diagnosis_claim" || command.action === "diagnosis_result") {
        throw new HttpError("account_diagnosis_legacy_retired", 409);
      }
      if (command.action === "diagnosis_mark_recheck") {
        if (row.recheck_dispatch_state !== "pending") return { ok: true, changed: false, task: accountDiagnosisTaskFromRow(row) };
        this.sql.exec("UPDATE account_diagnosis_tasks SET recheck_dispatch_state = ?, updated_at = ? WHERE request_id = ?", command.recheck_dispatch_state, command.updated_at, requestId);
        return { ok: true, changed: true, task: accountDiagnosisTaskFromRow(this.sql.exec("SELECT * FROM account_diagnosis_tasks WHERE request_id = ?", requestId).toArray()[0]) };
      }
      throw new HttpError("unsupported_account_diagnosis_action", 400);
    });
  }

  consoleReadCommand(command) {
    if (!command.actor) throw new HttpError("runtime_instance_actor_required", 400);
    if (command.action === "console_audit_events") {
      const limit = command.limit;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > AUDIT_EVENTS_MAX_ROWS) throw new HttpError("invalid_pagination", 400);
      const { snapshot, before } = command;
      // Normalize time once, and use the same binary id tie-break as the HTTP merge.
      return { rows: this.sql.exec(`
        WITH events AS (
          SELECT 'decision' AS source, kind, subject_id, material_key AS revision,
            action, actor, strftime('%Y-%m-%dT%H:%M:%fZ', decided_at) AS occurred_at,
            request_key AS ref, 'decided' AS status, 'durable_human_decision:' || request_key AS event_id
          FROM human_decision_record
          UNION ALL
          SELECT 'promotion_application', 'promotion', ticket_id, '', status, '',
            strftime('%Y-%m-%dT%H:%M:%fZ', updated_at), application_id, status,
            'research_promotion_application:' || application_id FROM research_promotion_applications
          UNION ALL
          SELECT 'account_settings_application', 'account_settings', platform || ':' || account_key, '',
            status, approved_by, strftime('%Y-%m-%dT%H:%M:%fZ', approved_at), request_key, status,
            'account_settings_application:' || request_key FROM account_setting_profile_application
          UNION ALL
          SELECT 'credential_rotation', 'credential', 'ibkr_flex', '', action, actor,
            occurred_at, operation_id, outcome, 'credential_rotation:' || event_id
          FROM credential_rotation_audit
        ) SELECT * FROM events WHERE occurred_at <= ?
          AND (? IS NULL OR occurred_at < ? OR (occurred_at = ? AND event_id > ?))
        ORDER BY occurred_at DESC, event_id ASC LIMIT ?`, snapshot,
        before?.at ?? null, before?.at ?? null, before?.at ?? null, before?.id ?? null, limit).toArray() };
    }
    if (command.action === "console_decision_history") {
      const { limit, offset } = command;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw new HttpError("invalid_pagination", 400);
      return { rows: this.sql.exec("SELECT request_key, kind, subject_id, material_key, action, actor, decided_at, target_json, json_extract(payload_json, '$.ticket.confirmation_execution_mode') AS confirmation_execution_mode FROM human_decision_record ORDER BY decided_at DESC, request_key DESC LIMIT ? OFFSET ?", limit + 1, offset).toArray() };
    }
    if (command.action === "console_settings_history") {
      this.existingAccountInstance(command.platform, command.key);
      return { approvals: this.sql.exec("SELECT request_key, status, identity_json, instance_revision, old_profile, new_profile, approved_at, approved_by, draft_revision FROM account_setting_profile_application WHERE platform = ? AND account_key = ? ORDER BY approved_at DESC", command.platform, command.key).toArray() };
    }
    const drafts = this.sql.exec("SELECT platform, account_key, overrides_json, updated_at FROM account_setting_draft").toArray();
    const approvals = this.sql.exec("SELECT platform, account_key, MAX(approved_at) AS approved_at FROM account_setting_profile_application GROUP BY platform, account_key").toArray();
    return { rows: this.read().instances.map(item => {
      const draft = drafts.find(row => row.platform === item.platform && row.account_key === item.key);
      const approval = approvals.find(row => row.platform === item.platform && row.account_key === item.key);
      return { platform: item.platform, account_key: item.key,
        pending_draft_count: draft ? new Set(Object.keys(JSON.parse(draft.overrides_json)).map(field => field.startsWith("dca_") ? "dca" : field.startsWith("reserved_") ? "cash" : field)).size : 0,
        last_change_at: [draft?.updated_at, approval?.approved_at, item.updated_at].filter(Boolean).sort().at(-1) || null,
      };
    }) };
  }

  humanDecisionCommand(command) {
    return this.storage.transactionSync(() => {
      if (!command || typeof command.actor !== "string" || !command.actor) {
        throw new HttpError("runtime_instance_actor_required", 400);
      }
      if (command.action === "owner_sync_materials") return this.syncHumanDecisionMaterials(command, "owner");
      if (command.action === "recovery_sync_materials") return this.syncHumanDecisionMaterials(command, "recovery");
      if (command.action === "promotion_sync_materials") return this.syncHumanDecisionMaterials(command, "promotion");
      if (command.action === "owner_decide") return this.writeHumanDecision(command, "owner");
      if (command.action === "recovery_decide") return this.writeHumanDecision(command, "recovery");
      if (command.action === "promotion_decide") return this.writeHumanDecision(command, "promotion");
      if (command.action === "owner_read") return this.readHumanDecision(command, "owner");
      if (command.action === "recovery_read") return this.readHumanDecision(command, "recovery");
      if (command.action === "promotion_read") return this.readHumanDecision(command, "promotion");
      throw new HttpError("unsupported_human_decision_action", 400);
    });
  }

  humanDecisionMaterialRow(kind, subjectId) {
    return this.sql.exec(
      "SELECT * FROM human_decision_material WHERE kind = ? AND subject_id = ?",
      kind, subjectId,
    ).toArray()[0] || null;
  }

  humanDecisionTerminalRow(kind, subjectId, materialKey) {
    return this.sql.exec(
      "SELECT * FROM human_decision_record WHERE kind = ? AND subject_id = ? AND material_key = ? ORDER BY decided_at ASC LIMIT 1",
      kind, subjectId, materialKey,
    ).toArray()[0] || null;
  }

  humanDecisionRecordPayload(row) {
    let payload = {};
    try {
      payload = JSON.parse(row.payload_json);
    } catch {
      throw new HttpError("human_decision_record_invalid", 409);
    }
    return {
      request_key: row.request_key,
      kind: row.kind,
      subject_id: row.subject_id,
      material_key: row.material_key,
      action: row.action,
      actor: row.actor,
      decided_at: row.decided_at,
      target_json: row.target_json,
      payload,
    };
  }

  humanDecisionSourceRow(kind, subjectId, sourceId) {
    return this.sql.exec(
      "SELECT * FROM human_decision_source_material WHERE kind = ? AND subject_id = ? AND source_id = ?",
      kind, subjectId, sourceId,
    ).toArray()[0] || null;
  }

  upsertHumanDecisionSource(kind, subjectId, sourceId, item, eligible, updatedAt) {
    if (this.humanDecisionSourceRow(kind, subjectId, sourceId)) {
      this.sql.exec(
        `UPDATE human_decision_source_material
         SET material_key = ?, summary_json = ?, eligible = ?, expires_at_ms = ?, updated_at = ?
         WHERE kind = ? AND subject_id = ? AND source_id = ?`,
        item.material_key, item.summary_json || "{}", eligible, item.expires_at_ms ?? null, updatedAt, kind, subjectId, sourceId,
      );
      return;
    }
    this.sql.exec(
      `INSERT INTO human_decision_source_material
       (kind, subject_id, source_id, material_key, summary_json, eligible, expires_at_ms, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      kind, subjectId, sourceId, item.material_key, item.summary_json || "{}", eligible, item.expires_at_ms ?? null, updatedAt,
    );
  }

  recomputeHumanDecisionSubject(kind, subjectId, updatedAt) {
    const sources = this.sql.exec(
      "SELECT * FROM human_decision_source_material WHERE kind = ? AND subject_id = ?",
      kind, subjectId,
    ).toArray();
    let projection = this.humanDecisionMaterialRow(kind, subjectId);
    if (!projection && !sources.length) return;
    if (!projection) {
      this.insertHumanDecisionMaterial(kind, subjectId, sources[0].source_id, sources[0], 0, { state: "none", block: "" }, updatedAt);
      projection = this.humanDecisionMaterialRow(kind, subjectId);
    }
    if (projection.legacy_state === "blocked") {
      this.sql.exec(
        "UPDATE human_decision_material SET eligible = 0, updated_at = ? WHERE kind = ? AND subject_id = ?",
        updatedAt, kind, subjectId,
      );
      return;
    }
    if (sources.length !== 1) {
      const keys = new Set(sources.map((row) => row.material_key));
      const materialKey = keys.size === 1 ? sources[0].material_key : "";
      this.sql.exec(
        "UPDATE human_decision_material SET source_id = ?, material_key = ?, eligible = 0, updated_at = ? WHERE kind = ? AND subject_id = ?",
        "", materialKey, updatedAt, kind, subjectId,
      );
      return;
    }
    const only = sources[0];
    this.sql.exec(
      `UPDATE human_decision_material
       SET source_id = ?, material_key = ?, summary_json = ?, eligible = ?, expires_at_ms = ?, updated_at = ?
       WHERE kind = ? AND subject_id = ?`,
      only.source_id, only.material_key, only.summary_json, only.eligible, only.expires_at_ms, updatedAt, kind, subjectId,
    );
  }

  insertHumanDecisionMaterial(kind, subjectId, sourceId, item, eligible, legacyState, updatedAt) {
    this.sql.exec(
      `INSERT INTO human_decision_material
       (kind, subject_id, source_id, material_key, summary_json, eligible, expires_at_ms, legacy_state, legacy_block, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      kind, subjectId, sourceId, item.material_key, item.summary_json || "{}", eligible,
      item.expires_at_ms ?? null, legacyState.state, legacyState.block, updatedAt,
    );
  }

  insertHumanDecisionRecord(record) {
    this.sql.exec(
      `INSERT INTO human_decision_record
       (request_key, kind, subject_id, material_key, action, actor, decided_at, target_json, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      record.request_key, record.kind, record.subject_id, record.material_key, record.action,
      record.actor, record.decided_at, record.target_json, record.payload_json,
    );
  }

  importHumanDecisionLegacy(kind, subjectId, item) {
    const legacy = item.legacy;
    if (!legacy) return { state: "none", block: "" };
    const record = legacy.record;
    if (legacy.blocked || !record || record.material_key !== item.material_key || !record.action || !record.actor || !record.decided_at || !record.payload || typeof record.payload !== "object") {
      return { state: "blocked", block: "unexplained_legacy" };
    }
    this.insertHumanDecisionRecord({
      request_key: `legacy:${kind}:${subjectId}:${item.material_key}`,
      kind,
      subject_id: subjectId,
      material_key: item.material_key,
      action: record.action,
      actor: record.actor,
      decided_at: record.decided_at,
      target_json: record.target_json || "{}",
      payload_json: JSON.stringify(record.payload),
    });
    return { state: "imported", block: "" };
  }

  syncHumanDecisionMaterials(command, kind) {
    const sourceId = String(command.source_id || "");
    const updatedAt = String(command.updated_at || "");
    const materials = Array.isArray(command.materials) ? command.materials : [];
    const seen = new Set();
    const affected = new Set();
    let terminal = false;
    let terminalState = "";
    let identityConflict = false;
    let legacyBlocked = false;
    for (const item of materials) {
      const subjectId = String(item.subject_id || "");
      if (!subjectId || seen.has(subjectId)) continue;
      seen.add(subjectId);
      const sourceRow = this.humanDecisionSourceRow(kind, subjectId, sourceId);
      const incomingTerminal = this.humanDecisionTerminalRow(kind, subjectId, item.material_key);
      if (
        kind === "promotion" && sourceRow && sourceRow.material_key !== item.material_key && !incomingTerminal
        && !this.humanDecisionTerminalRow(kind, subjectId, sourceRow.material_key)
      ) {
        identityConflict = true;
        continue;
      }
      if (kind === "promotion" && incomingTerminal) {
        terminal = true;
        terminalState = incomingTerminal.action === "accept" ? "human_accepted" : "human_rejected";
      }
      let projection = this.humanDecisionMaterialRow(kind, subjectId);
      if (!projection) {
        const legacyState = this.importHumanDecisionLegacy(kind, subjectId, item);
        this.insertHumanDecisionMaterial(kind, subjectId, sourceId, item, 0, legacyState, updatedAt);
        if (legacyState.state === "blocked") legacyBlocked = true;
        const imported = this.humanDecisionTerminalRow(kind, subjectId, item.material_key);
        if (imported && kind === "promotion") {
          terminal = true;
          terminalState = imported.action === "accept" ? "human_accepted" : "human_rejected";
        }
        projection = this.humanDecisionMaterialRow(kind, subjectId);
      } else if (projection.legacy_state === "blocked") {
        legacyBlocked = true;
      }
      const blocked = projection?.legacy_state === "blocked";
      this.upsertHumanDecisionSource(kind, subjectId, sourceId, item, blocked ? 0 : (item.eligible ? 1 : 0), updatedAt);
      affected.add(subjectId);
    }
    if (command.replace_source) {
      const rows = this.sql.exec(
        "SELECT subject_id FROM human_decision_source_material WHERE kind = ? AND source_id = ?",
        kind, sourceId,
      ).toArray();
      for (const row of rows) {
        if (seen.has(row.subject_id)) continue;
        this.sql.exec(
          "DELETE FROM human_decision_source_material WHERE kind = ? AND subject_id = ? AND source_id = ?",
          kind, row.subject_id, sourceId,
        );
        affected.add(row.subject_id);
      }
    }
    for (const subjectId of command.duplicate_subject_ids || []) {
      if (typeof subjectId !== "string" || !subjectId) continue;
      this.sql.exec(
        "UPDATE human_decision_source_material SET eligible = 0, updated_at = ? WHERE kind = ? AND subject_id = ? AND source_id = ?",
        updatedAt, kind, subjectId, sourceId,
      );
      affected.add(subjectId);
    }
    for (const subjectId of affected) this.recomputeHumanDecisionSubject(kind, subjectId, updatedAt);
    return { ok: true, terminal, terminal_state: terminalState, identity_conflict: identityConflict, legacy_blocked: legacyBlocked };
  }

  writeHumanDecision(command, kind) {
    if (kind === "owner" && command.action_name === "retire_candidate") {
      throw new HttpError("owner_retirement_proposal_required", 409);
    }
    const subjectId = String(command.subject_id || "");
    const materialKey = String(command.material_key || "");
    const actionName = String(command.action_name || "");
    const requestKey = String(command.request_key || "");
    const targetJson = String(command.target_json || "{}");
    if (!subjectId || !materialKey || !actionName || !requestKey) throw new HttpError("human_decision_request_invalid", 400);
    let row = this.humanDecisionMaterialRow(kind, subjectId);
    if (!row && command.legacy) {
      const legacyState = this.importHumanDecisionLegacy(kind, subjectId, { material_key: materialKey, legacy: command.legacy });
      this.insertHumanDecisionMaterial(kind, subjectId, String(command.source_id || kind), {
        material_key: materialKey,
        summary_json: command.summary_json || "{}",
        expires_at_ms: command.expires_at_ms ?? null,
      }, legacyState.state === "blocked" ? 0 : 1, legacyState, String(command.decided_at || ""));
      row = this.humanDecisionMaterialRow(kind, subjectId);
    }
    if (!row) throw new HttpError("human_decision_material_unavailable", 409);
    if (row.legacy_state === "blocked") throw new HttpError("human_decision_legacy_blocked", 409);
    if (row.material_key !== materialKey) throw new HttpError("human_decision_material_conflict", 409);
    if (Number(row.eligible) !== 1) throw new HttpError("human_decision_material_ineligible", 409);
    if (row.expires_at_ms != null && Number(command.now_ms) >= Number(row.expires_at_ms)) {
      throw new HttpError("human_decision_material_expired", 409);
    }
    if (kind === "promotion" && command.review_binding !== undefined
      && !promotionReviewBindingsMatch(command.review_binding, promotionMaterialReviewBinding(row))) {
      throw new HttpError("human_decision_review_material_conflict", 409);
    }
    const assertReview = terminal => {
      if (kind === "promotion" && command.review_binding !== undefined
        && !promotionReviewBindingsMatch(command.review_binding, this.humanDecisionRecordPayload(terminal).payload?.review_binding)) {
        throw new HttpError("human_decision_review_binding_unqualified", 409);
      }
    };
    const byRequest = this.sql.exec("SELECT * FROM human_decision_record WHERE request_key = ?", requestKey).toArray()[0];
    if (byRequest) {
      if (byRequest.kind !== kind || byRequest.subject_id !== subjectId || byRequest.material_key !== materialKey || byRequest.action !== actionName || byRequest.target_json !== targetJson) {
        throw new HttpError("human_decision_conflict", 409);
      }
      assertReview(byRequest);
      return { ok: true, replayed: true, record: this.humanDecisionRecordPayload(byRequest) };
    }
    const terminal = this.humanDecisionTerminalRow(kind, subjectId, materialKey);
    if (terminal) {
      if (terminal.action !== actionName || terminal.target_json !== targetJson) throw new HttpError("human_decision_conflict", 409);
      assertReview(terminal);
      return { ok: true, replayed: true, record: this.humanDecisionRecordPayload(terminal) };
    }
    const payload = command.payload && typeof command.payload === "object" ? structuredClone(command.payload) : {};
    if (kind === "promotion" && actionName === "accept") {
      const instances = this.read();
      if (instances.initialized) {
        const preflightRevision = Number(command.preflight_revision);
        if (!Number.isSafeInteger(preflightRevision) || preflightRevision !== instances.revision) {
          throw new HttpError("runtime_instance_revision_conflict", 409);
        }
        payload.account_revision = instances.revision;
      } else {
        payload.account_revision = null;
      }
    }
    const record = {
      request_key: requestKey,
      kind,
      subject_id: subjectId,
      material_key: materialKey,
      action: actionName,
      actor: String(command.actor || ""),
      decided_at: String(command.decided_at || ""),
      target_json: targetJson,
      payload_json: JSON.stringify(payload),
    };
    this.insertHumanDecisionRecord(record);
    return { ok: true, replayed: false, record: this.humanDecisionRecordPayload(this.humanDecisionTerminalRow(kind, subjectId, materialKey)) };
  }

  readHumanDecision(command, kind) {
    const subjectId = String(command.subject_id || "");
    const now = Number.isFinite(Number(command.now_ms)) ? Number(command.now_ms) : Date.now();
    const row = this.humanDecisionMaterialRow(kind, subjectId);
    const expiry = (material) => material.expires_at_ms == null ? null : new Date(Number(material.expires_at_ms)).toISOString();
    const expired = (material) => material.expires_at_ms != null && now >= Number(material.expires_at_ms);
    // Historical receipt lookup deliberately does not substitute the current material.
    // It grants no eligibility or authority to act on the current material.
    if (command.exact_material_key !== undefined) {
      const materialKey = command.exact_material_key;
      if (!/^[0-9a-f]{64}$/.test(materialKey) || !subjectId || subjectId.length > 256) {
        throw new HttpError("human_decision_lookup_invalid", 400);
      }
      const terminal = this.humanDecisionTerminalRow(kind, subjectId, materialKey);
      return {
        ok: true,
        exact_material_key: materialKey,
        decision: terminal ? this.humanDecisionRecordPayload(terminal) : null,
        current_material: row ? {
          matches: row.material_key === materialKey,
          eligible: Number(row.eligible) === 1 && !expired(row),
          expired: expired(row),
          expires_at: expiry(row),
          blocked: row.legacy_state === "blocked",
          ...(kind === "promotion" ? { review_binding: promotionMaterialReviewBinding(row) } : {}),
        } : null,
      };
    }
    if (!row) return { ok: true, migrated: false, blocked: false, eligible: false, expired: false, expires_at: null, material_key: null, decision: null };
    const terminal = this.humanDecisionTerminalRow(kind, subjectId, row.material_key);
    return {
      ok: true,
      migrated: true,
      blocked: row.legacy_state === "blocked",
      eligible: Number(row.eligible) === 1 && !expired(row),
      expired: expired(row),
      expires_at: expiry(row),
      material_key: row.material_key,
      ...(kind === "promotion" ? { review_binding: promotionMaterialReviewBinding(row) } : {}),
      decision: terminal ? this.humanDecisionRecordPayload(terminal) : null,
    };
  }

  applicationCommand(command) {
    return this.storage.transactionSync(() => {
      if (!command || typeof command.actor !== "string" || !command.actor) {
        throw new HttpError("runtime_instance_actor_required", 400);
      }
      if (command.action === "application_create") {
        const currentMaterial = this.humanDecisionMaterialRow("promotion", command.ticket_id);
        if (!currentMaterial || currentMaterial.legacy_state === "blocked" || Number(currentMaterial.eligible) !== 1 || currentMaterial.material_key !== command.promotion_material_key) {
          throw new HttpError("research candidate is not human_accepted", 409);
        }
        const decisionRow = this.humanDecisionTerminalRow("promotion", command.ticket_id, currentMaterial.material_key);
        if (!decisionRow || decisionRow.action !== "accept") throw new HttpError("research candidate is not human_accepted", 409);
        let decisionPayload = {};
        try { decisionPayload = JSON.parse(decisionRow.payload_json); } catch { throw new HttpError("research candidate is not human_accepted", 409); }
        const selected = decisionPayload.selected_account || {};
        if (selected.platform !== command.platform_id || selected.key !== command.account_key) {
          throw new HttpError("promotion_account_binding_conflict", 409);
        }
        const instances = this.read();
        if (!instances.initialized || instances.revision !== Number(command.expected_revision) || !Number.isSafeInteger(decisionPayload.account_revision) || decisionPayload.account_revision !== instances.revision) {
          throw new HttpError("runtime_instance_revision_conflict", 409);
        }
        const existing = this.sql.exec(
          "SELECT * FROM research_promotion_applications WHERE ticket_id = ? AND platform_id = ? AND account_key = ? AND status <> 'rejected' ORDER BY created_at DESC LIMIT 1",
          command.ticket_id, command.platform_id, command.account_key,
        ).toArray()[0];
        if (existing) return { ok: true, created: false, application: researchPromotionApplicationFromRow(existing) };
        const application = {
          application_id: command.application_id,
          ticket_id: command.ticket_id,
          status: "approved",
          dispatch_state: "pending",
          claim_token: command.claim_token,
          platform_id: command.platform_id,
          account_key: command.account_key,
          account_scope: command.account_scope,
          account_selector: command.account_selector,
          service_name: command.service_name,
          broker_environment: command.broker_environment,
          expected_revision: command.expected_revision,
          expected_strategy_profile: command.expected_strategy_profile,
          strategy_profile: command.strategy_profile,
          candidate_id: command.candidate_id,
          config_sha256: command.config_sha256,
          source_commit: command.source_commit,
          approved_ues_revision: command.approved_ues_revision,
          desired_state: "paused",
          workflow_run_id: null,
          workflow_run_attempt: null,
          reason_code: "",
          readback: null,
          created_at: command.created_at,
          updated_at: command.created_at,
        };
        this.sql.exec(
          `INSERT INTO research_promotion_applications
           (application_id, ticket_id, status, dispatch_state, claim_token, platform_id, account_key,
            account_scope, account_selector, service_name, broker_environment, expected_revision,
            expected_strategy_profile, strategy_profile, candidate_id, config_sha256, source_commit,
            approved_ues_revision, desired_state, workflow_run_id, workflow_run_attempt, reason_code,
            readback_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          application.application_id, application.ticket_id, application.status, application.dispatch_state,
          application.claim_token, application.platform_id, application.account_key, application.account_scope,
          application.account_selector, application.service_name, application.broker_environment,
          application.expected_revision, application.expected_strategy_profile, application.strategy_profile,
          application.candidate_id, application.config_sha256, application.source_commit,
          application.approved_ues_revision, application.desired_state, null, null, application.reason_code,
          null, application.created_at, application.updated_at,
        );
        return { ok: true, created: true, application };
      }
      if (command.action === "application_latest") {
        const row = this.sql.exec(
          "SELECT * FROM research_promotion_applications WHERE ticket_id = ? ORDER BY created_at DESC LIMIT 1",
          command.ticket_id,
        ).toArray()[0];
        return { ok: true, application: researchPromotionApplicationFromRow(row) };
      }
      const applicationId = command.application_id;
      const row = this.sql.exec("SELECT * FROM research_promotion_applications WHERE application_id = ?", applicationId).toArray()[0];
      if (!row) throw new HttpError("research_promotion_application_not_found", 404);
      if (command.action === "application_read") return { ok: true, application: researchPromotionApplicationFromRow(row) };
      if (command.action === "application_mark_dispatch") {
        if (row.status !== "approved" || row.dispatch_state !== "pending") return { ok: true, changed: false, application: researchPromotionApplicationFromRow(row) };
        this.sql.exec("UPDATE research_promotion_applications SET dispatch_state = ?, updated_at = ? WHERE application_id = ?", command.dispatch_state, command.updated_at, applicationId);
        return { ok: true, changed: true, application: researchPromotionApplicationFromRow(this.sql.exec("SELECT * FROM research_promotion_applications WHERE application_id = ?", applicationId).toArray()[0]) };
      }
      if (command.action === "application_claim") {
        const state = this.read();
        const instance = state.instances.find((item) => item.kind === "existing"
          && item.platform === row.platform_id && item.key === row.account_key);
        const config = instance?.config || {};
        const bindingStillMatches = state.revision === Number(row.expected_revision)
          && String(config.default_strategy_profile || "") === row.expected_strategy_profile
          && String(config.broker_environment || "") === row.broker_environment
          && String(config.account_selector || "") === row.account_selector
          && String(config.service_name || "") === row.service_name;
        const claimed = row.status === "approved" && ["pending", "sent", "unknown"].includes(row.dispatch_state)
          && row.claim_token === command.claim_token && bindingStillMatches;
        if (claimed) {
          this.sql.exec(
            "UPDATE research_promotion_applications SET status = 'claimed', workflow_run_id = ?, workflow_run_attempt = ?, updated_at = ? WHERE application_id = ? AND status = 'approved'",
            command.workflow_run_id, command.workflow_run_attempt, command.updated_at, applicationId,
          );
        }
        return { ok: true, claimed, reason: claimed ? "" : (bindingStillMatches ? "already_claimed_or_invalid_token" : "account_changed") };
      }
      if (command.action === "application_result") {
        const sameRun = row.workflow_run_id === command.workflow_run_id
          && row.workflow_run_attempt === command.workflow_run_attempt
          && row.claim_token === command.claim_token;
        if (["applied_paused", "rejected", "uncertain"].includes(row.status)) {
          if (!sameRun) throw new HttpError("research_promotion_application_workflow_binding_conflict", 409);
          return { ok: true, changed: false, application: researchPromotionApplicationFromRow(row) };
        }
        if (row.status !== "claimed" || !sameRun) throw new HttpError("research_promotion_application_workflow_binding_conflict", 409);
        let effectiveStatus = command.status;
        let effectiveReasonCode = command.reason_code;
        if (command.status === "applied_paused") {
          const state = this.read();
          const instance = state.instances.find((item) => item.kind === "existing"
            && item.platform === row.platform_id && item.key === row.account_key);
          const config = instance?.config || {};
          const bindingStillMatches = state.revision === Number(row.expected_revision)
            && String(config.default_strategy_profile || "") === row.expected_strategy_profile
            && String(config.broker_environment || "") === row.broker_environment
            && String(config.account_selector || "") === row.account_selector
            && String(config.service_name || "") === row.service_name;
          if (!bindingStillMatches) {
            effectiveStatus = "uncertain";
            effectiveReasonCode = "account_changed";
          } else {
            const before = structuredClone(instance);
            instance.config = { ...instance.config, default_strategy_profile: row.strategy_profile };
            instance.enabled = false;
            instance.platform_applied = true;
            instance.application_status = "applied_paused";
            instance.updated_at = command.updated_at;
            state.revision += 1;
            this.sql.exec("INSERT INTO instance_state (id, revision, payload) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, payload = excluded.payload", state.revision, JSON.stringify(state.instances));
            this.sql.exec("INSERT INTO instance_history (revision, entry) VALUES (?, ?)", state.revision, JSON.stringify({
              revision: state.revision,
              ts: command.updated_at,
              login: command.actor,
              action: "research_promotion_application_applied_paused",
              before,
              after: instance,
            }));
          }
        }
        this.sql.exec(
          `UPDATE research_promotion_applications
           SET status = ?, reason_code = ?, readback_json = ?, updated_at = ?
           WHERE application_id = ?`,
          effectiveStatus, effectiveReasonCode, command.readback ? JSON.stringify(command.readback) : null,
          command.updated_at, applicationId,
        );
        return { ok: true, changed: true, application: researchPromotionApplicationFromRow(this.sql.exec("SELECT * FROM research_promotion_applications WHERE application_id = ?", applicationId).toArray()[0]) };
      }
      throw new HttpError("unsupported_research_promotion_application_action", 400);
    });
  }

  ux1ResearchCommand(command) {
    return this.storage.transactionSync(() => {
      if (["ux1_begin_job", "ux1_record_dispatch", "ux1_lookup_job", "ux1_claim_job", "ux1_finish_job"].includes(command?.action)) {
        return ux1MutateJob(this.sql, command);
      }
      const login = String(command?.login || "");
      if (!/^[a-z0-9-]{1,39}$/.test(login)) throw new HttpError("ux1_login_invalid", 400);
      const row = ux1SelectSlot(this.sql, login);
      const found = ux1SlotPayload(row);
      if (command.action === "ux1_read") return found;
      if (command.action === "ux1_save") {
        if (!Number.isSafeInteger(command.expected_revision) || command.expected_revision < 0) throw new HttpError("ux1_revision_required", 400);
        if ((row ? Number(row.revision) : 0) !== command.expected_revision) throw new HttpError("ux1_revision_conflict", 409);
        if (typeof command.draft_json !== "string" || typeof command.fingerprint !== "string" || command.draft_json.length > 16384) {
          throw new HttpError("ux1_invalid_body", 400);
        }
        if (row && row.draft_json === command.draft_json && row.fingerprint === command.fingerprint) return { ...found, unchanged: true };
        const revision = (row ? Number(row.revision) : 0) + 1;
        this.sql.exec(
          `INSERT INTO ux1_research_slot (login, revision, draft_json, fingerprint, preview_json, intent_json)
           VALUES (?, ?, ?, ?, NULL, NULL)
           ON CONFLICT(login) DO UPDATE SET revision = excluded.revision, draft_json = excluded.draft_json,
             fingerprint = excluded.fingerprint, preview_json = NULL, intent_json = NULL`,
          login, revision, command.draft_json, command.fingerprint,
        );
        return { ...ux1SlotPayload(ux1SelectSlot(this.sql, login)), unchanged: false };
      }
      if (command.action === "ux1_store_preview") {
        if (!row || Number(row.revision) !== command.expected_revision || row.fingerprint !== command.fingerprint) throw new HttpError("ux1_preview_conflict", 409);
        if (typeof command.preview_json !== "string" || command.preview_json.length > 65536) throw new HttpError("ux1_invalid_body", 400);
        this.sql.exec("UPDATE ux1_research_slot SET preview_json = ? WHERE login = ? AND revision = ?", command.preview_json, login, Number(row.revision));
        return { ...found, preview_json: command.preview_json };
      }
      if (command.action === "ux1_save_intent") {
        if (!row || Number(row.revision) !== command.expected_revision || row.fingerprint !== command.fingerprint || !row.preview_json) {
          throw new HttpError("ux1_intent_conflict", 409);
        }
        if (row.intent_json) {
          const existing = JSON.parse(row.intent_json);
          if (existing.revision === Number(row.revision) && existing.fingerprint === row.fingerprint) return { ...found, duplicate: true };
        }
        if (typeof command.intent_json !== "string" || command.intent_json.length > 4096) throw new HttpError("ux1_invalid_body", 400);
        this.sql.exec("UPDATE ux1_research_slot SET intent_json = ? WHERE login = ? AND revision = ?", command.intent_json, login, Number(row.revision));
        return { ...found, intent_json: command.intent_json, duplicate: false };
      }
      if (command.action === "ux1_clear_preview") {
        if (!row) return found;
        if (Number(row.revision) !== command.expected_revision || row.fingerprint !== command.fingerprint) return found;
        this.sql.exec("UPDATE ux1_research_slot SET preview_json = NULL WHERE login = ? AND revision = ? AND fingerprint = ?", login, Number(row.revision), row.fingerprint);
        return { ...found, preview_json: null };
      }
      throw new HttpError("unsupported_ux1_action", 400);
    });
  }
}
