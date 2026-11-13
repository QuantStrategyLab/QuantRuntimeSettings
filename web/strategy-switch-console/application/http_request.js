import { HttpError } from "./http_error.js";

export function requireSameOrigin(request, options = {}) {
  const origin = request.headers.get("Origin");
  if (!origin) {
    if (options.requireOrigin) throw new HttpError("Origin header is required", 403);
    return;
  }
  if (origin !== new URL(request.url).origin) throw new HttpError("cross-origin request rejected", 403);
}
