// Semantic catalog release gate. Labels, colors, and generator-only edits
// do not count; only the fields synced into the private strategy catalog do.

export const CATALOG_SYNC_FIELDS = [
  "profile",
  "runtime_enabled",
  "lifecycle_stage",
  "can_switch_live",
  "allowed_execution_modes",
  "blocked_live_reason",
];

export function readCatalogAsset(source) {
  const start = String(source).indexOf("[");
  const end = String(source).lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("catalog asset has no JSON array");
  const parsed = JSON.parse(String(source).slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error("catalog asset must be an array");
  return parsed;
}

export function catalogSyncProjection(profiles) {
  if (!Array.isArray(profiles)) throw new Error("catalog must be an array");
  return profiles.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("catalog entry must be an object");
    }
    const projected = {};
    for (const field of CATALOG_SYNC_FIELDS) {
      projected[field] = item[field] === undefined ? null : item[field];
    }
    projected.lifecycle_stage = projected.lifecycle_stage || "";
    projected.allowed_execution_modes = projected.allowed_execution_modes || [];
    projected.blocked_live_reason = projected.blocked_live_reason || "";
    if (typeof projected.profile !== "string" || !projected.profile) {
      throw new Error("catalog profile is required");
    }
    return projected;
  }).sort((left, right) => left.profile.localeCompare(right.profile));
}

export function catalogReleaseDecision({ baseline, built, baselineAvailable }) {
  if (baselineAvailable !== true) {
    return { ok: false, changed: false, reason: "baseline_unavailable" };
  }
  try {
    const changed = JSON.stringify(catalogSyncProjection(baseline))
      !== JSON.stringify(catalogSyncProjection(built));
    return { ok: true, changed, reason: changed ? "catalog_changed" : "catalog_unchanged" };
  } catch {
    return { ok: false, changed: false, reason: "comparison_failed" };
  }
}
