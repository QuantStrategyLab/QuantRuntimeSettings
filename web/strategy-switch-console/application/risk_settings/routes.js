import { catalogue, definitionSha256, preferenceLevels, requested, RiskError, safety } from "./domain.js";

// This version deliberately has no write adapter. The legacy preference is not
// evidence of a verified identity, applicable policy, budget or breaker state.
export const contractVersion = "web-risk-console.readonly.v1";
export function riskPath(path) {
  return path === "/api/risk-levels/catalog" || path.startsWith("/api/risk-settings/")
    || /^\/api\/accounts\/[^/]+\/[^/]+\/risk-settings(?:\/audit)?$/.test(path);
}
export const unavailableReasons = ["IDENTITY_VERIFICATION_UNBOUND", "APPLICABILITY_UNBOUND", "EFFECTIVE_POLICY_UNBOUND", "BUDGET_UNBOUND", "BREAKER_UNBOUND"];
export function readRiskSettings(context, serverTime) {
  return { contract_version: contractVersion, server_time: serverTime, ...safety,
    readonly: true, capabilities: { can_preview: false, can_confirm: false, can_cancel: false },
    applicability: { status: "UNKNOWN", reason_codes: unavailableReasons },
    legacy_preference: { value: context.preference ?? null, mapped_level: preferenceLevels[context.preference] ?? null,
      revision: context.revision ?? null, source: "LEGACY_PREFERENCE_DISPLAY_ONLY", definition_version: catalogue.definition_version },
    record: null, effective: null, effective_observed_at_utc: null,
    request: null, confirmation_state: "UNKNOWN", unavailable_reasons: unavailableReasons,
    audit: { event_status: "UNKNOWN", gaps_discovery: "partial", outstanding_gaps: [], events: [] },
  };
}
export async function riskSettingsResponse(request, env, deps) {
  const serverTime = new Date(deps.now ? deps.now() : Date.now()).toISOString();
  const reply = (payload, status = 200) => deps.json({ contract_version: contractVersion, server_time: serverTime, ...safety, ...payload }, status);
  try {
    const session = await deps.readSession(request, env);
    if (!session?.allowed) return reply({ ok: false, code: "LOGIN_REQUIRED" }, 401);
    const path = new URL(request.url).pathname;
    if (path === "/api/risk-levels/catalog") {
      if (request.method !== "GET") return reply({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
      return reply({ catalog: catalogue, definition_sha256: definitionSha256 });
    }
    const account = path.match(/^\/api\/accounts\/([a-z0-9_-]+)\/([a-zA-Z0-9_.-]+)\/risk-settings(\/audit)?$/);
    if (account) {
      if (request.method !== "GET") return reply({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
      if (account[3] && !session.admin) return reply({ ok: false, code: "PERMISSION_DENIED" }, 403);
      const context = await deps.command(env, { action: "risk_settings_read", platform: account[1], key: account[2] });
      // The adapter only SELECTs an existing exact account; it never initializes authority.
      const view = readRiskSettings(context, serverTime);
      return reply(account[3] ? { ...view.audit, readonly: true } : view);
    }
    if (!/^\/api\/risk-settings\/(?:preview|confirm|[a-zA-Z0-9_.-]+\/cancel)$/.test(path))
      return reply({ ok: false, code: "NOT_FOUND" }, 404);
    if (request.method !== "POST") return reply({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
    if (!session.admin) return reply({ ok: false, code: "PERMISSION_DENIED" }, 403);
    if (request.headers.get("Origin") !== new URL(request.url).origin) return reply({ ok: false, code: "ORIGIN_REQUIRED" }, 403);
    // Schema rejection is read-only. No confirmation credential is ever issued.
    if (path.endsWith("/preview")) {
      const text = await request.text();
      if (new TextEncoder().encode(text).length > 32768) return reply({ ok: false, code: "REQUEST_TOO_LARGE" }, 413);
      let raw;
      try { raw = JSON.parse(text); } catch { return reply({ ok: false, code: "INVALID_REQUEST" }, 400); }
      requested(raw);
    }
    // No business rejection/audit receipt is fabricated: this write service is
    // unavailable before processing. Its durable audit lifecycle remains blocked.
    return reply({ ok: false, code: "RISK_SETTINGS_WRITE_UNAVAILABLE", readonly: true,
      unavailable_reasons: unavailableReasons, processing_status: "NOT_STARTED" }, 503);
  } catch (error) {
    if (error instanceof RiskError) return reply({ ok: false, code: error.message,
      details: { ...(error.parameter ? { parameter: error.parameter } : {}), ...error.details } }, error.status);
    // Never echo dependency error messages or account material.
    const status = error.status === 404 ? 404 : 503;
    return reply({ ok: false, code: status === 404 ? "ACCOUNT_NOT_FOUND" : "RISK_SETTINGS_UNAVAILABLE" }, status);
  }
}
