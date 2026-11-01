/** HTTP client for the console API. Session cookies only; authentication/permission failures invalidate the private session. */

export class AccessError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(status === 401 ? "session_expired" : "access_denied");
    this.status = status;
  }
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
    invalidatePrivateSession();
    throw new AccessError(response.status);
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
  const stepUpRejected = response.status === 403
    && /^\/api\/credential-rotation\/ibkr_flex\/(?:stage|operations\/[A-Za-z0-9][A-Za-z0-9_-]{7,127}\/(?:finalize|cancel))$/.test(path)
    && payload !== null && typeof payload === "object" && !Array.isArray(payload)
    && Object.keys(payload).sort().join() === "error,ok"
    && payload.ok === false && payload.error === "step_up_invalid";
  if (response.status === 401 || (response.status === 403 && !stepUpRejected)) {
    invalidatePrivateSession();
    throw new AccessError(response.status);
  }
  assertCurrent(epoch);
  if (!response.ok || (payload as { ok?: boolean })?.ok === false) {
    throw new HttpError(response.status, payload);
  }
  privateReadRevision += 1;
  return payload as T;
}
