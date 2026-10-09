/**
 * Generic account status layer (Desired / Observed presentation).
 * Pages must present activation/health through these helpers — no third calm state.
 */

export type EvidenceStatus = "fresh" | "stale" | "missing" | "conflict";

export type Evidence<T> = {
  value: T | null;
  status: EvidenceStatus;
  observedAt: string | null;
  source: string;
  detail: string;
};

export type AccountStatus = {
  activation: Evidence<"enabled" | "disabled">;
  health: Evidence<"healthy" | "abnormal">;
  identity: Evidence<"live" | "paper" | "unverified">;
};

export type ActivationPill = "已启用" | "已停用" | "异常" | "启用待确认";
export type HealthPill = "健康" | "异常";
export type StatusTone = "ok" | "bad";

export type PresentedActivation = {
  label: ActivationPill;
  tone: StatusTone;
  detail: string;
};

export type PresentedHealth = {
  label: HealthPill;
  tone: StatusTone;
  detail: string;
};

export function evidenceMissing<T>(source: string, detail: string): Evidence<T> {
  return { value: null, status: "missing", observedAt: null, source, detail };
}

export function evidenceFresh<T>(
  value: T,
  source: string,
  detail: string,
  observedAt: string | null = null,
): Evidence<T> {
  return { value, status: "fresh", observedAt, source, detail };
}

export function evidenceConflict<T>(source: string, detail: string, observedAt: string | null = null): Evidence<T> {
  return { value: null, status: "conflict", observedAt, source, detail };
}

export function evidenceStale<T>(source: string, detail: string, observedAt: string | null = null): Evidence<T> {
  return { value: null, status: "stale", observedAt, source, detail };
}

/** Activation pills: only 已启用 | 已停用 | 异常. Missing/stale/conflict → 异常. */
export function presentActivation(evidence: Evidence<"enabled" | "disabled">): PresentedActivation {
  if (evidence.status === "fresh" && evidence.value === "enabled") {
    return { label: "已启用", tone: "ok", detail: evidence.detail || "运行读回为已启用" };
  }
  if (evidence.status === "fresh" && evidence.value === "disabled") {
    return { label: "已停用", tone: "bad", detail: evidence.detail || "运行读回为已停用" };
  }
  if (evidence.status === "conflict") {
    return { label: "异常", tone: "bad", detail: evidence.detail || "启用状态冲突" };
  }
  if (evidence.status === "stale") {
    return { label: "异常", tone: "bad", detail: evidence.detail || "启用证据已过期" };
  }
  return { label: "异常", tone: "bad", detail: evidence.detail || "启用证据未取得" };
}

/**
 * Health pills: only 健康 | 异常.
 * Waiting-for-cycle folds into healthy at the reducer; this helper never invents a third pill.
 */
export function presentHealth(evidence: Evidence<"healthy" | "abnormal">): PresentedHealth {
  if (evidence.status === "fresh" && evidence.value === "healthy") {
    return { label: "健康", tone: "ok", detail: evidence.detail || "监测一致" };
  }
  if (evidence.status === "fresh" && evidence.value === "abnormal") {
    return { label: "异常", tone: "bad", detail: evidence.detail || "监测异常" };
  }
  if (evidence.status === "conflict") {
    return { label: "异常", tone: "bad", detail: evidence.detail || "健康状态冲突" };
  }
  if (evidence.status === "stale") {
    return { label: "异常", tone: "bad", detail: evidence.detail || "健康证据已过期" };
  }
  return { label: "异常", tone: "bad", detail: evidence.detail || "健康证据未取得" };
}

/**
 * Map legacy overview activation strings into Evidence, then present.
 * Preferred path once health-and-cadence lands: build Evidence at the App boundary instead.
 */
export function activationEvidenceFromLegacyLabel(
  label: string | null | undefined,
): Evidence<"enabled" | "disabled"> {
  if (label === "已启用") return evidenceFresh("enabled", "legacy-activation", "运行读回为已启用");
  if (label === "已停用") return evidenceFresh("disabled", "legacy-activation", "运行读回为已停用");
  if (label === "启用未知" || label === "待确认" || label === "—" || !label) {
    return evidenceMissing("legacy-activation", "启用证据未取得");
  }
  return evidenceConflict("legacy-activation", "启用状态冲突");
}

export function healthEvidenceFromLegacyLabel(
  label: string | null | undefined,
  detail = "",
): Evidence<"healthy" | "abnormal"> {
  if (label === "健康" || label === "等待周期") {
    return evidenceFresh("healthy", "legacy-health", detail || (label === "等待周期" ? "等待周期" : "监测一致"));
  }
  if (label === "异常") {
    return evidenceFresh("abnormal", "legacy-health", detail || "监测异常");
  }
  return evidenceMissing("legacy-health", detail || "健康证据未取得");
}
