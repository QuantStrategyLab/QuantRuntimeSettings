import { SECURITY_HEADERS } from "./security_headers.js";

export function json(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: responseHeaders({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    }, headers),
  });
}

export function html(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: responseHeaders({
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    }, headers),
  });
}

export function redirect(location, headers = {}) {
  return new Response(null, {
    status: 302,
    headers: responseHeaders({ Location: location }, headers),
  });
}

export function responseHeaders(base = {}, extra = {}) {
  const headers = new Headers(SECURITY_HEADERS);
  appendHeaderEntries(headers, base);
  appendHeaderEntries(headers, extra);
  return headers;
}

export function appendHeaderEntries(headers, values) {
  for (const [name, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }
}
