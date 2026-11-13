export function renderMessage(title, message) {
  return `<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<body style="font-family:system-ui,sans-serif;margin:40px;color:#1c211d;background:#f7f8f3">
<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p><a href="/">返回控制台</a></p></body>`;
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
