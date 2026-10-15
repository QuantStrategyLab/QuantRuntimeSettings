/** HTTP client for the console API. Session cookies only; 401/403 invalidate the private session globally. */

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

export function invalidatePrivateSession(): void {
  privateRequestEpoch += 1;
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
  if (response.status === 401 || response.status === 403) {
    invalidatePrivateSession();
    throw new AccessError(response.status);
  }
  assertCurrent(epoch);
  const payload = await response.json().catch(() => ({}));
  assertCurrent(epoch);
  if (!response.ok || (payload as { ok?: boolean })?.ok === false) {
    throw new HttpError(response.status, payload);
  }
  return payload as T;
}
