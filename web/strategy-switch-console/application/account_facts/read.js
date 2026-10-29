/**
 * Account-facts READ-ONLY HTTP use cases (GET facts / history).
 *
 * B10-a: thin application layer over account_facts.js projections.
 * No Durable Object ownership, no txn open, no sync/write routes.
 * Worker injects session/config/DO repository helpers so this module
 * does not import worker.js (avoids cycles) and wire stays identical.
 */

import {
  ACCOUNT_FACTS_HISTORY_MAX_DAYS,
  ACCOUNT_FACTS_SUPPORTED_PLATFORMS,
  FIRSTRADE_ACCOUNT_FACTS_PLATFORM,
  SCHWAB_ACCOUNT_FACTS_PLATFORM,
  accountFactsOptionMatchesBinding,
  accountFactsReadModelEnabled,
  buildAccountFactsHistoryReadModel,
  buildAccountFactsReadModel,
  projectAccountFactsHistoryCurrencies,
} from "../../account_facts.js";

export function accountFactsIdentityDates(from, to) {
  const valid = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!valid(from) || !valid(to)) return null;
  const distance = (Date.parse(to) - Date.parse(from)) / 86400000;
  return distance === 0 ? [from] : distance === 1 ? [from, to] : null;
}

// Rebuild the response rather than trusting a storage/error object's shape.
export function accountFactsIdentityRecords(records, dates) {
  return dates.map((date) => {
    const matches = Array.isArray(records) ? records.filter((row) => row?.observation_date === date) : [];
    const row = matches.length === 1 ? matches[0] : null;
    const time = row?.observed_finished_at;
    const bool = (value) => typeof value === "boolean" ? value : null;
    return {
      observation_date: date,
      observed_finished_at: typeof time === "string"
        && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(time)
        && accountFactsIdentityDates(time.slice(0, 10), time.slice(0, 10))
        && Number.isFinite(Date.parse(time)) ? time : null,
      target_id_matches: bool(row?.target_id_matches),
      source_binding_id_matches: bool(row?.source_binding_id_matches),
      account_scope_matches: bool(row?.account_scope_matches),
      record_revision: null,
      row_present: bool(row?.row_present),
      source_binding_id_trusted: row?.row_present === true ? bool(row?.source_binding_id_trusted) : null,
      stored_source_binding_sha256: null,
    };
  });
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {{
 *   json: Function,
 *   readSession: Function,
 *   hasConfigStore: Function,
 *   hasRuntimeInstanceStore: Function,
 *   loadAccountOptionsConfig: Function,
 *   loadAccountFactsBindings: Function,
 *   loadStoredAccountFactsMap: Function,
 *   runtimeInstanceCommand: Function,
 *   periodReturnCommand: Function,
 *   accountFactsErrorResponse: Function,
 * }} deps
 */
export async function accountFactsResponse(request, env, deps) {
  const {
    json,
    readSession,
    hasConfigStore,
    hasRuntimeInstanceStore,
    loadAccountOptionsConfig,
    loadAccountFactsBindings,
    loadStoredAccountFactsMap,
    runtimeInstanceCommand,
    periodReturnCommand,
    accountFactsErrorResponse,
  } = deps;
  if (!accountFactsReadModelEnabled(env)) {
    return json({ ok: false, error: "account_facts_disabled" }, 404);
  }
  const session = await readSession(request, env);
  if (!session?.allowed) return json({ ok: false, error: "login required" }, 401);
  if (!hasConfigStore(env)) return json({ ok: false, error: "account facts KV is not configured" }, 503);
  if (!hasRuntimeInstanceStore(env)) return json({ ok: false, error: "account_facts_store_unavailable" }, 503);
  let accountConfig;
  try {
    accountConfig = await loadAccountOptionsConfig(env);
  } catch {
    return json({ ok: false, error: "account_options_unreadable" }, 503);
  }
  let bindings = null;
  try {
    bindings = await loadAccountFactsBindings(env);
  } catch {
    return json({ ok: false, error: "account_facts_bindings_unreadable" }, 503);
  }
  let storedByAccount;
  try {
    storedByAccount = await loadStoredAccountFactsMap(env, accountConfig.options || {}, bindings);
  } catch (error) {
    return accountFactsErrorResponse(error);
  }
  const model = buildAccountFactsReadModel({
    accountOptions: accountConfig.options || {},
    bindings,
    storedByAccount,
    now: Date.now(),
  });
  let declarations = null;
  try {
    const result = await runtimeInstanceCommand(env, { action: "account_declarations_read", actor: session.login });
    if (Array.isArray(result.declarations)) declarations = result.declarations;
  } catch { /* Account facts remain available if declarations cannot be read. */ }
  for (const account of model.accounts) {
    const matching = declarations?.filter(item => item.platform === account.platform && item.key === account.account_key) || [];
    if (matching.length === 1) {
      const { binding_environment, environment, account_type, source, status } = matching[0];
      if (binding_environment === "live" || binding_environment === "paper") account.binding_environment = binding_environment;
      if (status === "current") account.user_declaration = { environment, account_type, source };
    }
  }
  for (const account of model.accounts) {
    if (account.platform !== "ibkr") continue;
    const binding = bindings?.bindings?.find(
      (item) => item.platform === "ibkr" && item.account_key === account.account_key,
    );
    const option = (accountConfig.options?.ibkr || []).find((item) => item.key === account.account_key);
    if (!binding || !accountFactsOptionMatchesBinding(option, binding)) continue;
    try {
      const result = await runtimeInstanceCommand(env, periodReturnCommand(binding, "account_period_return_read"));
      account.return = result.return;
    } catch { /* A failed period read must not hide current balances. */ }
  }
  return json({
    ...model,
    account_options_revision: accountConfig.revision ?? null,
    enabled: true,
    configured: Boolean(bindings?.bindings?.length),
  });
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {URL} url
 * @param {{
 *   json: Function,
 *   readSession: Function,
 *   hasConfigStore: Function,
 *   hasRuntimeInstanceStore: Function,
 *   loadAccountOptionsConfig: Function,
 *   loadAccountFactsBindings: Function,
 *   runtimeInstanceCommand: Function,
 *   accountFactsErrorResponse: Function,
 * }} deps
 */
export async function accountFactsHistoryResponse(request, env, url, deps) {
  const {
    json,
    readSession,
    hasConfigStore,
    hasRuntimeInstanceStore,
    loadAccountOptionsConfig,
    loadAccountFactsBindings,
    runtimeInstanceCommand,
    accountFactsErrorResponse,
  } = deps;
  if (!accountFactsReadModelEnabled(env)) {
    return json({ ok: false, error: "account_facts_disabled" }, 404);
  }
  const session = await readSession(request, env);
  if (!session?.allowed) return json({ ok: false, error: "login required" }, 401);
  if (!hasConfigStore(env)) return json({ ok: false, error: "account facts KV is not configured" }, 503);
  if (!hasRuntimeInstanceStore(env)) return json({ ok: false, error: "account_facts_store_unavailable" }, 503);
  const platform = String(url.searchParams.get("platform") || "");
  const accountKey = String(url.searchParams.get("account_key") || "");
  const currency = String(url.searchParams.get("currency") || "");
  const projection = url.searchParams.get("projection");
  const currenciesProjection = projection === "currencies";
  const includeCurrencies = url.searchParams.get("include_currencies") === "true";
  if (url.searchParams.has("include_currencies") && (!includeCurrencies || projection !== null
      || ["platform", "account_key", "currency", "include_currencies"].some(key => url.searchParams.getAll(key).length !== 1))) {
    return json({ ok: false, error: "invalid_account_facts_history_query" }, 400);
  }
  const requireCurrencies = currenciesProjection || includeCurrencies;
  const dates = projection === "identity"
    ? accountFactsIdentityDates(url.searchParams.get("from"), url.searchParams.get("to")) : null;
  if (currenciesProjection && (["platform", "account_key", "projection"].some((key) => url.searchParams.getAll(key).length !== 1)
      || ["currency", "from", "to"].some((key) => url.searchParams.has(key)))) {
    return json({ ok: false, error: "invalid_account_facts_history_query" }, 400);
  }
  if (projection !== null && !currenciesProjection && (projection !== "identity" || !ACCOUNT_FACTS_SUPPORTED_PLATFORMS.includes(platform) || !dates
      || ["platform", "account_key", "currency", "projection", "from", "to"].some((key) => url.searchParams.getAll(key).length !== 1))) {
    return json({ ok: false, error: "invalid_account_facts_identity_query" }, 400);
  }
  if (!ACCOUNT_FACTS_SUPPORTED_PLATFORMS.includes(platform) || !accountKey || (!currenciesProjection && !/^[A-Z]{3}$/.test(currency))) {
    return json({ ok: false, error: "invalid_account_facts_history_query" }, 400);
  }
  let accountConfig;
  try {
    accountConfig = await loadAccountOptionsConfig(env);
  } catch {
    if (requireCurrencies) return json({ ok: false, error: "account_facts_history_unavailable" }, 503);
    accountConfig = { options: {} };
  }
  const options = Array.isArray(accountConfig?.options?.[platform]) ? accountConfig.options[platform] : [];
  const matches = options.filter((item) => item?.key === accountKey);
  const option = matches.length === 1 ? matches[0] : null;
  let bindings = null;
  try {
    bindings = await loadAccountFactsBindings(env);
  } catch {
    if (requireCurrencies) return json({ ok: false, error: "account_facts_history_unavailable" }, 503);
    bindings = null;
  }
  const binding = bindings?.bindings?.find(
    (item) => item.platform === platform && item.account_key === accountKey,
  ) || null;
  if (requireCurrencies && (!option || !binding || !accountFactsOptionMatchesBinding(option, binding)
      || bindings.bindings.filter((item) => item.platform === platform && item.account_key === accountKey).length !== 1)) {
    return json({ ok: false, error: "account_facts_identity_unavailable" }, 409);
  }
  if (projection === "identity") {
    if (!option || !binding || !accountFactsOptionMatchesBinding(option, binding)
        || bindings.bindings.filter((item) => item.platform === platform && item.account_key === accountKey).length !== 1) {
      return json({ ok: false, error: "account_facts_identity_unavailable" }, 409);
    }
    try {
      const result = await runtimeInstanceCommand(env, {
        action: "account_facts_history_read", projection: "identity",
        platform, account_key: accountKey, account_scope: binding.account_scope,
        account_selector: binding.account_selector,
        ...(platform === SCHWAB_ACCOUNT_FACTS_PLATFORM ? { broker_account_hash: binding.broker_account_hash } : {}),
        ...(platform === FIRSTRADE_ACCOUNT_FACTS_PLATFORM ? { broker_account_id: binding.broker_account_id } : {}),
        ...(binding.history_source_binding_ids ? { history_source_binding_ids: binding.history_source_binding_ids } : {}),
        target_id: binding.target_id, source_binding_id: binding.source_binding.id,
        from: dates[0], to: dates.at(-1),
      });
      const records = accountFactsIdentityRecords(result?.records, dates);
      for (const record of records) {
        const matches = Array.isArray(result?.records)
          ? result.records.filter(row => row?.observation_date === record.observation_date) : [];
        const source = matches.length === 1 ? matches[0].stored_source_binding_id : null;
        // The raw stored id is private metadata. Never spread storage records
        // into HTTP or accept a precomputed hash supplied by storage/errors.
        if (record.row_present === true && typeof source === "string" && /^[a-f0-9]{64}$/.test(source)) {
          record.stored_source_binding_sha256 = await deps.sha256Hex(source);
        }
      }
      return json({ ok: true, projection: "identity", target_id: binding.target_id,
        source_binding_id: binding.source_binding.id,
        records });
    } catch {
      return json({ ok: false, error: "account_facts_identity_unavailable" }, 503);
    }
  }
  let days = [];
  let externalFlow = null;
  if (option && binding && accountFactsOptionMatchesBinding(option, binding)) {
    try {
      const listed = await runtimeInstanceCommand(env, {
        action: "account_facts_history_read",
        platform,
        account_key: accountKey,
        account_scope: binding.account_scope,
        account_selector: binding.account_selector,
        ...(platform === SCHWAB_ACCOUNT_FACTS_PLATFORM
          ? { broker_account_hash: binding.broker_account_hash }
          : {}),
        ...(platform === FIRSTRADE_ACCOUNT_FACTS_PLATFORM
          ? { broker_account_id: binding.broker_account_id }
          : {}),
        target_id: binding.target_id,
        source_binding_id: binding.source_binding.id,
        ...(binding.history_source_binding_ids
          ? { history_source_binding_ids: binding.history_source_binding_ids } : {}),
      });
      if (requireCurrencies && (!listed || listed.ok !== true || !Array.isArray(listed.days))) {
        return json({ ok: false, error: "account_facts_history_unavailable" }, 503);
      }
      days = Array.isArray(listed?.days) ? listed.days : [];
      externalFlow = listed?.externalFlow || null;
    } catch (error) {
      return accountFactsErrorResponse(error);
    }
  }
  if (currenciesProjection) {
    return json({ ok: true, platform, account_key: accountKey, projection: "currencies",
      currencies: projectAccountFactsHistoryCurrencies({ days, binding }) });
  }
  const model = buildAccountFactsHistoryReadModel({
    platform,
    accountKey,
    currency,
    option,
    binding,
    days,
    maxDays: ACCOUNT_FACTS_HISTORY_MAX_DAYS,
    includeCurrencies,
  });
  return json({
    ...model,
    enabled: true,
    retention_days: ACCOUNT_FACTS_HISTORY_MAX_DAYS,
    ...(externalFlow ? { externalFlow } : {}),
  });
}
