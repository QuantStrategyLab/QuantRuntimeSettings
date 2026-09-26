// UX1 research draft, preview request, and sanitized result.
// Browser posts this shape to the Worker. The Worker forwards a stored
// revision's request to the fixed UX1_RESEARCH_CALCULATOR binding.
// UES reads qsl.ux1.preview_request.v1 on stdin and writes
// qsl.ux1.preview_result.v1 on stdout. No path, URL, command, or account.

export const UX1_DRAFT_SCHEMA = "qsl.ux1.research_draft.v1";
export const UX1_REQUEST_SCHEMA = "qsl.ux1.preview_request.v1";
export const UX1_RESULT_SCHEMA = "qsl.ux1.preview_result.v1";
export const UX1_INTENT_SCHEMA = "qsl.ux1.research_intent.v1";

export const UX1_STUDY = Object.freeze({
  research_case_id: "r8_first_dynamic_2023_03_29",
  candidate_id: "r8_finite_action_joint_account_60session_b0_startup_development_v2",
  objective: "one_step_net_log_score",
  candidate_set_id: "r8_b0_b3",
  capital_variant: "C2",
  cost_bps: 10,
  source_class: "historical_development",
  decision_close: "2023-03-29",
  simulated_execution_date: "2023-03-30",
  horizon: "one_session",
  research_account_initial_nav_usd: 10000,
  account_connection: "native_not_observed",
  model_scope: "r8_one_step_net_log_b0_b3",
  optimality_scope: "best_score_among_feasible_B0_B3_only",
});

export const UX1_ADVANCED_KEYS = Object.freeze([
  "plugin_mode",
  "income_layer_mode",
  "income_layer_start_usd",
  "income_layer_max_ratio",
  "option_overlay_mode",
  "reserve_policy_mode",
  "min_reserved_cash_usd",
  "reserved_cash_ratio",
  "cash_only_execution_mode",
  "dca_mode",
  "dca_base_investment_usd",
]);

const SUPPORTED_OBJECTIVES = new Set([UX1_STUDY.objective]);
const UNSUPPORTED_OBJECTIVES = new Set(["global_optimum"]);
const SUPPORTED_CASES = new Set([UX1_STUDY.research_case_id]);
const UNSUPPORTED_CASES = new Set(["original_full_v2"]);
const PLUGIN_MODES = new Set(["none", "auto", "current"]);
const INCOME_LAYER_MODES = new Set(["enabled", "disabled", "current"]);
const OPTION_OVERLAY_MODES = new Set(["current", "enabled", "disabled"]);
const RESERVE_POLICY_MODES = new Set(["current", "none", "ratio", "floor", "max"]);
const CASH_ONLY_MODES = new Set(["current", "enabled", "disabled"]);
const DCA_MODES = new Set(["fixed", "smart"]);
const AMOUNT_KEYS = new Set(["income_layer_start_usd", "min_reserved_cash_usd", "dca_base_investment_usd"]);
const RATIO_KEYS = new Set(["income_layer_max_ratio", "reserved_cash_ratio"]);
const ENUM_FIELDS = {
  plugin_mode: PLUGIN_MODES,
  income_layer_mode: INCOME_LAYER_MODES,
  option_overlay_mode: OPTION_OVERLAY_MODES,
  reserve_policy_mode: RESERVE_POLICY_MODES,
  cash_only_execution_mode: CASH_ONLY_MODES,
  dca_mode: DCA_MODES,
};

const DRAFT_KEYS = new Set(["objective", "research_case_id", "advanced_settings"]);
const FORBIDDEN_KEYS = new Set([
  "account", "account_id", "account_key", "account_selector", "account_scope", "account_options",
  "authority", "execution_authority", "execution_authority_granted", "secret", "secrets", "token",
  "password", "credential", "credentials", "url", "uri", "path", "command", "broker", "workflow",
  "apply", "kind", "execution_mode", "paper", "shadow", "live", "runtime", "service", "endpoint",
  "interpreter", "adapter", "input_root", "api_key", "authorization", "view_mode", "cookie",
]);
const INTENT_STATUSES = new Set(["computed", "unsupported_scope", "no_advantage", "no_action"]);
const NATIVE_RESULT_KEYS = new Set([
  "schema", "status", "reason_code", "reasons", "request_fingerprint", "advanced_settings",
  "research_only", "no_order", "execution_authority_granted", "native_observed",
  "paper_authorized", "shadow_authorized", "live_authorized", "original_full_v2_mapped",
  "original_full_v2_features_silently_disabled", "advanced_null_asserts_original_full_v2_toggles",
  "candidate_id", "candidate_set_id", "objective", "research_case_id", "source_class",
  "source_assurance", "model_id", "capital_variant", "cost_bps", "initial_research_nav_usd",
  "optimality_scope", "development", "strict_point_in_time_certified", "decision_preview",
  "historical_execution_check", "limitations", "r7_policy_sha256", "r8_policy_sha256",
  "capital_policy_id", "capital_policy_sha256", "settlement_policy_id", "settlement_policy_sha256",
  "raw_manifest_sha256", "r6_manifest_sha256", "r6_materialized_file_sha256",
]);

export class Ux1InputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function defaultUx1AdvancedSettings() {
  return Object.fromEntries(UX1_ADVANCED_KEYS.map((key) => [key, null]));
}

export function defaultUx1Draft() {
  return {
    objective: UX1_STUDY.objective,
    research_case_id: UX1_STUDY.research_case_id,
    advanced_settings: defaultUx1AdvancedSettings(),
  };
}

export function ux1CustomDraft(draft) {
  return UX1_ADVANCED_KEYS.some((key) => draft.advanced_settings[key] !== null);
}

export function assertUx1DraftPost(body) {
  assertPlainObject(body);
  assertExactKeys(body, ["expected_revision", "objective", "research_case_id", "advanced_settings"]);
  return {
    expected_revision: assertRevision(body.expected_revision),
    draft: normalizeUx1Draft(body),
  };
}

export function assertUx1PreviewPost(body) {
  assertPlainObject(body);
  assertExactKeys(body, ["expected_revision"]);
  return { expected_revision: assertRevision(body.expected_revision) };
}

export function assertUx1IntentPost(body) {
  assertPlainObject(body);
  assertExactKeys(body, ["expected_revision", "fingerprint"]);
  return {
    expected_revision: assertRevision(body.expected_revision),
    fingerprint: assertFingerprint(body.fingerprint),
  };
}

export function normalizeUx1Draft(input) {
  assertPlainObject(input);
  const unknown = Object.keys(input).filter((key) => !DRAFT_KEYS.has(key) && key !== "expected_revision");
  if (unknown.length) throw new Ux1InputError("ux1_unknown_field");
  rejectForbiddenTree(input);
  const advanced = input.advanced_settings;
  assertPlainObject(advanced);
  const advancedKeys = Object.keys(advanced);
  if (advancedKeys.length !== UX1_ADVANCED_KEYS.length || UX1_ADVANCED_KEYS.some((key) => !Object.hasOwn(advanced, key))) {
    throw new Ux1InputError("ux1_advanced_settings_required");
  }
  const settings = defaultUx1AdvancedSettings();
  for (const key of UX1_ADVANCED_KEYS) settings[key] = normalizeAdvancedValue(key, advanced[key]);
  assertReserve(settings);
  return {
    objective: normalizeSelection(input.objective, SUPPORTED_OBJECTIVES, UNSUPPORTED_OBJECTIVES, "ux1_objective_invalid"),
    research_case_id: normalizeSelection(input.research_case_id, SUPPORTED_CASES, UNSUPPORTED_CASES, "ux1_research_case_invalid"),
    advanced_settings: settings,
  };
}

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

export async function ux1Fingerprint(draft) {
  const { schema, ...business } = buildUx1PreviewRequest(draft);
  return sha256Hex(canonicalJson(business));
}

export function buildUx1PreviewRequest(draft) {
  return {
    schema: UX1_REQUEST_SCHEMA,
    research_case_id: draft.research_case_id,
    candidate_id: UX1_STUDY.candidate_id,
    objective: draft.objective,
    candidate_set_id: UX1_STUDY.candidate_set_id,
    capital_variant: UX1_STUDY.capital_variant,
    cost_bps: UX1_STUDY.cost_bps,
    source_class: UX1_STUDY.source_class,
    advanced_settings: Object.fromEntries(UX1_ADVANCED_KEYS.map((key) => [key, draft.advanced_settings[key]])),
  };
}

export function classifyUx1Draft(draft) {
  const reasons = [];
  if (draft.objective === null || draft.research_case_id === null) {
    return { kind: "missing_input", reasons: [{ field: draft.objective === null ? "objective" : "research_case_id", reason: "objective_or_case_not_selected" }] };
  }
  if (UNSUPPORTED_OBJECTIVES.has(draft.objective)) reasons.push({ field: "objective", reason: "objective_not_in_r8_scope" });
  if (UNSUPPORTED_CASES.has(draft.research_case_id)) reasons.push({ field: "research_case_id", reason: "research_case_not_in_r8_scope" });
  for (const key of UX1_ADVANCED_KEYS) {
    if (draft.advanced_settings[key] !== null) reasons.push({ field: key, reason: "r8_does_not_model_custom_field" });
  }
  if (UNSUPPORTED_OBJECTIVES.has(draft.objective) || UNSUPPORTED_CASES.has(draft.research_case_id)) {
    return { kind: "unsupported_scope", reasons };
  }
  return { kind: "calculate", reasons };
}

export function localUx1Preview({ draft, fingerprint, status, reasons }) {
  const limitations = status === "missing_input"
    ? ["选择研究目标和历史案例后才能计算"]
    : [
      "本次只覆盖冻结的 R8 有限动作研究",
      "原完整 v2 的收入层、期权和插件身份仍然保留",
      "未声明的 UX1 字段不是这些功能的关闭开关",
    ];
  return {
    schema_version: UX1_RESULT_SCHEMA,
    fingerprint,
    status,
    source_class: UX1_STUDY.source_class,
    model_scope: status === "missing_input" ? null : UX1_STUDY.model_scope,
    optimality_scope: null,
    research_case_id: draft.research_case_id,
    candidate_id: UX1_STUDY.candidate_id,
    objective: draft.objective,
    candidate_set_id: UX1_STUDY.candidate_set_id,
    research_only: true,
    no_order: true,
    execution_authority_granted: false,
    native_observed: false,
    limitations,
    unsupported_reasons: reasons,
    decision_preview: null,
    historical_execution_check: null,
  };
}

export function projectUx1CalculatorResult(raw, request, draft, fingerprint) {
  const reject = () => { throw new Ux1InputError("calculator_result_rejected", 502); };
  const finite = (value) => {
    if (typeof value !== "number" || !Number.isFinite(value)) reject();
    return value;
  };
  const safeText = (value) => {
    if (typeof value !== "string" || !/^[A-Za-z0-9_.:-]{1,100}$/.test(value)) reject();
    return value;
  };
  const exactMap = (value, keys, integer = false) => {
    assertPlainObject(value);
    if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) reject();
    return Object.fromEntries(keys.map((key) => {
      const number = finite(value[key]);
      if (integer && !Number.isSafeInteger(number)) reject();
      return [key, number];
    }));
  };
  const nested = (value, integer = false) => {
    assertPlainObject(value);
    if (Object.keys(value).length !== 3 || ["outer", "tqqq", "soxl"].some((key) => !Object.hasOwn(value, key))) reject();
    return {
      outer: exactMap(value.outer, ["QQQM", "BOXX"], integer),
      tqqq: exactMap(value.tqqq, ["TQQQ"], integer),
      soxl: exactMap(value.soxl, ["SOXL", "SOXX", "BOXX"], integer),
    };
  };
  assertPlainObject(raw);
  if (Object.keys(raw).some((key) => !NATIVE_RESULT_KEYS.has(key))) reject();
  if (raw.schema !== UX1_RESULT_SCHEMA || raw.request_fingerprint !== fingerprint) reject();
  if (raw.research_only !== true || raw.no_order !== true || raw.execution_authority_granted !== false || raw.native_observed !== false || raw.original_full_v2_mapped !== false || raw.original_full_v2_features_silently_disabled !== false || raw.advanced_null_asserts_original_full_v2_toggles !== false || raw.paper_authorized !== false || raw.shadow_authorized !== false || raw.live_authorized !== false) reject();
  if (canonicalJson(raw.advanced_settings) !== canonicalJson(request.advanced_settings)) reject();
  if (raw.status === "failed" || raw.status === "rejected") throw new Ux1InputError("calculator_failed", 502);
  if (raw.status !== "ok" && raw.status !== "unsupported_scope" && raw.status !== "missing_input") reject();
  if (raw.status === "ok" && (raw.source_class !== UX1_STUDY.source_class || raw.candidate_id !== UX1_STUDY.candidate_id || raw.candidate_set_id !== UX1_STUDY.candidate_set_id || raw.objective !== draft.objective || raw.research_case_id !== draft.research_case_id || raw.capital_variant !== UX1_STUDY.capital_variant || raw.cost_bps !== UX1_STUDY.cost_bps || raw.initial_research_nav_usd !== UX1_STUDY.research_account_initial_nav_usd || raw.optimality_scope !== UX1_STUDY.optimality_scope || raw.development !== true || raw.strict_point_in_time_certified !== false)) reject();

  const reasons = [];
  if (raw.status !== "ok") {
    if (!Array.isArray(raw.reasons) || raw.reasons.length > 20) reject();
    for (const reason of raw.reasons) {
      const safeReason = safeText(reason);
      const field = UX1_ADVANCED_KEYS.find((key) => safeReason.startsWith(`${key}_`)) || "research_case_id";
      reasons.push({ field, reason: safeReason });
    }
  }
  for (const item of classifyUx1Draft(draft).reasons) {
    if (!reasons.some((other) => other.field === item.field && other.reason === item.reason)) reasons.push(item);
  }
  let decision = null;
  let historical = null;
  let evidence = null;
  let limitations = raw.status === "ok" ? projectLimitations(raw.limitations) : ["当前输入或资料尚不支持此次数值计算"];
  if (raw.status === "ok") {
    const d = raw.decision_preview;
    const h = raw.historical_execution_check;
    assertPlainObject(d);
    assertPlainObject(h);
    const decisionKeys = ["decision_date", "scenarios_observed_through", "scenario_count", "selected_action", "previous_action", "previous_action_retained", "scores", "score_gain_over_previous_action", "tie_log_tolerance", "no_advantage", "member_budgets_usd", "asset_targets_usd", "outer_cash_target_usd", "curve_ratio", "wealth_reference_usd", "aggregate_member_cap_usd"];
    const historicalKeys = ["trade_date", "decision_date", "feeds_back_into_decision", "trade_shares", "fees_usd", "total_fees_usd", "settled_cash_usd", "pending_sale_usd", "receivable_usd", "shortages", "no_action"];
    if (Object.keys(d).length !== decisionKeys.length || Object.keys(h).length !== historicalKeys.length || decisionKeys.some((key) => !Object.hasOwn(d, key)) || historicalKeys.some((key) => !Object.hasOwn(h, key))) reject();
    if (d.decision_date !== UX1_STUDY.decision_close || d.scenarios_observed_through > UX1_STUDY.decision_close || d.scenario_count !== 60 || h.decision_date !== UX1_STUDY.decision_close || h.trade_date !== UX1_STUDY.simulated_execution_date || h.feeds_back_into_decision !== false || typeof d.no_advantage !== "boolean" || typeof d.previous_action_retained !== "boolean" || typeof h.no_action !== "boolean") reject();
    if (!["B0", "B1", "B2", "B3"].includes(d.selected_action) || !["B0", "B1", "B2", "B3"].includes(d.previous_action)) reject();
    const shares = nested(h.trade_shares, true);
    const actualNoAction = Object.values(shares).every((owner) => Object.values(owner).every((value) => value === 0));
    if (actualNoAction !== h.no_action) reject();
    const scores = exactMap(d.scores, ["B0", "B1", "B2", "B3"]);
    const tolerance = finite(d.tie_log_tolerance);
    if (tolerance < 0 || d.no_advantage !== (scores[d.previous_action] >= Math.max(...Object.values(scores)) - tolerance)) reject();
    decision = {
      decision_date: d.decision_date,
      scenarios_observed_through: d.scenarios_observed_through,
      scenario_count: d.scenario_count,
      selected_action: d.selected_action,
      previous_action: d.previous_action,
      previous_action_retained: d.previous_action_retained,
      no_advantage: d.no_advantage,
      scores,
      score_gain_over_previous_action: finite(d.score_gain_over_previous_action),
      tie_log_tolerance: tolerance,
      member_budgets_usd: exactMap(d.member_budgets_usd, ["tqqq", "soxl"]),
      asset_targets_usd: nested(d.asset_targets_usd),
      outer_cash_target_usd: finite(d.outer_cash_target_usd),
      curve_ratio: finite(d.curve_ratio),
      wealth_reference_usd: finite(d.wealth_reference_usd),
      aggregate_member_cap_usd: finite(d.aggregate_member_cap_usd),
    };
    const fees = nested(h.fees_usd);
    const totalFees = finite(h.total_fees_usd);
    if (Math.abs(Object.values(fees).flatMap((owner) => Object.values(owner)).reduce((sum, value) => sum + value, 0) - totalFees) > 1e-6) reject();
    if (!Array.isArray(h.shortages) || h.shortages.length > 20) reject();
    const shortages = h.shortages.map((item) => {
      assertPlainObject(item);
      if (Object.keys(item).length !== 4 || !["outer", "tqqq", "soxl"].includes(item.owner) || !["QQQM", "BOXX", "TQQQ", "SOXL", "SOXX"].includes(item.symbol)) reject();
      for (const key of ["desired_shares", "filled_shares"]) if (!Number.isSafeInteger(item[key]) || item[key] < 0) reject();
      if (item.filled_shares > item.desired_shares) reject();
      return { owner: item.owner, symbol: item.symbol, desired_shares: item.desired_shares, filled_shares: item.filled_shares };
    });
    historical = {
      trade_date: h.trade_date,
      decision_date: h.decision_date,
      feeds_back_into_decision: false,
      trade_shares: shares,
      fees_usd: fees,
      total_fees_usd: totalFees,
      settled_cash_usd: finite(h.settled_cash_usd),
      pending_sale_usd: finite(h.pending_sale_usd),
      receivable_usd: finite(h.receivable_usd),
      shortages,
      no_action: h.no_action,
    };
    const hashes = ["r7_policy_sha256", "r8_policy_sha256", "capital_policy_sha256", "settlement_policy_sha256", "raw_manifest_sha256", "r6_manifest_sha256", "r6_materialized_file_sha256"];
    for (const key of hashes) if (typeof raw[key] !== "string" || !/^[a-f0-9]{64}$/.test(raw[key])) reject();
    evidence = {
      model_id: safeText(raw.model_id),
      source_assurance: safeText(raw.source_assurance),
      capital_policy_id: safeText(raw.capital_policy_id),
      settlement_policy_id: safeText(raw.settlement_policy_id),
      ...Object.fromEntries(hashes.map((key) => [key, raw[key]])),
    };
  }
  return {
    schema_version: UX1_RESULT_SCHEMA,
    fingerprint,
    status: raw.status === "ok" ? (decision.no_advantage ? "no_advantage" : historical.no_action ? "no_action" : "computed") : raw.status,
    source_class: UX1_STUDY.source_class,
    model_scope: raw.status === "ok" ? evidence.model_id : null,
    optimality_scope: raw.status === "ok" ? UX1_STUDY.optimality_scope : null,
    research_case_id: draft.research_case_id,
    candidate_id: UX1_STUDY.candidate_id,
    objective: draft.objective,
    candidate_set_id: UX1_STUDY.candidate_set_id,
    research_only: true,
    no_order: true,
    execution_authority_granted: false,
    native_observed: false,
    limitations,
    unsupported_reasons: reasons,
    evidence,
    decision_preview: decision,
    historical_execution_check: historical,
  };
}

export function ux1IntentAllowed(preview) {
  return Boolean(preview && INTENT_STATUSES.has(preview.status) && preview.decision_preview !== undefined);
}

export async function ux1ReceiptId(login, revision, fingerprint) {
  return sha256Hex(`${login}\n${revision}\n${fingerprint}`);
}

export function ux1IntentRecord({ login, revision, fingerprint, receiptId }) {
  return {
    schema_version: UX1_INTENT_SCHEMA,
    receipt_id: receiptId,
    login,
    revision,
    fingerprint,
    research_only: true,
    no_order: true,
    execution_authority_granted: false,
    native_observed: false,
    executable: false,
  };
}

function normalizeSelection(value, supported, unsupported, code) {
  if (value === null) return null;
  if (typeof value !== "string" || (!supported.has(value) && !unsupported.has(value))) throw new Ux1InputError(code);
  return value;
}

function normalizeAdvancedValue(key, value) {
  if (value === null) return null;
  if (ENUM_FIELDS[key]) {
    if (typeof value !== "string" || !ENUM_FIELDS[key].has(value)) throw new Ux1InputError("ux1_advanced_value_invalid");
    return value;
  }
  if (AMOUNT_KEYS.has(key)) return canonicalDecimal(value, key, 1_000_000_000);
  if (RATIO_KEYS.has(key)) return canonicalDecimal(value, key, 1);
  throw new Ux1InputError("ux1_unknown_field");
}

function canonicalDecimal(value, field, max) {
  const text = typeof value === "number" ? String(value) : String(value ?? "");
  if (!/^(?:\d+|\d*\.\d+)$/.test(text)) throw new Ux1InputError("ux1_advanced_value_invalid");
  const numeric = Number(text);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > max) throw new Ux1InputError("ux1_advanced_value_invalid");
  const [whole, frac = ""] = text.split(".");
  const normalizedWhole = whole.replace(/^0+(?=\d)/, "") || "0";
  const normalizedFrac = frac.replace(/0+$/, "");
  const normalized = normalizedFrac ? `${normalizedWhole}.${normalizedFrac}` : normalizedWhole;
  if (normalized.length > 32) throw new Ux1InputError("ux1_advanced_value_invalid");
  return normalized;
}

function assertReserve(settings) {
  const mode = settings.reserve_policy_mode;
  const floor = settings.min_reserved_cash_usd;
  const ratio = settings.reserved_cash_ratio;
  const empty = floor === null && ratio === null;
  if (mode === null || mode === "none" || mode === "current") {
    if (!empty) throw new Ux1InputError("ux1_reserve_fields");
    return;
  }
  if (mode === "ratio" && !(ratio !== null && floor === null)) throw new Ux1InputError("ux1_reserve_fields");
  if (mode === "floor" && !(floor !== null && ratio === null)) throw new Ux1InputError("ux1_reserve_fields");
  if (mode === "max" && !(floor !== null && ratio !== null)) throw new Ux1InputError("ux1_reserve_fields");
}

function assertPlainObject(value) {
  if (!value || Array.isArray(value) || typeof value !== "object") throw new Ux1InputError("ux1_invalid_body");
}

function assertExactKeys(body, allowed) {
  const keys = Object.keys(body);
  if (keys.some((key) => !allowed.includes(key)) || allowed.some((key) => !Object.hasOwn(body, key))) {
    throw new Ux1InputError(keys.some((key) => forbiddenKey(key)) ? "ux1_forbidden_field" : "ux1_unknown_field");
  }
  rejectForbiddenTree(body);
}

function assertRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Ux1InputError("ux1_revision_required");
  return value;
}

function assertFingerprint(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Ux1InputError("ux1_fingerprint_invalid");
  return value;
}

function rejectForbiddenTree(value) {
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && forbiddenText(value)) throw new Ux1InputError("ux1_forbidden_field");
    return;
  }
  const entries = Array.isArray(value) ? value.entries() : Object.entries(value);
  for (const [key, item] of entries) {
    if (typeof key === "string" && (forbiddenKey(key) || key === "__proto__" || key === "constructor" || key === "prototype")) {
      throw new Ux1InputError("ux1_forbidden_field");
    }
    rejectForbiddenTree(item);
  }
}

function forbiddenKey(key) {
  return FORBIDDEN_KEYS.has(String(key).toLowerCase());
}

function forbiddenText(value) {
  const text = value.trim();
  return text.includes("://") || text.startsWith("/") || text.startsWith("\\\\") || text.includes("..") || /^[a-zA-Z]:\\/.test(text);
}

function assertShortText(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 80 || forbiddenText(value)) {
    throw new Ux1InputError("calculator_result_rejected", 502);
  }
  return value;
}

function projectLimitations(value) {
  if (!Array.isArray(value) || value.length > 20) throw new Ux1InputError("calculator_result_rejected", 502);
  return value.map((item) => assertShortText(item));
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
