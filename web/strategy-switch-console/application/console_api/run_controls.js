/** Backend preflight for display only; existing POST handlers recheck every guard. */
export async function runControls(account, session, deps) {
  const blocked = reason => ({ enabled: false, reason, requires_confirmation: true });
  const available = () => ({ enabled: true, reason: "available", requires_confirmation: true });
  const actions = {
    enable: blocked("strategy_application_not_connected"),
    stop: blocked("dispatch_unavailable"),
    resume: blocked("existing_recovery_not_available"),
    approve_application: blocked("profile_draft_required"),
  };
  const result = { status: "ok", account_alias: account.key, platform: account.platform,
    as_of: new Date().toISOString(), actions, no_order: true, execution_authority_granted: false };
  if (!session.admin) {
    for (const name of Object.keys(actions)) actions[name] = blocked("admin_required");
    return result;
  }
  if (deps.dispatchAvailable) {
    if (["ibkr", "schwab"].includes(account.platform) && deps.platformControl) {
      try {
        const control = await deps.platformControl();
        result.runtime_control = control;
        if (["reserved", "accepted", "unknown", "partial"].includes(control.phase)) {
          actions.enable = blocked("runtime_control_pending");
          actions.stop = blocked("runtime_control_pending");
        } else {
          actions.enable = available();
          actions.stop = available();
        }
      } catch {
        actions.enable = blocked("runtime_readback_unavailable");
        actions.stop = blocked("runtime_readback_unavailable");
        result.status = "partial";
      }
    } else {
      try { actions.stop = await deps.stopReady() ? available() : blocked("stop_pending_or_identity_unavailable"); }
      catch { actions.stop = blocked("stored_records_unreadable"); result.status = "partial"; }
    }
    if (account.platform === "binance") {
      try {
        const target = await deps.resumeTarget();
        if (target) { actions.resume = available(); result.resume_binding = { runtime_target_sha256: target.runtime_target_sha256 }; }
      } catch { actions.resume = blocked("runtime_readback_unavailable"); result.status = "partial"; }
    }
  }
  try {
    const state = await deps.profileState();
    if (state.reason) actions.approve_application = blocked(state.reason);
    else if (state.ready) actions.approve_application = available();
  } catch { actions.approve_application = blocked("runtime_readback_unavailable"); result.status = "partial"; }
  return result;
}
