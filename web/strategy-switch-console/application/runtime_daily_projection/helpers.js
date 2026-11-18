import {
  RUNTIME_DAILY_TARGET,
  RUNTIME_DAILY_TIMEZONE,
  runtimeDailyBusinessDate,
  runtimeDailyRunIssue,
  runtimeDailyTarget,
} from "../../runtime_daily_contract.js";
import { HttpError } from "../http_error.js";
import { canonicalResearchTaskJson } from "../research_task/helpers.js";
import {
  cleanBoundedText,
  hasExactKeys,
  parseCalendarDate,
  parseIsoInstantMs,
} from "../schema_validators.js";
import {
  RUNTIME_DAILY_ACTIVITIES,
  RUNTIME_DAILY_FUTURE_SKEW_MS,
  RUNTIME_DAILY_KEY_PREFIX,
  RUNTIME_DAILY_KINDS,
  RUNTIME_DAILY_LANES,
  RUNTIME_DAILY_MAX_LIST,
  RUNTIME_DAILY_MAX_RUNS,
  RUNTIME_DAILY_SCHEDULE_ONLY,
  RUNTIME_DAILY_SCHEDULE_STATES,
  RUNTIME_DAILY_STALE_MS,
  RUNTIME_DAILY_STATUSES,
  SCHWAB_EXECUTION_STATUSES,
  SCHWAB_QUIET_ACTIVITIES,
  SCHWAB_RECEIPT_CONFIRMATIONS,
  SCHWAB_RECEIPT_ID_RE,
  SCHWAB_REPORT_STATUSES,
  SCHWAB_RUN_ID_RE,
  SCHWAB_SCHEDULE_REASONS,
} from "./constants.js";

export function runtimeDailyReadModelEnabled(env) {
  return String(env.RUNTIME_DAILY_READ_MODEL_ENABLED || "") === "true";
}

export function runtimeDailyKey(businessDate, target = RUNTIME_DAILY_TARGET) {
  return `${RUNTIME_DAILY_KEY_PREFIX}${target.target_key}:${businessDate}`;
}

export function runtimeDailyToday(now = Date.now()) {
  return runtimeDailyBusinessDate(now);
}

export function runtimeDailyCalendarDate(value) {
  return parseCalendarDate(value);
}

export function runtimeDailyInstant(value) {
  return parseIsoInstantMs(value);
}

export function runtimeDailyExactKeys(value, keys) {
  return hasExactKeys(value, keys);
}

export function runtimeDailyBoundedText(value, max) {
  try {
    cleanBoundedText(value, "text", {
      maxLength: max,
      trim: false,
      strictString: true,
      rejectControlChars: true,
      rejectUnsafeMarkers: true,
    });
    return true;
  } catch {
    return false;
  }
}

export function runtimeDailyChoice(value, allowed) {
  return typeof value === "string" && allowed.includes(value);
}

export function runtimeDailyReject(code) {
  throw new HttpError(code, 400);
}

export function runtimeDailyOptionalInstant(value, observedMs) {
  if (value === null) return null;
  const parsed = runtimeDailyInstant(value);
  if (parsed === null) runtimeDailyReject("invalid_runtime_daily_time");
  if (parsed > observedMs + RUNTIME_DAILY_FUTURE_SKEW_MS) runtimeDailyReject("runtime_daily_future_observation");
  return parsed;
}

export function runtimeDailyScheduleInstants(schedule, observedMs) {
  const latest = schedule.latest_due_at === null ? null : runtimeDailyInstant(schedule.latest_due_at);
  const next = schedule.next_due_at === null ? null : runtimeDailyInstant(schedule.next_due_at);
  const grace = schedule.grace_ends_at === null ? null : runtimeDailyInstant(schedule.grace_ends_at);
  if (schedule.latest_due_at !== null && latest === null) runtimeDailyReject("invalid_runtime_daily_time");
  if (schedule.next_due_at !== null && next === null) runtimeDailyReject("invalid_runtime_daily_time");
  if (schedule.grace_ends_at !== null && grace === null) runtimeDailyReject("invalid_runtime_daily_time");
  if (latest !== null && latest > observedMs + RUNTIME_DAILY_FUTURE_SKEW_MS) runtimeDailyReject("invalid_runtime_daily_time");
  if (next !== null && next <= observedMs) runtimeDailyReject("invalid_runtime_daily_time");
  if (latest !== null && next !== null && next <= latest) runtimeDailyReject("invalid_runtime_daily_time");
  if (latest !== null && grace !== null && grace < latest) runtimeDailyReject("invalid_runtime_daily_time");
}

export function validateSchwabRuntimeDailyRun(run, observedMs, started, finished) {
  const evidence = run.evidence;
  if ((run.run_id !== null && !SCHWAB_RUN_ID_RE.test(run.run_id))
    || run.source_object !== null || run.source_objects.length !== 0 || run.object_updated_at !== null
    || run.execution_lane === "paper" || run.run_time_known !== (started !== null || finished !== null)) {
    runtimeDailyReject("invalid_runtime_daily_run");
  }
  if ((started !== null && started > observedMs) || (finished !== null && finished > observedMs)) {
    runtimeDailyReject("invalid_runtime_daily_time");
  }
  if (run.report_status !== null && !SCHWAB_REPORT_STATUSES.includes(run.report_status)) {
    runtimeDailyReject("invalid_runtime_daily_run");
  }
  if (evidence.execution_status !== null && !SCHWAB_EXECUTION_STATUSES.includes(evidence.execution_status)) {
    runtimeDailyReject("invalid_runtime_daily_run");
  }
  if (!runtimeDailyChoice(evidence.receipt_state, ["valid", "missing", "invalid"])) {
    runtimeDailyReject("invalid_runtime_daily_run");
  }
  if (evidence.receipt_state === "valid") {
    if (typeof evidence.receipt_id !== "string" || !SCHWAB_RECEIPT_ID_RE.test(evidence.receipt_id)
      || started === null || finished === null
      || !Object.prototype.hasOwnProperty.call(SCHWAB_RECEIPT_CONFIRMATIONS, evidence.receipt_outcome)
      || !SCHWAB_RECEIPT_CONFIRMATIONS[evidence.receipt_outcome].includes(evidence.receipt_broker_confirmation)) {
      runtimeDailyReject("invalid_runtime_daily_run");
    }
  } else if (evidence.receipt_id !== null || evidence.receipt_outcome !== null || evidence.receipt_broker_confirmation !== null) {
    runtimeDailyReject("invalid_runtime_daily_run");
  }
  const completedReceipt = { no_submission: "no_action", no_signal: "no_signal", no_rebalance: "no_rebalance", filled: "filled" };
  if (Object.prototype.hasOwnProperty.call(completedReceipt, run.activity)
    && (evidence.receipt_state !== "valid" || evidence.receipt_outcome !== completedReceipt[run.activity]
      || !["ok", "skipped", "success", "completed", "no_action"].includes(run.report_status)
      || run.execution_lane !== "live" || runtimeDailyRunIssue(run) !== null)) {
    runtimeDailyReject("runtime_daily_summary_conflict");
  }
  if (SCHWAB_QUIET_ACTIVITIES.includes(run.activity)
    && (evidence.broker_submission_done !== false || evidence.action_done === true || evidence.orders_pending_count !== 0
      || (evidence.execution_status !== null && !["no_op", "no_action", "no_signal", "no_rebalance", "skipped", "outside_market_hours", "completed"].includes(evidence.execution_status)))) {
    runtimeDailyReject("runtime_daily_summary_conflict");
  }
}

export function validateSchwabRuntimeDailySummary(raw, record, runs, observedMs) {
  if (raw.completeness !== (record.completeness === "complete" ? "complete" : "incomplete")) {
    runtimeDailyReject("runtime_daily_summary_conflict");
  }
  const runSignatures = new Map();
  for (const run of runs) {
    if (run.run_id === null) continue;
    const signature = canonicalResearchTaskJson(run);
    const previous = runSignatures.get(run.run_id);
    if (previous !== undefined && previous !== signature && !record.conflicts.includes(run.run_id)) {
      runtimeDailyReject("runtime_daily_summary_conflict");
    }
    runSignatures.set(run.run_id, signature);
  }
  const incomplete = raw.read_errors.length > 0 || record.conflicts.length > 0 || record.schedule.state === "unevaluable"
    || record.excluded_reports.some((item) => item.reason !== "other_business_date")
    || runs.some((run) => run.run_id === null || run.evidence.receipt_state !== "valid" || !run.run_time_known);
  if (record.completeness === "complete" && incomplete) runtimeDailyReject("runtime_daily_summary_conflict");
  const latest = runtimeDailyInstant(record.schedule.latest_due_at);
  const covering = latest === null ? [] : runs.filter((run) => {
    const started = runtimeDailyInstant(run.started_at);
    const finished = runtimeDailyInstant(run.finished_at);
    return started !== null && finished !== null && started >= latest && finished <= observedMs
      && runtimeDailyToday(started) === record.business_date;
  });
  if ([...SCHWAB_QUIET_ACTIVITIES, "filled", ...RUNTIME_DAILY_SCHEDULE_ONLY].includes(record.status)
    && record.completeness !== "complete") {
    runtimeDailyReject("runtime_daily_summary_conflict");
  }
  if ([...SCHWAB_QUIET_ACTIVITIES, "filled"].includes(record.status)) {
    if (record.kind !== "run" || covering.length === 0 || covering.some((run) => run.execution_lane !== "live")) {
      runtimeDailyReject("runtime_daily_summary_conflict");
    }
    if (SCHWAB_QUIET_ACTIVITIES.includes(record.status) && (!["due", "within_grace"].includes(record.schedule.state)
      || covering.some((run) => run.activity !== record.status))) {
      runtimeDailyReject("runtime_daily_summary_conflict");
    }
    if (record.status === "filled" && !covering.some((run) => run.activity === "filled")) {
      runtimeDailyReject("runtime_daily_summary_conflict");
    }
  }
  if (RUNTIME_DAILY_SCHEDULE_ONLY.includes(record.status)
    && (record.kind !== "schedule" || record.schedule.state !== record.status || covering.length > 0)) {
    runtimeDailyReject("runtime_daily_summary_conflict");
  }
}

export function validateSchwabRuntimeDailySchedule(schedule, observedMs) {
  const { state, reason, publication_grace_ended: ended, expected_window: window } = schedule;
  const latest = schedule.latest_due_at === null ? null : runtimeDailyInstant(schedule.latest_due_at);
  const next = schedule.next_due_at === null ? null : runtimeDailyInstant(schedule.next_due_at);
  const grace = schedule.grace_ends_at === null ? null : runtimeDailyInstant(schedule.grace_ends_at);
  if (!SCHWAB_SCHEDULE_REASONS[state]?.includes(reason)
    || (latest !== null && (latest > observedMs || runtimeDailyToday(latest) !== schedule.business_date))
    || (next !== null && (next <= observedMs || runtimeDailyToday(next) !== schedule.business_date))) {
    runtimeDailyReject("invalid_runtime_daily_projection");
  }
  let valid;
  if (state === "unevaluable") valid = latest === null && next === null && grace === null && ended === null && window === "unspecified";
  else if (state === "due" || state === "within_grace") valid = latest !== null && grace !== null && next === null && window !== "outside"
    && (state === "due" ? ended === true && grace <= observedMs : ended === false && grace > observedMs);
  else if (state === "not_due") valid = latest === null && grace === null && ended === null && window !== "outside"
    && ((reason === "before_schedule") === (next !== null));
  else if (state === "market_closed") valid = latest !== null && grace === null && ended === null;
  else valid = window === "outside" && ended === null && ((latest === null) === (grace === null)) && !(grace !== null && next !== null);
  if (!valid) runtimeDailyReject("invalid_runtime_daily_projection");
}

export function normalizeRuntimeDailyRun(run, observedMs, target) {
  if (!runtimeDailyExactKeys(run, [
    "run_id", "source_object", "source_objects", "started_at", "finished_at", "object_updated_at",
    "report_status", "execution_lane", "activity", "run_time_known", "evidence",
  ])) runtimeDailyReject("invalid_runtime_daily_run");
  if (run.run_id !== null && !runtimeDailyBoundedText(run.run_id, 120)) runtimeDailyReject("invalid_runtime_daily_run");
  if (run.source_object !== null && !runtimeDailyBoundedText(run.source_object, 512)) runtimeDailyReject("invalid_runtime_daily_run");
  if (!Array.isArray(run.source_objects) || run.source_objects.length > 8 || run.source_objects.some((item) => !runtimeDailyBoundedText(item, 512))) {
    runtimeDailyReject("invalid_runtime_daily_run");
  }
  const started = runtimeDailyOptionalInstant(run.started_at, observedMs);
  const finished = runtimeDailyOptionalInstant(run.finished_at, observedMs);
  runtimeDailyOptionalInstant(run.object_updated_at, observedMs);
  if (started !== null && finished !== null && finished < started) runtimeDailyReject("invalid_runtime_daily_time");
  if (run.report_status !== null && !runtimeDailyBoundedText(run.report_status, 64)) runtimeDailyReject("invalid_runtime_daily_run");
  if (!runtimeDailyChoice(run.execution_lane, RUNTIME_DAILY_LANES) || !runtimeDailyChoice(run.activity, RUNTIME_DAILY_ACTIVITIES)) {
    runtimeDailyReject("invalid_runtime_daily_run");
  }
  if (typeof run.run_time_known !== "boolean") runtimeDailyReject("invalid_runtime_daily_run");
  const evidenceKeys = [
    "execution_status", "broker_submission_done", "action_done", "orders_pending_count", "errors_present",
    "receipt_outcome", "receipt_broker_confirmation",
  ];
  if (target.platform === "schwab") evidenceKeys.push("receipt_state", "receipt_id");
  if (!runtimeDailyExactKeys(run.evidence, evidenceKeys)) runtimeDailyReject("invalid_runtime_daily_run");
  const evidence = run.evidence;
  if (evidence.execution_status !== null && !runtimeDailyBoundedText(evidence.execution_status, 64)) runtimeDailyReject("invalid_runtime_daily_run");
  for (const field of ["broker_submission_done", "action_done"]) {
    if (evidence[field] !== null && typeof evidence[field] !== "boolean") runtimeDailyReject("invalid_runtime_daily_run");
  }
  if (evidence.orders_pending_count !== null && (!Number.isInteger(evidence.orders_pending_count) || evidence.orders_pending_count < 0 || evidence.orders_pending_count > 100000)) {
    runtimeDailyReject("invalid_runtime_daily_run");
  }
  if (typeof evidence.errors_present !== "boolean") runtimeDailyReject("invalid_runtime_daily_run");
  for (const field of ["receipt_outcome", "receipt_broker_confirmation"]) {
    if (evidence[field] !== null && !runtimeDailyBoundedText(evidence[field], 64)) runtimeDailyReject("invalid_runtime_daily_run");
  }
  if (target.platform === "schwab") validateSchwabRuntimeDailyRun(run, observedMs, started, finished);
  return {
    run_id: run.run_id,
    source_object: run.source_object,
    source_objects: [...run.source_objects],
    started_at: run.started_at,
    finished_at: run.finished_at,
    object_updated_at: run.object_updated_at,
    report_status: run.report_status,
    execution_lane: run.execution_lane,
    activity: run.activity,
    run_time_known: run.run_time_known,
    evidence: { ...evidence },
  };
}

function normalizeExcludedReports(rawExcluded, target) {
  if (!Array.isArray(rawExcluded) || rawExcluded.length > RUNTIME_DAILY_MAX_LIST) {
    runtimeDailyReject("invalid_runtime_daily_projection");
  }
  return rawExcluded.map((item) => {
    const keys = Object.keys(item || {});
    const allowed = keys.length === 3 ? ["run_id", "reason", "business_date"] : ["run_id", "reason"];
    if (!runtimeDailyExactKeys(item, allowed) || !runtimeDailyBoundedText(item.reason, 64)) {
      runtimeDailyReject("invalid_runtime_daily_projection");
    }
    if (item.run_id !== null && !runtimeDailyBoundedText(item.run_id, 120)) {
      runtimeDailyReject("invalid_runtime_daily_projection");
    }
    if (allowed.length === 3 && runtimeDailyCalendarDate(item.business_date) === null) {
      runtimeDailyReject("invalid_runtime_daily_date");
    }
    if (target.platform === "schwab" && (allowed.length !== 2
      || !runtimeDailyChoice(item.reason, ["missing_run_time", "invalid_run_time", "inverted_run_time", "future_run_time", "other_business_date"])
      || (item.run_id !== null && !SCHWAB_RUN_ID_RE.test(item.run_id)))) {
      runtimeDailyReject("invalid_runtime_daily_projection");
    }
    return allowed.length === 3
      ? { run_id: item.run_id, reason: item.reason, business_date: item.business_date }
      : { run_id: item.run_id, reason: item.reason };
  });
}

function normalizeUnmatchedReports(rawUnmatched, target) {
  return rawUnmatched.map((item) => {
    if (target.platform === "schwab") {
      if (!runtimeDailyExactKeys(item, ["reason"])
        || !runtimeDailyChoice(item.reason, ["invalid_report", "wrong_platform", "wrong_target", "invalid_source_object"])) {
        runtimeDailyReject("invalid_runtime_daily_projection");
      }
      return { reason: item.reason };
    }
    if (!runtimeDailyExactKeys(item, ["run_id", "platform", "service", "strategy_profile", "account_scope", "reason"])) {
      runtimeDailyReject("invalid_runtime_daily_projection");
    }
    for (const field of ["platform", "service", "strategy_profile", "account_scope", "reason"]) {
      if (item[field] !== null && !runtimeDailyBoundedText(item[field], 120)) {
        runtimeDailyReject("invalid_runtime_daily_projection");
      }
    }
    if (item.run_id !== null && !runtimeDailyBoundedText(item.run_id, 120)) {
      runtimeDailyReject("invalid_runtime_daily_projection");
    }
    return { ...item };
  });
}

export function normalizeRuntimeDailyProjection(raw, now = Date.now(), registeredTarget = null) {
  if (!runtimeDailyExactKeys(raw, ["platform", "observed_at", "completeness", "read_errors", "records", "unmatched_reports"])) {
    runtimeDailyReject("invalid_runtime_daily_projection");
  }
  const target = registeredTarget || runtimeDailyTarget(raw.platform);
  if (target && raw.platform !== target.platform) runtimeDailyReject("invalid_runtime_daily_target");
  if (!target || !runtimeDailyChoice(raw.completeness, ["complete", "incomplete"])) {
    runtimeDailyReject("invalid_runtime_daily_projection");
  }
  const observedMs = runtimeDailyInstant(raw.observed_at);
  if (observedMs === null) runtimeDailyReject("invalid_runtime_daily_time");
  if (observedMs > now + RUNTIME_DAILY_FUTURE_SKEW_MS) runtimeDailyReject("runtime_daily_future_observation");
  if (!Array.isArray(raw.read_errors) || raw.read_errors.length > RUNTIME_DAILY_MAX_LIST || raw.read_errors.some((item) => !runtimeDailyBoundedText(item, 120))) {
    runtimeDailyReject("invalid_runtime_daily_projection");
  }
  if (!Array.isArray(raw.records) || raw.records.length !== 1) runtimeDailyReject("invalid_runtime_daily_target");
  if (!Array.isArray(raw.unmatched_reports) || raw.unmatched_reports.length > RUNTIME_DAILY_MAX_LIST) {
    runtimeDailyReject("invalid_runtime_daily_projection");
  }
  const record = raw.records[0];
  if (!runtimeDailyExactKeys(record, [
    "platform", "target_key", "target", "business_date", "timezone", "observed_at", "status", "kind",
    "completeness", "execution_lane", "schedule", "runs", "excluded_reports", "conflicts", "fills",
  ])) runtimeDailyReject("invalid_runtime_daily_projection");
  if (record.platform !== target.platform || record.target_key !== target.target_key || record.timezone !== RUNTIME_DAILY_TIMEZONE) {
    runtimeDailyReject(record.timezone === RUNTIME_DAILY_TIMEZONE ? "invalid_runtime_daily_target" : "invalid_runtime_daily_timezone");
  }
  if (!runtimeDailyExactKeys(record.target, ["service", "strategy_profile", "account_scope"])) runtimeDailyReject("invalid_runtime_daily_target");
  if (record.target.service !== target.service || record.target.strategy_profile !== target.strategy_profile || record.target.account_scope !== target.account_scope) {
    runtimeDailyReject("invalid_runtime_daily_target");
  }
  const businessDate = runtimeDailyCalendarDate(record.business_date);
  if (!businessDate || businessDate > runtimeDailyToday(now)) runtimeDailyReject("invalid_runtime_daily_date");
  if (target.platform === "schwab" && businessDate > runtimeDailyToday(observedMs)) runtimeDailyReject("invalid_runtime_daily_date");
  if (record.observed_at !== raw.observed_at) runtimeDailyReject("invalid_runtime_daily_time");
  if (!runtimeDailyChoice(record.status, RUNTIME_DAILY_STATUSES) || !runtimeDailyChoice(record.kind, RUNTIME_DAILY_KINDS)) {
    runtimeDailyReject("invalid_runtime_daily_projection");
  }
  if (!runtimeDailyChoice(record.completeness, ["complete", "incomplete", "insufficient"]) || !runtimeDailyChoice(record.execution_lane, RUNTIME_DAILY_LANES)) {
    runtimeDailyReject("invalid_runtime_daily_projection");
  }
  if (!runtimeDailyExactKeys(record.schedule, [
    "state", "business_date", "timezone", "latest_due_at", "next_due_at", "grace_ends_at",
    "publication_grace_ended", "expected_window", "reason",
  ])) runtimeDailyReject("invalid_runtime_daily_projection");
  const schedule = record.schedule;
  if (!runtimeDailyChoice(schedule.state, RUNTIME_DAILY_SCHEDULE_STATES) || schedule.business_date !== businessDate || schedule.timezone !== RUNTIME_DAILY_TIMEZONE) {
    runtimeDailyReject("invalid_runtime_daily_projection");
  }
  runtimeDailyScheduleInstants(schedule, observedMs);
  if (schedule.publication_grace_ended !== null && typeof schedule.publication_grace_ended !== "boolean") {
    runtimeDailyReject("invalid_runtime_daily_projection");
  }
  if (!runtimeDailyChoice(schedule.expected_window, ["unspecified", "inside", "outside"])) {
    runtimeDailyReject("invalid_runtime_daily_projection");
  }
  if (schedule.reason !== null && !runtimeDailyBoundedText(schedule.reason, 120)) runtimeDailyReject("invalid_runtime_daily_projection");
  if (target.platform === "schwab") validateSchwabRuntimeDailySchedule(schedule, observedMs);
  if (!Array.isArray(record.runs) || record.runs.length > RUNTIME_DAILY_MAX_RUNS) runtimeDailyReject("runtime_daily_run_limit");
  const runs = record.runs.map((run) => normalizeRuntimeDailyRun(run, observedMs, target));
  const excluded = normalizeExcludedReports(record.excluded_reports, target);
  if (!Array.isArray(record.conflicts) || record.conflicts.length > RUNTIME_DAILY_MAX_LIST || record.conflicts.some((item) => !runtimeDailyBoundedText(item, 160))) {
    runtimeDailyReject("invalid_runtime_daily_projection");
  }
  if (["no_submission", "no_signal", "no_rebalance", "filled", ...RUNTIME_DAILY_SCHEDULE_ONLY].includes(record.status)
    && (record.conflicts.length || runs.some((run) => runtimeDailyRunIssue(run) !== null))) {
    runtimeDailyReject("runtime_daily_summary_conflict");
  }
  if (!runtimeDailyExactKeys(record.fills, ["source", "records", "count"]) || record.fills.source !== "not_connected" || record.fills.count !== null || !Array.isArray(record.fills.records) || record.fills.records.length !== 0) {
    runtimeDailyReject("invalid_runtime_daily_fills");
  }
  const unmatched = normalizeUnmatchedReports(raw.unmatched_reports, target);
  if (target.platform === "schwab") {
    if (raw.read_errors.some((item) => !["report_read_error", "coverage_unconfirmed", "report_rejected"].includes(item))
      || record.conflicts.some((item) => !SCHWAB_RUN_ID_RE.test(item))
      || record.execution_lane === "paper") runtimeDailyReject("invalid_runtime_daily_projection");
    const lanes = new Set(runs.map((run) => run.execution_lane));
    if (record.execution_lane !== (lanes.size === 1 ? runs[0].execution_lane : "insufficient")) runtimeDailyReject("invalid_runtime_daily_projection");
    validateSchwabRuntimeDailySummary(raw, record, runs, observedMs);
  }
  return {
    platform: target.platform,
    observed_at: raw.observed_at,
    completeness: raw.completeness,
    read_errors: [...raw.read_errors],
    records: [{
      platform: target.platform,
      target_key: target.target_key,
      target: { ...record.target },
      business_date: businessDate,
      timezone: RUNTIME_DAILY_TIMEZONE,
      observed_at: raw.observed_at,
      status: record.status,
      kind: record.kind,
      completeness: record.completeness,
      execution_lane: record.execution_lane,
      schedule: { ...schedule },
      runs,
      excluded_reports: excluded,
      conflicts: [...record.conflicts],
      fills: { source: "not_connected", records: [], count: null },
    }],
    unmatched_reports: unmatched,
  };
}

export function runtimeDailyStoredProjection(raw, target, binding) {
  if (target.platform === "longbridge" && !binding.fingerprint) return raw;
  if (!runtimeDailyExactKeys(raw, ["binding_fingerprint", "projection"])) throw new HttpError("runtime_daily_record_invalid", 503);
  if (raw.binding_fingerprint !== binding.fingerprint) throw new HttpError("runtime_daily_binding_changed", 409);
  return raw.projection;
}

export function runtimeDailyPublicRecord(record) {
  return {
    target_key: record.target_key,
    service: record.target.service,
    strategy_profile: record.target.strategy_profile,
    account_scope: record.target.account_scope,
    business_date: record.business_date,
    timezone: record.timezone,
    observed_at: record.observed_at,
    status: record.status,
    kind: record.kind,
    completeness: record.completeness,
    execution_lane: record.execution_lane,
    schedule: {
      state: record.schedule.state,
      business_date: record.schedule.business_date,
      timezone: record.schedule.timezone,
      latest_due_at: record.schedule.latest_due_at,
      next_due_at: record.schedule.next_due_at,
      grace_ends_at: record.schedule.grace_ends_at,
      publication_grace_ended: record.schedule.publication_grace_ended,
      expected_window: record.schedule.expected_window,
      ...(record.platform === "schwab" && ["no_cron_on_business_date", "market_closed"].includes(record.schedule.reason)
        ? { reason: record.schedule.reason } : {}),
    },
    runs: record.runs.map((run) => ({
      run_id: run.run_id,
      started_at: run.started_at,
      finished_at: run.finished_at,
      activity: run.activity,
      execution_lane: run.execution_lane,
      errors_present: run.evidence.errors_present,
      ...(record.platform === "schwab" ? { issue: runtimeDailyRunIssue(run) } : {}),
    })),
    conflict_count: record.conflicts.length,
    excluded_count: record.excluded_reports.length,
  };
}

export function runtimeDailyReadSummary(status, reason, observedRunCount = null) {
  return {
    source: "stored_runtime_daily_projection",
    status,
    reason,
    observed_run_count: observedRunCount,
    total_run_count: status === "complete" ? observedRunCount : null,
  };
}

export function runtimeDailyReadStatus(stored, now) {
  const record = stored.records[0];
  const complete = stored.completeness === "complete" && record.completeness === "complete"
    && !stored.read_errors.length && !stored.unmatched_reports.length && !record.conflicts.length
    && record.kind !== "incomplete" && !["read_incomplete", "missing_report", "insufficient", "conflict"].includes(record.status);
  const observedMs = runtimeDailyInstant(stored.observed_at);
  const today = record.business_date === runtimeDailyToday(now);
  let dataStatus = "historical";
  if (today) {
    const fresh = observedMs !== null && observedMs <= now + RUNTIME_DAILY_FUTURE_SKEW_MS && now - observedMs <= RUNTIME_DAILY_STALE_MS;
    dataStatus = fresh ? "fresh" : "stale";
  }
  return {
    data_status: dataStatus,
    read_summary: runtimeDailyReadSummary(
      complete ? "complete" : "partial",
      complete ? null : "runtime_daily_incomplete",
      record.runs.length,
    ),
    read_error_count: stored.read_errors.length,
    read_error_codes: stored.read_errors.map((error) => {
      if (["report_read_error", "coverage_unconfirmed", "report_rejected", "read_failed", "read_truncated", "list_failed"].includes(error)) return error;
      if (error === "listing truncated") return "listing_truncated";
      if (error === "runtime_target_enabled_schedule_unverified") return "schedule_unverified";
      if (error === "runtime_target_disabled") return "target_disabled";
      return "source_read_error";
    }),
    unmatched_count: stored.unmatched_reports.length,
    record: runtimeDailyPublicRecord(record),
    fills: { source: "not_connected", records: [], count: null },
  };
}
