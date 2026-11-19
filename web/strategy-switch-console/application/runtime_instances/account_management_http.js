// HTTP layer of the per-physical-account management setting (Q6). Three
// entrances, all thin: they authenticate, validate the closed request shape
// and forward one Durable Object command. The object re-validates every field,
// resolves the physical group itself and owns the revision, identity and
// membership checks; nothing here is authority. Outcome codes of the object
// pass through unchanged (a `management_*` conflict is a 409).
//
// - saveManagementDraftRequest: the `management_draft` group of
//   POST /api/account-settings, called by that handler once it sees the group.
// - accountManagementApplyResponse: POST /api/account-settings/management/apply.
// - accountMappingPolicyResponse: POST /api/internal/account-mapping-policy,
//   dormant provisioning behind its own secret binding. No session, producer
//   sync token or body assertion substitutes for it, and neither the token nor
//   the policy payload is ever logged or echoed.
import { HttpError } from "../http_error.js";
import { requireSameOrigin } from "../http_request.js";
import { json } from "../http_response.js";
import { runtimeInstanceCommand } from "./command.js";
import { POLICY_PROVISIONER_ACTOR } from "./account_management.js";

export const MANAGEMENT_APPLY_ROUTE = "/api/account-settings/management/apply";
export const POLICY_PROVISION_ROUTE = "/api/internal/account-mapping-policy";
export const POLICY_PROVISION_TOKEN_BINDING = "ACCOUNT_MAPPING_POLICY_PROVISION_TOKEN";

const REQUEST_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REVISIONS = ["expected_instance_revision", "expected_policy_revision", "expected_management_draft_revision", "expected_management_revision"];
const COMMON = ["platform", "key", "identity", "request_key", ...REVISIONS];
const POLICY_BODY_BYTES = 256 * 1024;
const REQUEST_BODY_BYTES = 16 * 1024;

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const invalid = () => json({ ok: false, error: "management_request_invalid", no_order: true, execution_authority_granted: false }, 400);
const failure = error => json({
  ok: false, error: error instanceof HttpError ? error.message : "runtime_instances_unavailable", no_order: true, execution_authority_granted: false,
}, error instanceof HttpError ? error.status : 503);

// The strict closed shape shared by save and apply; null when it is not met.
function commonCommand(raw, session, extraFields) {
  const fields = [...COMMON, ...extraFields];
  if (!isObject(raw) || Object.keys(raw).length !== fields.length || !fields.every(field => Object.hasOwn(raw, field))) return null;
  if (typeof raw.platform !== "string" || !raw.platform || typeof raw.key !== "string" || !raw.key || !isObject(raw.identity)
    || typeof raw.request_key !== "string" || !REQUEST_KEY.test(raw.request_key)) return null;
  if (!REVISIONS.every(field => Number.isSafeInteger(raw[field]) && raw[field] >= 0) || raw.expected_policy_revision < 1) return null;
  return {
    actor: session.login, platform: raw.platform, key: raw.key, identity: raw.identity, request_key: raw.request_key,
    ...Object.fromEntries(REVISIONS.map(field => [field, raw[field]])),
  };
}

async function admin(request, env, readSession) {
  requireSameOrigin(request, { requireOrigin: true });
  const session = await readSession(request, env);
  if (!session) return { response: json({ ok: false, error: "login required" }, 401) };
  if (!session.admin) return { response: json({ ok: false, error: "admin required" }, 403) };
  return { session };
}

// The management_draft group of a combined settings save. `raw` is the parsed
// body; the caller has already authenticated the admin session.
export async function saveManagementDraftRequest(env, session, raw) {
  // The group is closed: exactly the common fields plus `management_draft`;
  // a strategy, risk or declaration group in the same request fails the shape.
  const { management_draft: group, ...common } = isObject(raw) ? raw : {};
  const shaped = isObject(group) && Object.keys(group).length === 1 && typeof group.management_enabled === "boolean"
    ? commonCommand(common, session, []) : null;
  if (!shaped) return invalid();
  try {
    return json(await runtimeInstanceCommand(env, { action: "account_management_draft_save", ...shaped, management_enabled: group.management_enabled }));
  } catch (error) { return failure(error); }
}

export async function accountManagementApplyResponse(request, env, { readSession }) {
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const gate = await admin(request, env, readSession);
  if (gate.response) return gate.response;
  let raw;
  try {
    const text = await request.text();
    if (text.length > REQUEST_BODY_BYTES) return invalid();
    raw = JSON.parse(text);
  } catch { return invalid(); }
  const shaped = commonCommand(raw, gate.session, []);
  if (!shaped) return invalid();
  try {
    return json(await runtimeInstanceCommand(env, { action: "account_management_apply", ...shaped }));
  } catch (error) { return failure(error); }
}

// Constant-time comparison over fixed-length digests.
async function sameToken(presented, expected) {
  const digest = async value => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  const [left, right] = await Promise.all([digest(presented), digest(expected)]);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export async function accountMappingPolicyResponse(request, env) {
  const respond = (body, status) => json({ ...body, no_order: true, execution_authority_granted: false }, status);
  if (request.method !== "POST") return respond({ ok: false, error: "method_not_allowed" }, 405);
  const expected = env?.[POLICY_PROVISION_TOKEN_BINDING];
  // Disabled until provisioned: a missing binding denies, and nothing else can stand in for it.
  if (typeof expected !== "string" || !expected) return respond({ ok: false, error: "account_mapping_policy_provisioning_unavailable" }, 503);
  const presented = (request.headers.get("Authorization") || "").match(/^Bearer\s+(\S+)$/i)?.[1] || "";
  if (!presented || !await sameToken(presented, expected)) return respond({ ok: false, error: "account_mapping_policy_unauthorized" }, 401);
  let raw;
  try {
    const text = await request.text();
    if (text.length > POLICY_BODY_BYTES) return respond({ ok: false, error: "management_request_invalid" }, 400);
    raw = JSON.parse(text);
  } catch { return respond({ ok: false, error: "management_request_invalid" }, 400); }
  if (!isObject(raw) || Object.keys(raw).length !== 2 || !Number.isSafeInteger(raw.expected_policy_revision) || raw.expected_policy_revision < 0
    || !isObject(raw.policy)) return respond({ ok: false, error: "management_request_invalid" }, 400);
  try {
    const result = await runtimeInstanceCommand(env, {
      action: "account_mapping_policy_replace", actor: POLICY_PROVISIONER_ACTOR, expected_policy_revision: raw.expected_policy_revision, policy: raw.policy,
    });
    return respond({ ok: true, replaced: result.replaced === true, policy_revision: result.policy_revision }, 200);
  } catch (error) {
    return respond({ ok: false, error: error instanceof HttpError ? error.message : "runtime_instances_unavailable" }, error instanceof HttpError ? error.status : 503);
  }
}
