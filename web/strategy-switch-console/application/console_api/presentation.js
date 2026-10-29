/** Display-safe projections. Legacy evidence payloads are never display text. */
export const SETTINGS_FIELDS = {
  strategy_profile: "strategy",
  dca_mode: "dca",
  dca_base_investment_usd: "dca",
  reserved_cash_floor: "cash_reserve",
  reserved_cash_ratio: "cash_reserve",
  income_layer_enabled: "income_layer",
  option_overlay_enabled: "options_layer",
};
const time = (value) =>
  typeof value === "string" && Number.isFinite(Date.parse(value))
    ? value
    : null;
const scalar = (value) =>
  typeof value === "boolean" ||
  (typeof value === "number" && Number.isFinite(value)) ||
  (typeof value === "string" &&
    value.length <= 80 &&
    /^[a-zA-Z0-9_.:+/-]+$/.test(value))
    ? value
    : null;
export function settingsDiff(settings) {
  const overrides = settings.draft?.overrides || {};
  return Object.entries(SETTINGS_FIELDS).map(([field, section]) => {
    const known = settings.effective?.[field]?.status === "known";
    const current = known ? settings.effective[field].value : null;
    const overridden = Object.hasOwn(overrides, field);
    return {
      section,
      field,
      label_key: `settings.${field}`,
      current,
      draft: overridden ? overrides[field] : current,
      affects_live: true,
      current_status: known ? "known" : "unknown",
      overridden,
      changed: overridden && (!known || overrides[field] !== current),
    };
  });
}
export function decisionFields(entry, category, now = Date.now()) {
  const data = entry.candidate || entry.recovery || entry;
  const expires = time(data.expires_at || entry.expires_at);
  const freshness =
    entry.freshness?.status ||
    entry.freshness?.data_status ||
    data.freshness?.status ||
    "unknown";
  const decided = !!(
    entry.intent ||
    entry.confirmation ||
    entry.rejection ||
    data.human_decision
  );
  const expired =
    (expires && Date.parse(expires) < now) ||
    ["stale", "expired"].includes(freshness);
  const diff = [];
  const row = (field, before, after, affects = category !== "paper_account_application") => {
    const old = scalar(before),
      next = scalar(after);
    if (old !== null || next !== null)
      diff.push({
        field,
        label_key: `decisions.${field.split(".")[0]}`,
        before: old,
        after: next,
        affects_live: affects,
      });
  };
  if (data.mode !== "initial_enrollment") row(
    "strategy",
    data.current_strategy_profile,
    data.strategy_profile || data.proposed_strategy_profile,
  );
  row(
    "version",
    data.current_version,
    data.proposed_version || data.version || data.strategy_revision,
  );
  for (const key of Object.keys(data.proposed_params || {}).sort()) {
    if (
      /^[a-z][a-z0-9_]{0,63}$/.test(key) &&
      !/hash|sha|audit|note|reason|job|task|commit|path|url|secret|token/i.test(
        key,
      )
    ) {
      row(
        `parameters.${key}`,
        data.current_params?.[key],
        data.proposed_params[key],
      );
    }
  }
  row("shadow_passed", undefined, data.shadow_passed, false);
  const comparison = data.research_summary?.comparison;
  for (const group of ["baseline", "candidate"])
    for (const [key, value] of Object.entries(comparison?.[group] || {})) {
      if (
        typeof value === "number" &&
        Number.isFinite(value) &&
        /^[a-z][a-z0-9_]{0,63}$/.test(key)
      )
        row(`shadow.${group}.${key}`, undefined, value, false);
    }
  return {
    category,
    priority:
      category === "reconciliation_recovery"
        ? "high"
        : category === "credential_maintenance" &&
            ["30", "7", "1", "expired"].includes(data.phase)
          ? "medium"
          : "normal",
    created_at: time(data.created_at || data.first_observed_at),
    expires_at: expires,
    evidence_freshness: {
      status: freshness,
      as_of: time(data.last_observed_at || data.observed_at),
    },
    status: decided ? "decided" : expired ? "expired" : "pending",
    affects_live:
      (category === "reconciliation_recovery" && data.mode !== "initial_enrollment") ||
      (category === "owner_decision" &&
        data.recommendation?.code === "owner_live_decision") ||
      (category === "strategy_promotion" &&
        data.confirmation_execution_mode === "live"),
    diff,
  };
}
export function decisionCategory(entry, fallback = "strategy_promotion") {
  return fallback === "strategy_promotion" &&
    (entry.confirmation_execution_mode === "paper" || entry.application?.broker_environment === "paper" ||
      entry.application_preparation?.preview_request)
    ? "paper_account_application" : fallback;
}
/** Stable display reference only. Full IDs remain mandatory for lookups and writes. */
export function shortId(id, prefix = "IN") {
  let hash = 14695981039346656037n;
  for (const byte of new TextEncoder().encode(id))
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 1099511628211n);
  return `${prefix}-${hash.toString(36).toUpperCase().padStart(13, "0")}`;
}
export function decorateQueue(payload, field, category) {
  return {
    ...payload,
    [field]: (payload[field] || []).map((item) => ({
      ...item,
      ...decisionFields(item, category),
    })),
  };
}
export function canonicalItem(entry, category) {
  category = decisionCategory(entry, category);
  const data = entry.candidate || entry.recovery || entry;
  const id =
    category === "credential_maintenance"
      ? `credential:${data.id}`
      : `${category}:${data.candidate_id || data.recovery_id || data.ticket_id}`;
  return {
    id,
    short_id: shortId(id),
    ...decisionFields(entry, category),
    ...(category === "paper_account_application" ? {
      status: entry.application || entry.state === "human_accepted" ? "decided" : decisionFields(entry, category).status,
      application_status: entry.application?.status || null,
    } : {}),
    title_key: `decisions.${category}`,
    account_alias: data.account_key || data.confirmation_account_key || null,
    platform: scalar(data.platform || data.confirmation_target_platform),
    decision_binding: entry.decision_binding || null,
    ...(category === "reconciliation_recovery" && entry.presentation ? { presentation: entry.presentation } : {}),
    ...(category === "reconciliation_recovery" && data.mode === "initial_enrollment" ? {
      initial_enrollment: { facts: data.facts, candidate_sha256: data.candidate_sha256, facts_sha256: data.facts_sha256, readiness: data.readiness, blocker_codes: data.blocker_codes },
    } : {}),
  };
}
export async function actorAlias(actor) {
  if (!actor) return null;
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(String(actor)),
  );
  return `actor-${[...new Uint8Array(hash)]
    .slice(0, 8)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("")}`;
}
export function pageQuery(url) {
  const limit = Number(url.searchParams.get("limit") || 25);
  const cursor = url.searchParams.get("cursor") || "";
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    (cursor && !/^\d+$/.test(cursor))
  )
    throw new Error("invalid_pagination");
  const offset = Number(cursor || 0);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000)
    throw new Error("invalid_pagination");
  return { limit, offset };
}
export async function decisionHistoryRows(rows) {
  const categories = {
    owner: "owner_decision",
    promotion: "strategy_promotion",
    recovery: "reconciliation_recovery",
  };
  return Promise.all(
    rows.map(async (row) => {
      const target = JSON.parse(row.target_json || "{}");
      const category = row.kind === "promotion" && (target.confirmation?.execution_mode === "paper" || row.confirmation_execution_mode === "paper")
        ? "paper_account_application" : categories[row.kind];
      const itemId = `${category}:${row.subject_id}`;
      const id = row.request_key || `${itemId}:${row.material_key}:${row.decided_at}`;
      return {
        id,
        short_id: shortId(id, "CH"),
        item_id: itemId,
        item_short_id: shortId(itemId),
        category,
        actor_alias: await actorAlias(row.actor),
        time: row.decided_at,
        action: [
          "accept", "adopt_candidate", "confirm", "approve", "approve_limited_live_canary",
        ].includes(row.action) ? "adopt_intent" : "decline_intent",
        evidence_sha256: row.material_key,
      };
    }),
  );
}
