// Operator-supplied expiry metadata only. This does not attest broker validity.
export class CredentialMaintenanceError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const ID = "ibkr_flex";
const DUE = new Set(["30", "7", "1", "expired"]);

export function normalizeExpiryInstant(value) {
  if (value === null) return null;
  if (typeof value !== "string") throw new CredentialMaintenanceError("invalid_credential_expiry");
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/);
  if (!m) throw new CredentialMaintenanceError("invalid_credential_expiry");
  const [, y, mo, d, h, mi, s, , zone] = m;
  const year = Number(y), month = Number(mo), day = Number(d);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (year < 1970 || month < 1 || month > 12 || day < 1 || day > days || Number(h) > 23 || Number(mi) > 59 || Number(s) > 59 ||
      (zone !== "Z" && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59))) {
    throw new CredentialMaintenanceError("invalid_credential_expiry");
  }
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) throw new CredentialMaintenanceError("invalid_credential_expiry");
  return new Date(instant).toISOString();
}

export function credentialPhase(value, now = Date.now()) {
  let expiry;
  try { expiry = normalizeExpiryInstant(value); } catch { return "unknown"; }
  if (expiry === null) return "unknown";
  const days = (Date.parse(expiry) - now) / 86400000;
  return days <= 0 ? "expired" : days <= 1 ? "1" : days <= 7 ? "7" : days <= 30 ? "30" : "not_due";
}

export function initializeCredentialMaintenance(sql) {
  sql.exec("CREATE TABLE IF NOT EXISTS credential_maintenance_metadata (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, expires_at TEXT)");
  sql.exec("CREATE TABLE IF NOT EXISTS credential_maintenance_delivery (delivery_key TEXT PRIMARY KEY, claim_id TEXT NOT NULL UNIQUE, metadata_revision INTEGER NOT NULL, state TEXT NOT NULL)");
}
const key = (p) => JSON.stringify([ID, p.expires_at, p.phase]);
function projection(sql) {
  const row = sql.exec("SELECT revision, expires_at FROM credential_maintenance_metadata WHERE id = ?", ID).toArray()[0];
  let expires_at = null;
  try { expires_at = normalizeExpiryInstant(row?.expires_at ?? null); } catch { /* corrupt metadata remains unknown */ }
  const phase = credentialPhase(expires_at);
  const p = { id: ID, metadata_source: "operator_provided", metadata_revision: row?.revision ?? 0, expires_at,
    phase, requires_action: phase !== "not_due", delivery: "not_reserved" };
  if (DUE.has(p.phase)) p.delivery = sql.exec("SELECT state FROM credential_maintenance_delivery WHERE delivery_key = ?", key(p)).toArray()[0]?.state ?? "not_reserved";
  return p;
}
function fields(body, expected) {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(k => !expected.includes(k)) ||
      expected.some(k => !Object.hasOwn(body, k))) throw new CredentialMaintenanceError("invalid_credential_maintenance_request");
}
function matchCurrent(body, current) {
  if (body.metadata_revision !== current.metadata_revision || body.expires_at !== current.expires_at || body.phase !== current.phase || !DUE.has(current.phase)) {
    throw new CredentialMaintenanceError("credential_maintenance_revision_conflict", 409);
  }
}
// All commands, including claim's unique insert, run in the owning SQLite transaction.
export function credentialMaintenanceCommand(sql, command) {
  const current = projection(sql);
  if (command.action === "credential_maintenance_read") return current;
  const body = command.body;
  if (command.action === "credential_maintenance_save") {
    fields(body, ["metadata_revision", "expires_at"]);
    if (!Number.isSafeInteger(body.metadata_revision) || body.metadata_revision < 0) throw new CredentialMaintenanceError("invalid_credential_maintenance_request");
    if (body.metadata_revision !== current.metadata_revision) throw new CredentialMaintenanceError("credential_maintenance_revision_conflict", 409);
    const expiry = normalizeExpiryInstant(body.expires_at);
    if (expiry === current.expires_at) return current; // Preserve revision and every delivery record.
    sql.exec("INSERT INTO credential_maintenance_metadata (id, revision, expires_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, expires_at=excluded.expires_at", ID, current.metadata_revision + 1, expiry);
    return projection(sql);
  }
  if (command.action === "credential_maintenance_claim") {
    fields(body, ["metadata_revision", "expires_at", "phase"]);
    matchCurrent(body, current);
    if (current.delivery !== "not_reserved") return { granted: false, phase: current.phase, delivery: current.delivery };
    const claim_id = crypto.randomUUID();
    sql.exec("INSERT INTO credential_maintenance_delivery (delivery_key, claim_id, metadata_revision, state) VALUES (?, ?, ?, 'reserved')", key(current), claim_id, current.metadata_revision);
    return { granted: true, claim_id, phase: current.phase, delivery: "reserved" };
  }
  if (command.action === "credential_maintenance_ack") {
    fields(body, ["metadata_revision", "expires_at", "phase", "claim_id", "outcome"]);
    matchCurrent(body, current);
    if (!["delivered", "unknown"].includes(body.outcome) || typeof body.claim_id !== "string") throw new CredentialMaintenanceError("invalid_credential_maintenance_request");
    const delivery = sql.exec("SELECT claim_id, metadata_revision, state FROM credential_maintenance_delivery WHERE delivery_key = ?", key(current)).toArray()[0];
    if (!delivery || delivery.claim_id !== body.claim_id || delivery.metadata_revision !== current.metadata_revision) throw new CredentialMaintenanceError("credential_maintenance_claim_conflict", 409);
    // A terminal ACK is idempotent. Neither uncertainty nor a later ACK releases a reserve.
    if (delivery.state === "reserved") sql.exec("UPDATE credential_maintenance_delivery SET state = ? WHERE delivery_key = ? AND claim_id = ?", body.outcome, key(current), body.claim_id);
    return { phase: current.phase, delivery: delivery.state === "reserved" ? body.outcome : delivery.state };
  }
  throw new CredentialMaintenanceError("unsupported_credential_maintenance_action");
}
