/**
 * Account-facts WRITE/sync HTTP use case (POST /api/account-facts/sync).
 *
 * B10-b: application layer over account_facts.js normalization + DO put via
 * injected runtimeInstanceCommand. This module does not open DO transactions,
 * own DO identity, or import worker.js. Revision/history sync stays inside
 * the DO account_facts_put command (unchanged).
 */

import {
  ACCOUNT_FACTS_MAX_BODY_BYTES,
  ACCOUNT_FACTS_RETURN_UNAVAILABLE,
  FIRSTRADE_ACCOUNT_FACTS_PLATFORM,
  IBKR_ACCOUNT_FACTS_PLATFORM,
  SCHWAB_ACCOUNT_FACTS_PLATFORM,
  accountFactsOptionMatchesBinding,
  accountFactsPlatformForHistory,
  accountFactsReadModelEnabled,
  accountFactsScopesMatchForPlatform,
  normalizeAccountFactsHistoryPayload,
  resolveTrustedAccountFactsBinding,
} from "../../account_facts.js";

/**
 * @param {Request} request
 * @param {any} env
 * @param {{
 *   json: Function,
 *   hasConfigStore: Function,
 *   hasRuntimeInstanceStore: Function,
 *   loadAccountOptionsConfig: Function,
 *   loadAccountFactsBindings: Function,
 *   runtimeInstanceCommand: Function,
 *   readBoundedJson: Function,
 *   requireDedicatedAccountFactsSyncToken: Function,
 *   accountFactsErrorResponse: Function,
 * }} deps
 */
export async function syncAccountFactsResponse(request, env, deps) {
  const {
    json,
    hasConfigStore,
    hasRuntimeInstanceStore,
    loadAccountOptionsConfig,
    loadAccountFactsBindings,
    runtimeInstanceCommand,
    readBoundedJson,
    requireDedicatedAccountFactsSyncToken,
    accountFactsErrorResponse,
  } = deps;
  if (!accountFactsReadModelEnabled(env)) {
    return json({ ok: false, error: "account_facts_disabled" }, 404);
  }
  let authorizedPlatform;
  try {
    authorizedPlatform = requireDedicatedAccountFactsSyncToken(request, env);
  } catch (error) {
    return accountFactsErrorResponse(error);
  }
  if (!hasConfigStore(env)) return json({ ok: false, error: "account facts KV is not configured" }, 503);
  if (!hasRuntimeInstanceStore(env)) return json({ ok: false, error: "account_facts_store_unavailable" }, 503);
  let bindings;
  try {
    bindings = await loadAccountFactsBindings(env);
  } catch (error) {
    return accountFactsErrorResponse(error);
  }
  if (!bindings || !bindings.bindings.length) {
    return json({ ok: false, error: "account_facts_bindings_missing" }, 409);
  }
  let raw;
  try {
    raw = await readBoundedJson(request, ACCOUNT_FACTS_MAX_BODY_BYTES);
  } catch (error) {
    return accountFactsErrorResponse(error);
  }
  // Callers must not declare console identity. Resolve the trusted account only
  // from server-side bindings matched to payload target_id + source_binding.id.
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    if ("account_key" in raw || "platform" in raw || "console_account" in raw || "identity_status" in raw) {
      return json({ ok: false, error: "account_facts_caller_identity_forbidden" }, 400);
    }
  }
  let payloadPlatform;
  try {
    payloadPlatform = accountFactsPlatformForHistory(raw);
  } catch (error) {
    return accountFactsErrorResponse(error);
  }
  if (payloadPlatform !== authorizedPlatform) {
    return json({ ok: false, error: "account_facts_sync_token_platform_mismatch" }, 403);
  }
  let history;
  try {
    history = normalizeAccountFactsHistoryPayload(raw, { expectedPlatform: authorizedPlatform });
  } catch (error) {
    return accountFactsErrorResponse(error);
  }
  const resolved = resolveTrustedAccountFactsBinding(
    bindings,
    history.target_id,
    history.source_binding.id,
  );
  if (!resolved.ok) return json({ ok: false, error: resolved.reason }, 409);
  if (resolved.binding.platform !== authorizedPlatform) {
    return json({ ok: false, error: "account_facts_identity_mismatch" }, 409);
  }
  if (!accountFactsScopesMatchForPlatform(authorizedPlatform, resolved.binding.account_scope, history.account_scope)) {
    return json({ ok: false, error: "account_facts_identity_mismatch" }, 409);
  }
  let accountConfig;
  try {
    accountConfig = await loadAccountOptionsConfig(env);
  } catch {
    return json({ ok: false, error: "account_facts_account_unattributed" }, 409);
  }
  const options = Array.isArray(accountConfig?.options?.[resolved.binding.platform])
    ? accountConfig.options[resolved.binding.platform]
    : [];
  const matches = options.filter((item) => item?.key === resolved.binding.account_key);
  if (matches.length !== 1) {
    return json({ ok: false, error: "account_facts_account_unattributed" }, 409);
  }
  if (!accountFactsOptionMatchesBinding(matches[0], resolved.binding)) {
    return json({ ok: false, error: "account_facts_identity_mismatch" }, 409);
  }
  try {
    history = normalizeAccountFactsHistoryPayload(raw, {
      expectedPlatform: authorizedPlatform,
      expectedTargetId: resolved.binding.target_id,
      expectedBindingId: resolved.binding.source_binding.id,
      expectedOptionScope: resolved.binding.account_scope,
      expectedAccountSelector: authorizedPlatform === IBKR_ACCOUNT_FACTS_PLATFORM
        ? resolved.binding.account_selector
        : null,
      expectedBrokerAccountId: authorizedPlatform === FIRSTRADE_ACCOUNT_FACTS_PLATFORM
        ? resolved.binding.broker_account_id
        : null,
      expectedBrokerAccountHash: authorizedPlatform === SCHWAB_ACCOUNT_FACTS_PLATFORM
        ? resolved.binding.broker_account_hash
        : null,
    });
  } catch (error) {
    return accountFactsErrorResponse(error);
  }
  let stored;
  try {
    stored = await runtimeInstanceCommand(env, {
      action: "account_facts_put",
      platform: resolved.binding.platform,
      account_key: resolved.binding.account_key,
      account_scope: resolved.binding.account_scope,
      account_selector: resolved.binding.account_selector,
      ...(authorizedPlatform === FIRSTRADE_ACCOUNT_FACTS_PLATFORM
        ? { broker_account_id: resolved.binding.broker_account_id }
        : {}),
      ...(authorizedPlatform === SCHWAB_ACCOUNT_FACTS_PLATFORM
        ? { broker_account_hash: resolved.binding.broker_account_hash }
        : {}),
      target_id: resolved.binding.target_id,
      source_binding_id: resolved.binding.source_binding.id,
      history,
    });
  } catch (error) {
    return accountFactsErrorResponse(error);
  }
  return json({
    ok: true,
    stored: true,
    unchanged: Boolean(stored.unchanged),
    platform: resolved.binding.platform,
    account_key: resolved.binding.account_key,
    target_id: history.target_id,
    observation_date: history.observation_date,
    observed_finished_at: history.observed_finished_at,
    return: { ...ACCOUNT_FACTS_RETURN_UNAVAILABLE },
  });
}
