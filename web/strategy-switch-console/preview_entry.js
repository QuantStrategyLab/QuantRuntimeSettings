/** Independent preview namespace. Never falls back to the production shell/assets. */
export function previewResponse(request, { html, assets }, responseHeaders) {
  const url = new URL(request.url);
  const headers = responseHeaders({ "Cache-Control": "no-store" });
  if (!["GET", "HEAD"].includes(request.method)) {
    headers.set("Allow", "GET, HEAD");
    return new Response(null, { status: 405, headers });
  }
  if (url.pathname === "/preview") {
    headers.set("Location", `/preview/${url.search}`);
    return new Response(null, { status: 308, headers });
  }
  if (url.pathname === "/preview/" && typeof html === "string" && html) {
    headers.set("Content-Type", "text/html; charset=utf-8");
    return new Response(request.method === "HEAD" ? null : html, { headers });
  }
  const asset = url.pathname.startsWith("/preview/assets/") && Object.hasOwn(assets, url.pathname)
    ? assets[url.pathname] : null;
  if (!asset) return new Response(null, { status: 404, headers });
  headers.set("Content-Type", asset.contentType);
  headers.set("Cache-Control", /^\/preview\/assets\/index-[A-Za-z0-9_-]{8,}\.(?:js|css)$/.test(url.pathname)
    ? "public, max-age=31536000, immutable" : "no-cache");
  if (request.method === "HEAD") return new Response(null, { headers });
  const bytes = Uint8Array.from(atob(asset.base64), character => character.charCodeAt(0));
  return new Response(bytes, { headers });
}
