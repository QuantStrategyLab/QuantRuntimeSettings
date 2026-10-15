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
    try { actions.stop = await deps.stopReady() ? available() : blocked("stop_pending_or_identity_unavailable"); }
    catch { actions.stop = blocked("stored_records_unreadable"); result.status = "partial"; }
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
