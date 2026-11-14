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
import { credentialItems } from "./credentials.js";
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

/** Authenticated account reference: the full validated IBKR ID, otherwise the masked form. */
export function accountRef(platform, option, label) {
  const masked = maskedAccount(option, label);
  return { ...masked, account_ref: ibkrAccountId(platform, option?.account_selector) ?? masked.account_ref };
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

export function accountsProjection({ config, facts, credential, now }) {
  if (!config.ok) return { brokers: unknown("read_failed", coverage("unavailable", 0, null, ["read_failed"])) };
  const targets = readbackTargets(config.value);
  const platforms = [...new Set(targets.map(target => target.platform))].sort();
  const brokers = platforms.map(platform => {
    const own = targets.filter(target => target.platform === platform);
    const label = platformLabel(platform);
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
    return { bindings, model: buildAccountFactsReadModel({ accountOptions: config.value.options, bindings, storedByAccount, now }) };
  });
  return read.ok && Array.isArray(read.value.model?.accounts) ? { ok: true, ...read.value } : { ok: false };
}

/** The stored credential-maintenance record (`credential_maintenance_read`). */
export async function readCredential(env, deps) {
  const record = await readOnce(() => deps.command(env, { action: "credential_maintenance_read" }));
  if (!record.ok) return { ok: false };
  try { return { ok: true, item: credentialItems(record.value)[0] }; }
  catch { return { ok: false }; }
}

export async function readAccountsSources(env, deps, now) {
  const config = await readConfig(env, deps);
  return { config, facts: await readFactsModel(env, deps, config, now), credential: await readCredential(env, deps) };
}

export async function deskAccountsResponse(request, env, deps) {
  return n1Route(request, env, deps, async (url) => {
    if ([...url.searchParams.keys()].length) throw new DeskError("invalid_query", 400);
    const now = deps.now();
    const sources = await readAccountsSources(env, deps, now);
    return n1Response("accounts", {
      time_basis: timeBasis("UTC", [["account_facts", "UTC"], ["account_options", "UTC"], ["credential_maintenance", "UTC"]]),
      ...accountsProjection({ ...sources, now }),
    }, { now });
  });
}
