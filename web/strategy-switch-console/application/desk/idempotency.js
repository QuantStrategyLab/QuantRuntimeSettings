import { DeskError } from "./http.js";

// JSON object ordering is immaterial; array ordering and JSON value types are not.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function digest(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function stored(operation) {
  try { return await operation(); }
  catch (error) {
    if (error instanceof DeskError) throw error;
    throw new DeskError("store_unavailable", 503);
  }
}

// Invoke inside the existing RuntimeInstances DO with its ctx.storage, not KV.
// scope MUST be server-derived from authenticated actor + method + route.
// create(requestId) returns { status, body }; persist only public response data.
export async function withIdempotency(storage, { scope, body, reserve }, create) {
  const key = body?.idempotency_key;
  if (typeof key !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(key)) throw new DeskError("invalid_idempotency_key", 400);
  if (typeof scope !== "string" || !scope) throw new DeskError("invalid_idempotency_scope", 400);
  if (!storage?.transaction) throw new DeskError("store_unavailable", 503);
  const storageKey = `desk:idempotency:${await digest(JSON.stringify([scope, key]))}`;
  const fingerprint = await digest(canonical(body));
  const requestId = crypto.randomUUID();
  const previous = await stored(() => storage.transaction(async (txn) => {
    const existing = await txn.get(storageKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new DeskError("idempotency_key_conflict", 409);
      return existing;
    }
    // Optional local guard/claim joins the reservation transaction. A refused
    // claim rolls back without leaving an incomplete idempotency reservation.
    if (reserve) await reserve(txn, requestId);
    await txn.put(storageKey, { fingerprint, request_id: requestId, state: "pending" });
    return null;
  }));
  if (previous) {
    if (previous.state !== "complete") throw new DeskError("request_in_progress", 409);
    return { status: previous.response.status, body: { ...previous.response.body, reused: true } };
  }
  // A failed/uncertain create remains reserved: never repeat a possible side effect.
  const result = await create(requestId);
  if (!Number.isInteger(result?.status) || result.status < 200 || result.status >= 300
    || !result.body || result.body.ok !== true) throw new DeskError("invalid_idempotency_response", 502);
  const response = { status: result.status, body: result.body };
  await stored(() => storage.transaction(async (txn) => {
    await txn.put(storageKey, { fingerprint, request_id: requestId, state: "complete", response });
  }));
  return response;
}
