const statuses = new Set([400, 401, 403, 404, 409, 422, 429, 502, 503]);

export class DeskError extends Error {
  constructor(code, status = 400) {
    if (!/^[a-z][a-z0-9_]*$/.test(code) || !statuses.has(status)) throw new TypeError("invalid desk error");
    super(code);
    this.status = status;
  }
}

export function deskJson(payload, status = 200, headers = {}) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json; charset=utf-8");
  responseHeaders.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(payload), { status, headers: responseHeaders });
}

export function deskResponse(name, payload, { now = Date.now(), status = 200, headers } = {}) {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new TypeError("invalid desk schema name");
  return deskJson({ ...payload, ok: true, schema_version: `qsl.desk.${name}.v1`, generated_at: new Date(now).toISOString() }, status, headers);
}

export function deskErrorResponse(error) {
  // Only deliberately constructed desk errors are public. Legacy/upstream
  // exceptions can contain private URLs, response bodies or stack traces.
  if (!(error instanceof DeskError)) return deskJson({ ok: false, error: "read_failed", reason_code: "read_failed" }, 502);
  const code = error.message;
  const authCopy = { login_required: "login required", admin_required: "admin required" };
  return deskJson({ ok: false, error: authCopy[code] || code, reason_code: code }, error.status);
}

export function createDeskAuth({ readSession, requireSameOrigin }) {
  return async function deskAuth(request, env, { admin = false, write = false } = {}) {
    const session = await readSession(request, env);
    if (session?.allowed !== true) throw new DeskError("login_required", 401);
    if (admin && session.admin !== true) throw new DeskError("admin_required", 403);
    if (write) {
      try { requireSameOrigin(request, { requireOrigin: true }); }
      catch { throw new DeskError("same_origin_required", 403); }
    }
    return session;
  };
}
