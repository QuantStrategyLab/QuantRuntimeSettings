// N1 §4.C: GET /api/desk/accounts (qsl.desk.accounts.v2).
//
// Broker cards are a projection of the saved account configuration, the stored
// account-facts snapshots (existing read-only `account_facts_list` command) and
// the stored credential-maintenance record (`credential_maintenance_read`).
// Nothing here rotates a credential, refreshes a provider or creates a
// readback. Connectivity, heartbeat and last order have no trusted stored
// source and stay unknown/not_supported; config drift has no stored,
// identity-bound comparison on the read path and stays unknown as well.
import { accountFactsReadModelEnabled, buildAccountFactsReadModel } from "../../account_facts.js";
import { managementCohort } from "../account_mapping/management_cohort.js";
import { credentialItems } from "./credentials.js";
import { REGISTERED_CREDENTIALS } from "../credential_calendar/registry.js";
import { projectCredentialCalendar } from "../credential_calendar/projector.js";
import { DeskError } from "./http.js";
import { ibkrAccountId, readbackTargets } from "./readback.js";
import {
  coverage, freshness, known, n1Response, n1Route, notSupported, readOnce, timeBasis, unknown, utcInstant,
} from "./n1.js";

export const FACTS_STALE_SECONDS = 36 * 60 * 60;
const LABELS = { ibkr: "IBKR", schwab: "Schwab", longbridge: "LongBridge", binance: "Binance", firstrade: "Firstrade" };

export function platformLabel(platform) {
  return LABELS[platform] || platform.charAt(0).toUpperCase() + platform.slice(1);
}

/** A config key is not an account number: only a configured selector yields a suffix. */
export function maskedAccount(option, label) {
  const raw = typeof option?.account_selector === "string" ? option.account_selector.trim() : "";
  const suffix = /^[A-Za-z0-9]{4,}$/.test(raw) ? raw.slice(-4) : "";
  return { account_ref: `${label} ••••${suffix}`, account_suffix: suffix };
}

/** Bilingual (zh-CN first) account reference for an IBKR target without a validated broker ID. */
export const IBKR_ACCOUNT_ID_UNAVAILABLE = "账户号不可用 / Account ID unavailable";

/**
 * Authenticated account reference. IBKR is named only by its full validated ID;
 * a missing or invalid selector is shown as unavailable, never as a suffix-derived
 * name. Other platforms keep the masked form. account_suffix is unchanged.
 */
export function accountRef(platform, option, label) {
  const masked = maskedAccount(option, label);
  if (platform !== "ibkr") return masked;
  return { ...masked, account_ref: ibkrAccountId(platform, option?.account_selector) ?? IBKR_ACCOUNT_ID_UNAVAILABLE };
}

/** Stored facts row for one configured target, or null when no bound snapshot exists. */
export function factsRowFor(model, target) {
  const rows = Array.isArray(model?.accounts) ? model.accounts : [];
  const matches = rows.filter(row => row.platform === target.platform && row.account_key === target.key);
  return matches.length === 1 ? matches[0] : null;
}

/** Observation instant of a bound, readable snapshot; anything else is unproven. */
export function factsObservedAt(row) {
  if (!row || row.binding_status !== "bound" || !["fresh", "stale"].includes(row.data_status)) return null;
  return utcInstant(row.observed_finished_at);
}

function credentialFor(platform, credential) {
  if (platform !== "ibkr") {
    // No stored expiry source exists for this platform; unknown is not "none".
    return { kind: "other", expiry: { status: "unknown", reason: "not_supported" }, phase: "unknown", requires_action: false };
  }
  if (!credential.ok) {
    return { kind: "flex_token", expiry: { status: "unknown", reason: "read_failed" }, phase: "unknown", requires_action: false };
  }
  const { kind, expiry, phase, requires_action } = credential.item;
  return { kind, expiry, phase, requires_action };
}

/** Per-broker freshness from the oldest stored observation; a missing one makes it unavailable. */
export function brokerFreshness(targets, facts, now) {
  if (!facts.ok || !targets.length) return { data_status: "unavailable", age_seconds: null };
  const times = targets.map(target => factsObservedAt(factsRowFor(facts.model, target)));
  if (times.some(time => time === null)) return { data_status: "unavailable", age_seconds: null };
  const staleKnown = targets.some(target => factsRowFor(facts.model, target)?.data_status === "stale");
  return freshness(times, { now, ttlSeconds: FACTS_STALE_SECONDS, staleKnown });
}

function layerHasReadableField(readback, side) {
  if (Array.isArray(readback?.fields) && readback.fields.some(field => field?.[side]?.status === "known")) return true;
  // execution_mode is compared against the observed layer outside `fields`.
  const comparison = side === "saved" ? readback?.comparisons?.saved_vs_observed : readback?.comparisons?.platform_vs_observed;
  return Array.isArray(comparison?.compared_fields) && comparison.compared_fields.length > 0;
}

function brokerReadback9a(ownTargets, readbacks9a) {
  if (!readbacks9a || typeof readbacks9a !== "object") return undefined;
  const matched = ownTargets.map(t => readbacks9a[t.id]).filter(Boolean);
  if (!matched.length) return undefined;
  const targetHasDrift = (r) => r.overall === "drift"
    || r.comparisons?.saved_vs_platform?.status === "drift"
    || r.comparisons?.platform_vs_observed?.status === "drift"
    || r.comparisons?.saved_vs_observed?.status === "drift";
  const targetAllMatch = (r) => r.comparisons?.saved_vs_platform?.status === "match"
    && r.comparisons?.platform_vs_observed?.status === "match"
    && r.comparisons?.saved_vs_observed?.status === "match";
  const hasDrift = matched.some(targetHasDrift);
  const allMatch = !hasDrift && matched.length === ownTargets.length && matched.every(targetAllMatch);
  const observedTimes = matched.map(r => r.observed_deployment?.observed_at || r.read_at).filter(Boolean)
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  return {
    status: hasDrift ? "drift" : allMatch ? "match" : "unknown",
    // A layer envelope is always present, even when its source was unreadable;
    // only a field value actually read from that layer counts as evidence.
    layers_available: {
      saved_settings: matched.some(r => layerHasReadableField(r, "saved")),
      platform_configuration: matched.some(r => layerHasReadableField(r, "platform")),
      observed_deployment: matched.some(r => r.observed_deployment?.data_status === "ready"),
    },
    compared_target_count: matched.length,
    drift_target_count: matched.filter(targetHasDrift).length,
    observed_at: observedTimes[0] ?? null,
    actions: {
      reapply_saved: { status: "not_enabled", allowed: false, reason_code: "not_enabled" },
      adopt_platform: { status: "not_enabled", allowed: false, reason_code: "not_enabled" },
    },
  };
}

export function accountsProjection({ config, facts, credential, now, readbacks9a = null }) {
  if (!config.ok) return { brokers: unknown("read_failed", coverage("unavailable", 0, null, ["read_failed"])) };
  const targets = readbackTargets(config.value);
  const platforms = [...new Set(targets.map(target => target.platform))].sort();
  const brokers = platforms.map(platform => {
    const own = targets.filter(target => target.platform === platform);
    const label = platformLabel(platform);
    const readback9a = brokerReadback9a(own, readbacks9a);
    return {
      platform,
      label,
      targets: own.map(target => ({ target_id: target.id, account_ref: accountRef(platform, target.config, label).account_ref })),
      connectivity: notSupported(),
      connectivity_detail: null,
      heartbeat: notSupported(),
      data_freshness: brokerFreshness(own, facts, now),
      config: {
        state: "unknown",
        // No stored, identity-bound readback comparison exists on this read path.
        drift_count: unknown("not_supported", coverage("unavailable", 0, own.length, ["not_supported"])),
        checked_at: null,
      },
      credential: credentialFor(platform, credential),
      last_order: notSupported(),
      ...(readback9a !== undefined ? { readback_9a: readback9a } : {}),
    };
  });
  // The broker list itself is a configuration snapshot read now, not a runtime observation.
  const cover = brokers.length ? coverage("complete", brokers.length, brokers.length) : coverage("verified_empty", 0, 0);
  return { brokers: known(brokers, now, cover) };
}

/** Account options: the saved configuration, or a fixed failure marker. */
export async function readConfig(env, deps) {
  const config = await readOnce(() => deps.options(env));
  const ok = config.ok && config.value?.options && typeof config.value.options === "object" && !Array.isArray(config.value.options);
  return ok ? { ok: true, value: config.value } : { ok: false };
}

/**
 * Stored account-facts snapshots through the existing builder. The stored map is
 * read with the existing `account_facts_list` command only; a disabled read
 * model or any failure is a failed read, never an empty account list.
 */
export async function readFactsModel(env, deps, config, now) {
  if (!config.ok || !accountFactsReadModelEnabled(env)) return { ok: false };
  const read = await readOnce(async () => {
    const bindings = await deps.factsBindings(env);
    const storedByAccount = await deps.factsStored(env, config.value.options, bindings);
    if (!(storedByAccount instanceof Map)) throw new TypeError("invalid stored facts");
    // The shared management cohort; the production wiring supplies `deps.managementReadback`.
    const management = deps.managementReadback ? managementCohort(await deps.managementReadback(env)) : null;
    return { bindings, model: buildAccountFactsReadModel({ accountOptions: config.value.options, bindings, storedByAccount, now, management }) };
  });
  return read.ok && Array.isArray(read.value.model?.accounts) ? { ok: true, ...read.value } : { ok: false };
}

/** The stored credential-maintenance record (`credential_maintenance_read`). */
export async function readCredential(env, deps) {
  const record = await readOnce(() => deps.command(env, { action: "credential_maintenance_read" }));
  if (!record.ok) return { ok: false };
  try { return { ok: true, item: credentialItems(record.value)[0], raw: record.value }; }
  catch { return { ok: false }; }
}

export async function readAccountsSources(env, deps, now) {
  const config = await readConfig(env, deps);
  return { config, facts: await readFactsModel(env, deps, config, now), credential: await readCredential(env, deps) };
}

export async function deskAccountsResponse(request, env, deps) {
  return n1Route(request, env, deps, async (url, session) => {
    if ([...url.searchParams.keys()].length) throw new DeskError("invalid_query", 400);
    const now = deps.now();
    const sources = await readAccountsSources(env, deps, now);
    let readbacks9a = null;
    if (sources.config.ok && typeof deps.readbacks9a === "function") {
      const rb = await readOnce(() => deps.readbacks9a(request, env, session));
      readbacks9a = rb.ok && rb.value && typeof rb.value === "object" ? rb.value : null;
    }
    return n1Response("accounts", {
      time_basis: timeBasis("UTC", [["account_facts", "UTC"], ["account_options", "UTC"], ["credential_maintenance", "UTC"]]),
      ...accountsProjection({ ...sources, now, readbacks9a }),
    }, { now });
  });
}

/**
 * Additive C-SA-26 multi-platform credential calendar projection alongside N1 accounts.
 * Preserves legacy qsl.desk.accounts.v2 schema while surfacing versioned WATCH / 12A coverage.
 */
export function accountsCredentialCalendarProjection({ ibkrRecord = null, overrides = [], evaluatedAt } = {}) {
  const evalIso = evaluatedAt ?? new Date().toISOString();
  const byId = new Map((overrides || []).map((entry) => [entry.credential_id, entry]));
  const pickBase = (reg) => ({
    credential_id: reg.credential_id,
    platform: reg.platform,
    credential_type: reg.credential_type,
    account_slot: reg.account_slot,
    renewal_runbook_ref: reg.renewal_runbook_ref,
  });
  const defaults = [
    byId.get("cred_ibkr_flex_live_a1") || {
      ...pickBase(REGISTERED_CREDENTIALS.cred_ibkr_flex_live_a1),
      environment: "read_only",
      applicability: "applicable",
      expires_at: ibkrRecord?.expires_at ?? null,
      observed_at: ibkrRecord?.expires_at ? evalIso : null,
      evaluated_at: evalIso,
      evidence_source: ibkrRecord?.expires_at ? "operator_declared" : "unobserved",
      metadata_revision: ibkrRecord?.metadata_revision ?? 0,
    },
    byId.get("cred_longbridge_paper_pilot_90d") || {
      ...pickBase(REGISTERED_CREDENTIALS.cred_longbridge_paper_pilot_90d),
      environment: "paper",
      applicability: "applicable",
      expires_at: null,
      observed_at: null,
      evaluated_at: evalIso,
      evidence_source: "unobserved",
      typed_metadata: { token_ttl_days: 90 },
    },
    byId.get("cred_schwab_live_main") || {
      ...pickBase(REGISTERED_CREDENTIALS.cred_schwab_live_main),
      environment: "live",
      applicability: "applicable",
      expires_at: null,
      observed_at: null,
      evaluated_at: evalIso,
      evidence_source: "unobserved",
    },
    byId.get("cred_binance_live_dormant") || {
      ...pickBase(REGISTERED_CREDENTIALS.cred_binance_live_dormant),
      environment: "live",
      applicability: "not_applicable",
      suppression_reason: "platform_dormant_under_v2",
      expires_at: null,
      observed_at: evalIso,
      evaluated_at: evalIso,
      evidence_source: "operator_declared",
      typed_metadata: { dormant: true },
    },
    byId.get("cred_firstrade_live_main") || {
      ...pickBase(REGISTERED_CREDENTIALS.cred_firstrade_live_main),
      environment: "live",
      applicability: "unsupported",
      suppression_reason: "no_automated_credential_api",
      expires_at: null,
      observed_at: evalIso,
      evaluated_at: evalIso,
      evidence_source: "operator_declared",
      typed_metadata: { supports_auto_refresh: false },
    },
  ];
  return projectCredentialCalendar(defaults, { evaluated_at: evalIso });
}
