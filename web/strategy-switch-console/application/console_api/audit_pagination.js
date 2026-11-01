const instant = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const encode = value => btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// The cursor is a position, never authority. All pages require the same session checks.
export function auditPageQuery(url, now = Date.now()) {
  for (const key of url.searchParams.keys()) {
    if (!["limit", "cursor"].includes(key) || url.searchParams.getAll(key).length !== 1) throw Error("invalid_pagination");
  }
  const raw = url.searchParams.get("limit");
  if (raw !== null && !/^[1-9]\d{0,2}$/.test(raw)) throw Error("invalid_pagination");
  const limit = raw === null ? 25 : Number(raw);
  if (limit > 100) throw Error("invalid_pagination");
  const cursor = url.searchParams.get("cursor");
  if (cursor === null) return { limit, snapshot: new Date(now).toISOString(), before: null };
  try {
    if (!/^[A-Za-z0-9_-]{1,2048}$/.test(cursor)) throw Error();
    const value = JSON.parse(atob(cursor.replace(/-/g, "+").replace(/_/g, "/")));
    if (Object.keys(value).sort().join() !== "at,id,snapshot,v" || value.v !== 1
      || !instant(value.at) || !instant(value.snapshot) || value.at > value.snapshot
      || Date.parse(value.snapshot) > now || typeof value.id !== "string"
      || !/^[\x20-\x7e]{1,512}$/.test(value.id) || encode(value) !== cursor) throw Error();
    return { limit, snapshot: value.snapshot, before: { at: value.at, id: value.id } };
  } catch { throw Error("invalid_pagination"); }
}

export function auditEventInPage(event, page) {
  return event.occurred_at <= page.snapshot && (!page.before || event.occurred_at < page.before.at
    || event.occurred_at === page.before.at && event.id > page.before.id);
}
export function auditEventOrder(left, right) {
  return left.occurred_at === right.occurred_at ? (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    : left.occurred_at > right.occurred_at ? -1 : 1;
}
export function auditNextCursor(event, page) {
  return encode({ v: 1, snapshot: page.snapshot, at: event.occurred_at, id: event.id });
}
