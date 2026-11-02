/** HTTP client for the console API. Session cookies only; 401 and 403 invalidate the private session, except a rejected rotation second factor. */

export class AccessError extends Error {
  readonly status: number;
  /** Fixed code from the exact two-field error JSON; a lookup key, never rendered text. */
  readonly code: string | null;
  constructor(status: number, code: string | null = null) {
    super(status === 401 ? "session_expired" : "access_denied");
    this.status = status;
    this.code = code;
  }
}

/** The error JSON is exactly `{ok:false,error:"<code>"}`; anything else yields no code. */
function fixedErrorCode(payload: unknown): string | null {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  if (Object.keys(record).sort().join() !== "error,ok") return null;
  if (record.ok !== false || typeof record.error !== "string") return null;
  return record.error;
}

export class HttpError extends Error {
  readonly status: number;
  readonly payload: unknown;
  constructor(status: number, payload: unknown) {
    const code = (payload as { error?: string } | null)?.error;
    super(code || `http_${status}`);
    this.status = status;
    this.payload = payload;
  }
}

/** The fixed rotation mutation routes, with the contract's operation id shape. */
const ROTATION_MUTATION_PATTERN =
  /^\/api\/credential-rotation\/ibkr_flex\/(?:stage|operations\/[A-Za-z0-9][A-Za-z0-9_-]{7,127}\/(?:finalize|cancel))$/;

let privateRequestEpoch = 0;
let privateReadRevision = 0;
export function readRevision(): number { return privateReadRevision; }

export function invalidatePrivateSession(): void {
  privateRequestEpoch += 1;
  privateReadRevision += 1;
  window.dispatchEvent(new Event("qsl-private-session-invalid"));
}

function assertCurrent(epoch: number): void {
  if (epoch !== privateRequestEpoch) throw new Error("session_invalidated");
}

export async function getJson<T>(path: string): Promise<T> {
  const epoch = privateRequestEpoch;
  const response = await fetch(path, {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (response.status === 401 || response.status === 403) {
    const payload = await response.json().catch(() => ({}));
    invalidatePrivateSession();
    throw new AccessError(response.status, fixedErrorCode(payload));
  }
  assertCurrent(epoch);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new HttpError(response.status, payload);
  }
  const payload = (await response.json()) as T;
  assertCurrent(epoch);
  return payload;
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const epoch = privateRequestEpoch;
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  // A rejected second factor does not revoke an otherwise valid owner session.
  // Scope the exception to the fixed rotation routes and exact error contract.
  const payload = await response.json().catch(() => ({}));
  assertCurrent(epoch);
  const code = fixedErrorCode(payload);
  const stepUpRejected = response.status === 403
    && ROTATION_MUTATION_PATTERN.test(path)
    && code === "step_up_invalid";
  if (response.status === 401 || (response.status === 403 && !stepUpRejected)) {
    invalidatePrivateSession();
    throw new AccessError(response.status, code);
  }
  if (!response.ok || (payload as { ok?: boolean })?.ok === false) {
    throw new HttpError(response.status, payload);
  }
  privateReadRevision += 1;
  return payload as T;
}
