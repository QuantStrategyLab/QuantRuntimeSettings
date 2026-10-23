import { catalogue, definitionSha256, settingsSchema } from "./definitions.js";

export { catalogue, definitionSha256 };
export const safety = { applied: false, research_only: true, execution_authorized: false, live_ready: false, no_order: true };
export const preferenceLevels = { CAPITAL_PRESERVATION: "conservative", BALANCED_COMPOUNDING: "balanced", GROWTH_COMPOUNDING: "growth" };
export const canonical = value => JSON.stringify(value, function (key, v) {
  return v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v;
});
export class RiskError extends Error {
  constructor(code, status = 400, parameter = null, details = {}) {
    super(code); this.status = status; this.parameter = parameter; this.details = details;
  }
}
export const fail = (code, status, parameter, details) => { throw new RiskError(code, status, parameter, details); };
const object = v => v !== null && typeof v === "object" && !Array.isArray(v);

// Only the pinned schema's small type/enum/bounds subset is interpreted here.
function validateValue(v, s, path) {
  const valid = s.type === "object" ? object(v) : s.type === "array" ? Array.isArray(v)
    : s.type === "integer" ? Number.isSafeInteger(v) : s.type === "number" ? typeof v === "number" && Number.isFinite(v)
      : typeof v === s.type;
  if (s.type && !valid) fail("INVALID_REQUEST", 400, path);
  if (Object.hasOwn(s, "const") && v !== s.const) fail("ENUM_VIOLATION", 400, path);
  if (s.enum && !s.enum.includes(v)) fail("ENUM_VIOLATION", 400, path);
  if ((s.minimum !== undefined && v < s.minimum) || (s.maximum !== undefined && v > s.maximum))
    fail("RISK_PARAM_OUT_OF_RANGE", 400, path, { min: s.minimum, max: s.maximum });
  if (typeof v === "string" && ((s.minLength && v.length < s.minLength) || (s.maxLength && v.length > s.maxLength) || (s.pattern && !new RegExp(s.pattern).test(v)))) fail("INVALID_REQUEST", 400, path);
  if (Array.isArray(v)) {
    if (v.length > s.maxItems || (s.uniqueItems && new Set(v.map(canonical)).size !== v.length)) fail("INVALID_REQUEST", 400, path);
    v.forEach((x, i) => validateValue(x, s.items, `${path}/${i}`));
  }
  if (object(v)) {
    if (Object.keys(v).length > s.maxProperties) fail("INVALID_REQUEST", 400, path);
    for (const key of s.required || []) if (!Object.hasOwn(v, key)) fail("INVALID_REQUEST", 400, `${path}/${key}`);
    for (const [key, value] of Object.entries(v)) {
      if (s.propertyNames?.pattern && !new RegExp(s.propertyNames.pattern).test(key)) fail("INVALID_REQUEST", 400, path);
      const sub = Object.hasOwn(s.properties || {}, key) ? s.properties[key] : s.additionalProperties;
      if (!sub || sub === false) fail("INVALID_REQUEST", 400, `${path}/${key}`);
      validateValue(value, sub, `${path}/${key}`);
    }
  }
}
export function recommended(level) {
  return Object.fromEntries(Object.entries(catalogue.parameters).map(([k, p]) => [k, structuredClone(p.defaults_by_level[level])]));
}
export function requested(raw) {
  if (object(raw?.overrides)) for (const key of Object.keys(raw.overrides)) {
    if (Object.hasOwn(catalogue.parameters, key) && !catalogue.parameters[key].user_override_allowed) fail("OVERRIDE_NOT_ALLOWED", 400, `/overrides/${key}`);
  }
  validateValue(raw, settingsSchema, "");
  if ((raw.mode === "simple" || raw.restore_system_recommendation) && Object.keys(raw.overrides).length) fail("INVALID_REQUEST", 400, "/overrides");
  const next = { ...recommended(raw.level), ...raw.overrides };
  if (next.breaker_drawdown > next.max_drawdown_tolerance) fail("RISK_PARAM_OUT_OF_RANGE", 400, "/overrides/breaker_drawdown", { max: next.max_drawdown_tolerance });
  const ids = next.strategy_ids, weights = next.strategy_weights;
  if ((next.strategy_selection_mode === "system_eligible" && ids.length) || (next.strategy_selection_mode === "explicit" && !ids.length)) fail("INVALID_REQUEST", 400, "/overrides/strategy_ids");
  if (next.strategy_weight_mode === "system_recommended" && Object.keys(weights).length) fail("INVALID_REQUEST", 400, "/overrides/strategy_weights");
  if (next.strategy_weight_mode === "explicit" && (next.strategy_selection_mode !== "explicit" || canonical(Object.keys(weights).sort()) !== canonical([...ids].sort()) || Object.values(weights).reduce((a, b) => a + b, 0) > 1)) fail("INVALID_REQUEST", 400, "/overrides/strategy_weights");
  return next;
}
export function comparison(raw, context) {
  const next = requested(raw), defaults = recommended(raw.level);
  const rows = Object.fromEntries(Object.entries(catalogue.parameters).map(([k, p]) => {
    const old = context.effective?.[k];
    const same = old !== undefined && canonical(old) === canonical(next[k]);
    const direction = same ? "UNCHANGED" : old === undefined || p.risk_increase_when === "NON_MONOTONE" ? "UNKNOWN_OR_MIXED"
      : (next[k] > old) === (p.risk_increase_when === "INCREASE") ? "INCREASE" : "DECREASE";
    return [k, { recommended_value: defaults[k], override_value: raw.overrides[k] ?? null, has_override: Object.hasOwn(raw.overrides, k),
      effective_value: old ?? null, limiting_sources: old === undefined ? ["NO_EFFECTIVE_POLICY_OBSERVED"] : [], risk_direction: direction,
      confirmation_required: !["UNCHANGED", "DECREASE"].includes(direction) }];
  }));
  const directions = new Set(Object.values(rows).map(r => r.risk_direction));
  const direction = directions.has("UNKNOWN_OR_MIXED") || (directions.has("INCREASE") && directions.has("DECREASE")) ? "UNKNOWN_OR_MIXED"
    : directions.has("INCREASE") ? "INCREASE" : directions.has("DECREASE") ? "DECREASE" : "UNCHANGED";
  return { next, rows, direction, increase: !["UNCHANGED", "DECREASE"].includes(direction) };
}
