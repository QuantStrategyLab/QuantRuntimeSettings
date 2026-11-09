// §3.20 credentials read model.
//
// This is a projection, not a new source of truth: the expiry record already
// lives in the RuntimeInstance SQLite database and is served to the console by
// credentialMaintenanceCommand(). Nothing here reads a broker, and nothing here
// upgrades operator-supplied metadata into a validated credential: `source`
// stays "operator_provided" because that is what the record actually is.
//
// The desk vocabulary is the contract vocabulary, which is coarser than the
// maintenance one: schemas/desk/common.json#/$defs/Phase has no 14, and the desk
// UI already folds it (frontend/src/desk/credentials/model.ts
// normalizeCredentialPhase: "14" -> "30"). Mirror that rule here so the two
// layers cannot disagree, and report anything outside both as unknown rather
// than coercing it into a neighbouring bucket.
import { DeskError, deskResponse, deskErrorResponse } from "./http.js";

const PLATFORM = "ibkr";
const LABEL = "IBKR Flex";
const KIND = "flex_token";
const LIMIT_DAYS = 30;
// The console already exposes rotation for this credential; point at the page
// that owns it instead of inventing a new route.
const ROTATION_ROUTE = "/?page=health#credential-rotation";
const PHASES = new Set(["unknown", "not_due", "30", "7", "1", "expired"]);
const DUE = new Set(["30", "7", "1", "expired"]);

export function credentialPhase(value) {
  if (value === "14") return "30";
  return typeof value === "string" && PHASES.has(value) ? value : "unknown";
}

/** An expiry we cannot read is `unknown`, never `none`: absence is not a fact. */
export function credentialExpiry(record) {
  const raw = typeof record.expires_at === "string" ? record.expires_at : null;
  const at = raw === null ? NaN : Date.parse(raw);
  if (!Number.isFinite(at)) return { status: "unknown", reason: "never_read" };
  return { status: "known", at: new Date(at).toISOString(), source: "operator_provided" };
}

export function credentialItems(record) {
  if (!record || typeof record !== "object" || Array.isArray(record) || typeof record.id !== "string" || !record.id) {
    throw new DeskError("read_failed", 502);
  }
  const phase = credentialPhase(record.phase);
  return [{
    id: record.id,
    platform: PLATFORM,
    label: LABEL,
    kind: KIND,
    expiry: credentialExpiry(record),
    limit_days: LIMIT_DAYS,
    phase,
    // §3.20: action follows the phase vocabulary; unknown is not proven due.
    requires_action: DUE.has(phase),
    rotation: { supported: true, route: ROTATION_ROUTE },
    runbook: null,
    last_rotated_at: null,
  }];
}

export async function deskCredentialsResponse(request, env, deps) {
  try {
    if (request.method !== "GET") throw new DeskError("not_found", 404);
    await deps.auth(request, env);
    let record;
    try { record = await deps.command(env, { action: "credential_maintenance_read" }); }
    catch { throw new DeskError("read_failed", 502); }
    return deskResponse("credentials", { items: credentialItems(record) });
  } catch (error) { return deskErrorResponse(error); }
}
