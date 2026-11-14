// §3.6 step 1: the switch target list.
//
// This is a projection of the *configured* account options, not an observation
// of the running brokers. The console has no desk read that reports a target's
// live mode or its currently deployed strategy, so both are reported as
// `unknown / never_read`. Presenting `default_execution_mode` or
// `default_strategy_profile` as a current value would be a guess.
//
// Everything that is known here is configuration: the platform, the target id,
// the declared domains, the declared default execution mode and the account
// reference (the validated IBKR ID, otherwise a masked suffix). Switching is
// not connected in this console build, so every row carries
// `switchable: { allowed: false, reason_code: switch_not_connected }`.
import { DeskError, deskResponse, deskErrorResponse } from "./http.js";
import { unknown } from "./read.js";
import { readbackTargets } from "./readback.js";
import { accountRef, platformLabel } from "./accounts.js";

const MODES = new Set(["dry_run", "paper", "live"]);

export function switchTargetsFromConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)
      || !config.options || typeof config.options !== "object" || Array.isArray(config.options)) {
    throw new DeskError("read_failed", 502);
  }
  return readbackTargets(config).map((item) => {
    const option = item.config || {};
    const label = platformLabel(item.platform);
    const defaultMode = typeof option.default_execution_mode === "string" ? option.default_execution_mode : "";
    return {
      target_id: item.id,
      platform: item.platform,
      platform_label: label,
      ...accountRef(item.platform, option, label),
      // No runtime read has landed for these two; absence is not a value.
      mode: unknown("never_read"),
      current_strategy: unknown("never_read"),
      domains: Array.isArray(option.supported_domains)
        ? option.supported_domains.filter((domain) => typeof domain === "string") : [],
      execution_modes: MODES.has(defaultMode) ? [defaultMode] : [],
      switchable: { allowed: false, reason_code: "switch_not_connected" },
      pending_request_id: null,
      // Stop/resume are write capabilities. Declaring them from configuration
      // would be an unproven claim; the desk read model has no evidence yet.
      stop: { supported: false, resume_supported: false },
    };
  });
}

export async function deskSwitchTargetsResponse(request, env, deps) {
  try {
    if (request.method !== "GET") throw new DeskError("not_found", 404);
    await deps.auth(request, env);
    let config;
    try { config = await deps.options(env); }
    catch { throw new DeskError("read_failed", 502); }
    return deskResponse("switch_targets", { targets: switchTargetsFromConfig(config) });
  } catch (error) { return deskErrorResponse(error); }
}
