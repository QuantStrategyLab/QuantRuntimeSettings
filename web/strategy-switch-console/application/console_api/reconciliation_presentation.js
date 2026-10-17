// Display metadata only. These projections never grant confirmation eligibility.
export function recoveryMaterialPresentation({ source, recovery, confirmation, rejection, decisionError }) {
  const decisionStatus = decisionError ? "unknown"
    : confirmation ? "approved" : rejection ? "rejected" : "undecided";
  const historical = decisionStatus === "approved" || decisionStatus === "rejected";
  return {
    material_kind: historical ? "historical_recovery_approval_material" : "recovery_approval_material",
    label: historical
      ? { zh: "历史恢复审批材料", en: "Historical recovery approval material" }
      : { zh: "恢复审批材料", en: "Recovery approval material" },
    decision_status: decisionStatus,
    strategy_profile: recovery.strategy_profile,
    decision_status_label: {
      approved: { zh: "已确认", en: "Approved" },
      rejected: { zh: "已拒绝", en: "Rejected" },
      undecided: { zh: "未决定", en: "Undecided" },
      unknown: { zh: "决定状态未知", en: "Decision status unknown" },
    }[decisionStatus],
    source_generated_at: source.generated_at,
    source_computed_at: source.computed_at,
    last_observed_at: recovery.last_observed_at,
  };
}

// Accept only an independently validated observation read model, never recovery
// material. Production has no such source wired in; its default stays unknown.
export function currentReconciliationObservationPresentation(observation = null) {
  const connected = observation !== null;
  const comparison = observation?.data_status === "ready" && observation.observations?.length === 1
    ? observation.observations[0].comparison_status : "unknown";
  const labels = {
    matched: { zh: "一致", en: "Matched" },
    mismatched: { zh: "不一致", en: "Mismatched" },
    incomparable: { zh: "无法比较", en: "Incomparable" },
    unknown: { zh: "未知", en: "Unknown" },
  };
  return {
    label: { zh: "当前对账观察", en: "Current reconciliation observation" },
    connection_status: connected ? "connected" : "not_connected",
    data_status: observation?.data_status || "unknown",
    comparison_status: labels[comparison] ? comparison : "unknown",
    status_label: connected ? labels[comparison] || labels.unknown
      : { zh: "未接入 / 未知", en: "Not connected / unknown" },
    generated_at: observation?.generated_at || null,
    computed_at: observation?.computed_at || null,
    last_observed_at: observation?.observations?.[0]?.last_observed_at || null,
  };
}
