import {
  MANAGEMENT_EVIDENCE_TEXT,
  MANAGEMENT_STATUS_TEXT,
} from "../../../application/runtime_instances/account_management_text.js";
import type { ManagementEvidenceState, ManagementStatusCode } from "../api/contracts";
import type { Language } from "./prefs";

export { MANAGEMENT_EVIDENCE_TEXT, MANAGEMENT_STATUS_TEXT };

/** Map a management status to its single pinned bilingual copy source. */
export function managementStatusText(
  status: ManagementStatusCode | string | null | undefined,
  language: Language,
): string {
  const key = (status === "managed"
    || status === "management_disabled"
    || status === "not_under_management"
    || status === "unknown"
    ? status
    : "unknown") as keyof typeof MANAGEMENT_STATUS_TEXT;
  const entry = MANAGEMENT_STATUS_TEXT[key];
  return language === "zh" ? entry["zh-CN"] : entry.en;
}

/** Map non-known management evidence to its pinned qualifier suffix, or null when known. */
export function managementEvidenceText(
  evidence: ManagementEvidenceState | string | null | undefined,
  language: Language,
): string | null {
  if (evidence === "known") return null;
  const key = (evidence === "unknown" || evidence === "conflict" || evidence === "stale"
    ? evidence
    : "unknown") as keyof typeof MANAGEMENT_EVIDENCE_TEXT;
  const entry = MANAGEMENT_EVIDENCE_TEXT[key];
  return language === "zh" ? entry["zh-CN"] : entry.en;
}
