/**
 * C-SA-22 Deterministic XNYS Sessions Calendar Runtime Consumer.
 *
 * Pure Worker-safe ES module under application/market_sessions/:
 * - Imports only static verified spec packages from ./data.js.
 * - Uses synchronous pure-JS SHA-256 (zero node:crypto, node:fs, or .json imports).
 * - Self-verifies manifest SHA-256 digests across SPEC.md, exceptions-*.json,
 *   generate_expected_*.py, deterministic expected-*.json output, and spec_digest.
 * - Enforces Rule 7 (verbatim session_state emission + pure display projection),
 *   US 23/5 extended-hours isolation, post-21:00 ET T+1 clearing isolation, and O2 split.
 */

import { CSA22_PACKAGES, CSA22_PINNED_DIGESTS } from "./data.js";

export const MARKET_SESSIONS_CALENDAR_SCHEMA = "qsl.market_sessions_calendar.v1";
export const PINNED_CALENDAR_DIGESTS = CSA22_PINNED_DIGESTS;
export const SUPPORTED_EXCHANGE = "XNYS";
export const SUPPORTED_TIMEZONE = "America/New_York";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const ISO_INSTANT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-](\d{2}):(\d{2}))$/;

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export class CalendarDigestError extends Error {
  constructor(message) {
    super(message);
    this.name = "CalendarDigestError";
  }
}

function rotr(x, n) {
  return (x >>> n) | (x << (32 - n));
}

export function sha256HexSync(input) {
  const bytes = input instanceof Uint8Array ? input : new TextEncoder().encode(String(input));
  const bitLen = BigInt(bytes.length) * 8n;
  const paddedLen = Math.ceil((bytes.length + 9) / 64) * 64;
  const buf = new Uint8Array(paddedLen);
  buf.set(bytes);
  buf[bytes.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(paddedLen - 8, Number(bitLen >> 32n), false);
  view.setUint32(paddedLen - 4, Number(bitLen & 0xffffffffn), false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((n) => n.toString(16).padStart(8, "0"))
    .join("");
}

function sortJsonKeys(value) {
  if (Array.isArray(value)) return value.map(sortJsonKeys);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortJsonKeys(value[key]);
    }
    return out;
  }
  return value;
}

const tzFormatterCache = new Map();
function getTzFormatter(timeZone) {
  let fmt = tzFormatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    tzFormatterCache.set(timeZone, fmt);
  }
  return fmt;
}

function zonedPartsAtMs(epochMs, timeZone) {
  const parts = getTzFormatter(timeZone).formatToParts(new Date(epochMs));
  const map = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  const year = Number(map.year);
  const month = Number(map.month);
  const day = Number(map.day);
  const hour = map.hour === "24" ? 0 : Number(map.hour);
  const minute = Number(map.minute);
  const second = Number(map.second);
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    date: `${map.year}-${map.month}-${map.day}`,
    hhmm: `${String(hour).padStart(2, "0")}:${map.minute}`,
  };
}

function parseIsoDateStrict(isoDate) {
  if (typeof isoDate !== "string" || !ISO_DATE_RE.test(isoDate)) return null;
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return { y, m, d, weekday: dt.getUTCDay(), msUtcMidnight: dt.getTime() };
}

function shiftIsoDate(isoDate, deltaDays) {
  const parsed = parseIsoDateStrict(isoDate);
  if (!parsed) return null;
  return new Date(parsed.msUtcMidnight + deltaDays * 86_400_000).toISOString().slice(0, 10);
}

function parseUtcInstantMs(input) {
  if (typeof input === "number") {
    return Number.isFinite(input) ? Math.trunc(input) : null;
  }
  if (typeof input !== "string") return null;
  const match = ISO_INSTANT_RE.exec(input);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (hour > 23 || minute > 59 || second > 59) return null;

  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  if (
    parsedDate.getUTCFullYear() !== year
    || parsedDate.getUTCMonth() !== month - 1
    || parsedDate.getUTCDate() !== day
  ) {
    return null;
  }

  let offsetMinutes = 0;
  if (match[8] !== "Z") {
    const offH = Number(match[9]);
    const offM = Number(match[10]);
    if (offH > 23 || offM > 59) return null;
    offsetMinutes = (match[8].startsWith("-") ? -1 : 1) * (offH * 60 + offM);
  }
  const msFloat = Number(`0.${match[7] || "0"}`) * 1000;
  return Date.UTC(year, month - 1, day, hour, minute, second) + Math.floor(msFloat) - offsetMinutes * 60_000;
}

function localWallToUtcMs(isoDate, hhmm, timeZone) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const [hour, minute] = hhmm.split(":").map(Number);
  const targetAsUtcMs = Date.UTC(y, m - 1, d, hour, minute, 0, 0);
  // First guess at EST (-05:00), then refine using actual zoned wall-clock difference.
  let guess = targetAsUtcMs + 5 * 3_600_000;
  for (let pass = 0; pass < 3; pass += 1) {
    const p = zonedPartsAtMs(guess, timeZone);
    const actualAsUtcMs = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, 0);
    const diff = targetAsUtcMs - actualAsUtcMs;
    if (diff === 0) break;
    guess += diff;
  }
  return guess;
}

function localWallToUtcIso(isoDate, hhmm, timeZone) {
  return new Date(localWallToUtcMs(isoDate, hhmm, timeZone)).toISOString();
}

function isDstAtLocalNoon(isoDate, timeZone) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const janOffset = Date.UTC(y, 0, 1, 12, 0, 0) - localWallToUtcMs(`${y}-01-01`, "12:00", timeZone);
  const curOffset = Date.UTC(y, m - 1, d, 12, 0, 0) - localWallToUtcMs(isoDate, "12:00", timeZone);
  return curOffset !== janOffset;
}

function buildDailySessionsFromRules(rules, specDigest) {
  const start = rules.coverage_start_date;
  const end = rules.coverage_end_date;
  const tz = rules.timezone;
  const holidays = rules.holidays || {};
  const unscheduled = rules.unscheduled_closures || {};
  const earlyCloses = rules.early_closes || {};

  const sessions = {};
  let cursor = start;
  while (cursor <= end) {
    const parsed = parseIsoDateStrict(cursor);
    if (!parsed) {
      throw new CalendarDigestError(`invalid coverage date while generating sessions: ${cursor}`);
    }
    const isDst = isDstAtLocalNoon(cursor, tz);
    const base = {
      exchange: rules.exchange,
      trade_date: cursor,
      timezone: tz,
      calendar_version: rules.calendar_version,
      coverage_start_date: start,
      coverage_end_date: end,
      spec_digest: specDigest,
      is_dst: isDst,
    };

    if (Object.hasOwn(unscheduled, cursor)) {
      const name = unscheduled[cursor];
      sessions[cursor] = {
        ...base,
        session_state: "unscheduled_closure",
        is_trading_day: false,
        reason: `unscheduled_closure: ${name}`,
        holiday_name: name,
        open_local: null,
        close_local: null,
        cutoff_local: null,
        open_utc: null,
        close_utc: null,
        order_cutoff_utc: null,
        order_window: null,
        blocks_orders: true,
        blocks_eligibility: true,
      };
    } else if (Object.hasOwn(holidays, cursor)) {
      const name = holidays[cursor];
      sessions[cursor] = {
        ...base,
        session_state: "closed",
        is_trading_day: false,
        reason: `holiday: ${name}`,
        holiday_name: name,
        open_local: null,
        close_local: null,
        cutoff_local: null,
        open_utc: null,
        close_utc: null,
        order_cutoff_utc: null,
        order_window: null,
        blocks_orders: true,
        blocks_eligibility: true,
      };
    } else if (parsed.weekday === 0 || parsed.weekday === 6) {
      sessions[cursor] = {
        ...base,
        session_state: "closed",
        is_trading_day: false,
        reason: "weekend",
        holiday_name: null,
        open_local: null,
        close_local: null,
        cutoff_local: null,
        open_utc: null,
        close_utc: null,
        order_cutoff_utc: null,
        order_window: null,
        blocks_orders: true,
        blocks_eligibility: true,
      };
    } else if (Object.hasOwn(earlyCloses, cursor)) {
      const info = earlyCloses[cursor];
      const openLocal = rules.regular_open_local;
      const closeLocal = info.close_local;
      const openUtc = localWallToUtcIso(cursor, openLocal, tz);
      const closeUtc = localWallToUtcIso(cursor, closeLocal, tz);
      sessions[cursor] = {
        ...base,
        session_state: "half_day",
        is_trading_day: true,
        reason: `early_close: ${info.name}`,
        holiday_name: info.name,
        open_local: openLocal,
        close_local: closeLocal,
        cutoff_local: closeLocal,
        open_utc: openUtc,
        close_utc: closeUtc,
        order_cutoff_utc: closeUtc,
        order_window: {
          start_utc: openUtc,
          end_utc: closeUtc,
          half_open: true,
        },
        blocks_orders: false,
        blocks_eligibility: false,
      };
    } else {
      const openLocal = rules.regular_open_local;
      const closeLocal = rules.regular_close_local;
      const openUtc = localWallToUtcIso(cursor, openLocal, tz);
      const closeUtc = localWallToUtcIso(cursor, closeLocal, tz);
      sessions[cursor] = {
        ...base,
        session_state: "regular",
        is_trading_day: true,
        reason: null,
        holiday_name: null,
        open_local: openLocal,
        close_local: closeLocal,
        cutoff_local: closeLocal,
        open_utc: openUtc,
        close_utc: closeUtc,
        order_cutoff_utc: closeUtc,
        order_window: {
          start_utc: openUtc,
          end_utc: closeUtc,
          half_open: true,
        },
        blocks_orders: false,
        blocks_eligibility: false,
      };
    }

    cursor = shiftIsoDate(cursor, 1);
  }
  return sessions;
}

/**
 * Verifies a C-SA-22 spec package against manifest digests and pinned spec_digest.
 * Throws CalendarDigestError on any missing file or 1-byte tamper.
 */
export function verifyCalendarPackage(pkgInput) {
  if (!pkgInput || typeof pkgInput !== "object") {
    throw new CalendarDigestError("calendar package must be an object");
  }
  let manifest = pkgInput.manifest;
  if (typeof pkgInput.manifest_json === "string") {
    try {
      manifest = JSON.parse(pkgInput.manifest_json);
    } catch {
      throw new CalendarDigestError("invalid manifest.json JSON");
    }
  }
  if (!manifest || typeof manifest !== "object" || !manifest.files || typeof manifest.files !== "object") {
    throw new CalendarDigestError("manifest.json missing recorded files map");
  }

  const version = manifest.calendar_version;
  if (typeof version !== "string" || !Object.hasOwn(CSA22_PINNED_DIGESTS, version)) {
    throw new CalendarDigestError(`unpinned or unsupported calendar_version: ${String(version)}`);
  }
  const pinnedDigest = CSA22_PINNED_DIGESTS[version];
  if (manifest.spec_digest !== pinnedDigest) {
    throw new CalendarDigestError(
      `manifest spec_digest mismatch for ${version}: expected ${pinnedDigest}, got ${String(manifest.spec_digest)}`,
    );
  }

  const files = manifest.files;
  const specMd = pkgInput.spec_markdown;
  if (typeof specMd !== "string") {
    throw new CalendarDigestError("missing SPEC.md content");
  }
  const actualSpecMdDigest = sha256HexSync(specMd);
  if (actualSpecMdDigest !== files["SPEC.md"]) {
    throw new CalendarDigestError(`digest mismatch for SPEC.md: expected ${files["SPEC.md"]}, got ${actualSpecMdDigest}`);
  }

  const excFile = pkgInput.exceptions_file;
  const excJson = pkgInput.exceptions_json;
  if (typeof excFile !== "string" || typeof excJson !== "string" || !Object.hasOwn(files, excFile)) {
    throw new CalendarDigestError(`missing exceptions file content: ${String(excFile)}`);
  }
  const actualExcDigest = sha256HexSync(excJson);
  if (actualExcDigest !== files[excFile]) {
    throw new CalendarDigestError(`digest mismatch for ${excFile}: expected ${files[excFile]}, got ${actualExcDigest}`);
  }

  const genFile = pkgInput.generate_file;
  const genScript = pkgInput.generate_script;
  if (typeof genFile !== "string" || typeof genScript !== "string" || !Object.hasOwn(files, genFile)) {
    throw new CalendarDigestError(`missing generator script content: ${String(genFile)}`);
  }
  const actualGenDigest = sha256HexSync(genScript);
  if (actualGenDigest !== files[genFile]) {
    throw new CalendarDigestError(`digest mismatch for ${genFile}: expected ${files[genFile]}, got ${actualGenDigest}`);
  }

  const computedSpecDigest = sha256HexSync(`${specMd}${excJson}`);
  if (computedSpecDigest !== manifest.spec_digest || computedSpecDigest !== pinnedDigest) {
    throw new CalendarDigestError(
      `spec_digest mismatch for ${version}: expected ${pinnedDigest}, got ${computedSpecDigest}`,
    );
  }

  let rules;
  try {
    rules = JSON.parse(excJson);
  } catch {
    throw new CalendarDigestError(`invalid ${excFile} JSON`);
  }
  if (!rules || rules.calendar_version !== version || rules.exchange !== SUPPORTED_EXCHANGE) {
    throw new CalendarDigestError(`exceptions rules metadata mismatch for ${version}`);
  }

  const expectedFile = pkgInput.expected_file;
  if (typeof expectedFile !== "string" || !Object.hasOwn(files, expectedFile)) {
    throw new CalendarDigestError(`missing expected output filename in manifest: ${String(expectedFile)}`);
  }
  if (typeof pkgInput.expected_json === "string") {
    const providedExpectedDigest = sha256HexSync(pkgInput.expected_json);
    if (providedExpectedDigest !== files[expectedFile]) {
      throw new CalendarDigestError(
        `digest mismatch for ${expectedFile}: expected ${files[expectedFile]}, got ${providedExpectedDigest}`,
      );
    }
  }

  const sessions = buildDailySessionsFromRules(rules, computedSpecDigest);
  const dayCount = Object.keys(sessions).length;
  const envelope = sortJsonKeys({
    calendar_version: rules.calendar_version,
    status: rules.status,
    exchange: rules.exchange,
    timezone: rules.timezone,
    coverage_start_date: rules.coverage_start_date,
    coverage_end_date: rules.coverage_end_date,
    spec_digest: computedSpecDigest,
    day_count: dayCount,
    sessions,
  });
  const computedExpectedJson = `${JSON.stringify(envelope, null, 2)}\n`;
  const computedExpectedDigest = sha256HexSync(computedExpectedJson);
  if (computedExpectedDigest !== files[expectedFile]) {
    throw new CalendarDigestError(
      `digest mismatch for generated ${expectedFile}: expected ${files[expectedFile]}, got ${computedExpectedDigest}`,
    );
  }

  return Object.freeze({
    calendar_version: version,
    spec_digest: computedSpecDigest,
    manifest,
    rules,
    sessions: Object.freeze(sessions),
  });
}

const VERIFIED_SPEC_CACHE = new Map();

export function loadSpec(specOrVersion = null) {
  if (specOrVersion && typeof specOrVersion === "object") {
    if (specOrVersion.rules && specOrVersion.sessions && specOrVersion.spec_digest) {
      return specOrVersion;
    }
    return verifyCalendarPackage(specOrVersion);
  }
  const version = specOrVersion || "csa22-v2";
  if (typeof version !== "string" || !Object.hasOwn(CSA22_PACKAGES, version)) {
    throw new CalendarDigestError(`unknown C-SA-22 calendar_version: ${String(version)}`);
  }
  let cached = VERIFIED_SPEC_CACHE.get(version);
  if (!cached) {
    cached = verifyCalendarPackage(CSA22_PACKAGES[version]);
    VERIFIED_SPEC_CACHE.set(version, cached);
  }
  return cached;
}

export function loadAllSpecs() {
  return Object.freeze({
    "csa22-v1": loadSpec("csa22-v1"),
    "csa22-v2": loadSpec("csa22-v2"),
  });
}

// Verify built-in pinned packages immediately at module load per C-SA-22 Rule 1.
loadAllSpecs();

function buildUnknownSession(venue, tradeDate, rules, specDigest, reason, isDst = null) {
  return {
    exchange: venue,
    trade_date: tradeDate,
    timezone: rules.timezone,
    calendar_version: rules.calendar_version,
    coverage_start_date: rules.coverage_start_date,
    coverage_end_date: rules.coverage_end_date,
    spec_digest: specDigest,
    is_dst: isDst,
    session_state: "unknown",
    is_trading_day: false,
    reason,
    holiday_name: null,
    open_local: null,
    close_local: null,
    cutoff_local: null,
    open_utc: null,
    close_utc: null,
    order_cutoff_utc: null,
    order_window: null,
    blocks_orders: true,
    blocks_eligibility: true,
  };
}

function selectSpecForDate(tradeDate, explicitSpec) {
  if (explicitSpec) return loadSpec(explicitSpec);
  const all = loadAllSpecs();
  const parsed = parseIsoDateStrict(tradeDate);
  if (!parsed) return all["csa22-v2"];
  if (tradeDate >= all["csa22-v1"].rules.coverage_start_date && tradeDate <= all["csa22-v1"].rules.coverage_end_date) {
    return all["csa22-v1"];
  }
  if (tradeDate >= all["csa22-v2"].rules.coverage_start_date && tradeDate <= all["csa22-v2"].rules.coverage_end_date) {
    return all["csa22-v2"];
  }
  return tradeDate < all["csa22-v1"].rules.coverage_start_date ? all["csa22-v1"] : all["csa22-v2"];
}

function applyObservedVenueStatus(result, observedVenueStatus) {
  if (observedVenueStatus === undefined || observedVenueStatus === null) {
    return result;
  }
  const matches = (
    observedVenueStatus === result.session_state
    || (
      observedVenueStatus === "core_session_open"
      && (result.session_state === "regular" || result.session_state === "half_day")
    )
  );
  if (!matches) {
    return {
      ...result,
      blocks_orders: true,
      blocks_eligibility: true,
      venue_disagreement: true,
      observed_venue_status: observedVenueStatus,
    };
  }
  return result;
}

/**
 * Resolves C-SA-22 session facts for (venue, tradeDate).
 * Supports single-version spec override or automatic verified selection across csa22-v1 (2025) & csa22-v2 (2026).
 */
export function resolveSession(venue, tradeDate, options = {}) {
  const opts = options || {};
  const loaded = selectSpecForDate(tradeDate, opts.spec ?? null);
  const rules = loaded.rules;
  const specDigest = loaded.spec_digest;
  const observedStatus = opts.observed_venue_status ?? null;

  const parsed = parseIsoDateStrict(tradeDate);
  if (!parsed) {
    return applyObservedVenueStatus(
      buildUnknownSession(venue, tradeDate, rules, specDigest, "invalid_date"),
      observedStatus,
    );
  }

  if (venue !== rules.exchange) {
    return applyObservedVenueStatus(
      buildUnknownSession(venue, tradeDate, rules, specDigest, "unsupported_venue"),
      observedStatus,
    );
  }

  if (tradeDate < rules.coverage_start_date || tradeDate > rules.coverage_end_date) {
    return applyObservedVenueStatus(
      buildUnknownSession(venue, tradeDate, rules, specDigest, "out_of_range"),
      observedStatus,
    );
  }

  const baseEntry = loaded.sessions[tradeDate];
  let result = { ...baseEntry };
  if (baseEntry.order_window) {
    result.order_window = { ...baseEntry.order_window };
  }

  if (
    result.is_trading_day
    && opts.cutoff_local !== undefined
    && opts.cutoff_local !== null
  ) {
    if (typeof opts.cutoff_local !== "string" || !CLOCK_RE.test(opts.cutoff_local)) {
      return applyObservedVenueStatus(
        buildUnknownSession(venue, tradeDate, rules, specDigest, "invalid_cutoff_local", result.is_dst),
        observedStatus,
      );
    }
    const closeLocal = result.close_local;
    let effCutoffLocal = opts.cutoff_local < closeLocal ? opts.cutoff_local : closeLocal;
    let orderCutoffUtc = localWallToUtcIso(tradeDate, effCutoffLocal, rules.timezone);
    if (orderCutoffUtc > result.close_utc) {
      orderCutoffUtc = result.close_utc;
      effCutoffLocal = closeLocal;
    }
    if (orderCutoffUtc < result.open_utc) {
      orderCutoffUtc = result.open_utc;
      effCutoffLocal = result.open_local;
    }
    result = {
      ...result,
      cutoff_local: effCutoffLocal,
      order_cutoff_utc: orderCutoffUtc,
      order_window: {
        start_utc: result.open_utc,
        end_utc: orderCutoffUtc,
        half_open: true,
      },
    };
  }

  return applyObservedVenueStatus(result, observedStatus);
}

/**
 * C-SA-22 Rule 7 display derivation helper.
 * Derives closure label strictly from verbatim `session_state`, never from flags.
 */
export function projectSessionClosureLabel(sessionOrState) {
  const state = typeof sessionOrState === "string"
    ? sessionOrState
    : sessionOrState?.session_state;
  if (state === "closed" || state === "unscheduled_closure") return "closed";
  if (state === "regular" || state === "half_day" || state === "unknown") return state;
  return "unknown";
}

/**
 * Checks half-open order window [open_utc, order_cutoff_utc) capped by close_utc
 * and honors O2 blocking flags.
 */
export function isOrderAllowedAt(instantUtc, session) {
  if (!session || typeof session !== "object") {
    return { allowed: false, in_window: false, blocks_orders: true, reason: "missing_session" };
  }
  const instMs = parseUtcInstantMs(instantUtc);
  if (instMs === null) {
    return { allowed: false, in_window: false, blocks_orders: true, reason: "invalid_timestamp" };
  }
  if (session.blocks_orders || session.blocks_eligibility || !session.is_trading_day) {
    return {
      allowed: false,
      in_window: false,
      blocks_orders: true,
      reason: session.venue_disagreement ? "venue_disagreement" : (session.reason || "session_blocked"),
    };
  }
  const openMs = parseUtcInstantMs(session.open_utc);
  const cutoffMs = parseUtcInstantMs(session.order_cutoff_utc);
  const closeMs = parseUtcInstantMs(session.close_utc);
  if (openMs === null || cutoffMs === null || closeMs === null) {
    return { allowed: false, in_window: false, blocks_orders: true, reason: "missing_session_window" };
  }
  const effectiveEndMs = cutoffMs <= closeMs ? cutoffMs : closeMs;
  const inWindow = instMs >= openMs && instMs < effectiveEndMs;
  return {
    allowed: inWindow,
    in_window: inWindow,
    blocks_orders: false,
    reason: inWindow ? null : "outside_order_window",
  };
}

/**
 * Resolves the latest trading session whose close_utc <= decisionInstantUtc.
 * Post-21:00 ET activity resolves to T (same evening close) rather than T+1.
 */
export function resolvePriorCloseSession(decisionInstantUtc, options = {}) {
  const opts = options || {};
  const venue = opts.venue || SUPPORTED_EXCHANGE;
  const explicitSpec = opts.spec ? loadSpec(opts.spec) : null;
  const allSpecs = explicitSpec ? null : loadAllSpecs();
  const covStart = explicitSpec
    ? explicitSpec.rules.coverage_start_date
    : allSpecs["csa22-v1"].rules.coverage_start_date;
  const covEnd = explicitSpec
    ? explicitSpec.rules.coverage_end_date
    : allSpecs["csa22-v2"].rules.coverage_end_date;
  const defaultSpec = explicitSpec || allSpecs["csa22-v2"];

  if (venue !== SUPPORTED_EXCHANGE) {
    const approxDate = typeof decisionInstantUtc === "string" ? decisionInstantUtc.slice(0, 10) : "unknown";
    return buildUnknownSession(venue, approxDate, defaultSpec.rules, defaultSpec.spec_digest, "unsupported_venue");
  }

  const instMs = parseUtcInstantMs(decisionInstantUtc);
  if (instMs === null) {
    const approxDate = typeof decisionInstantUtc === "string" ? decisionInstantUtc.slice(0, 10) : "unknown";
    return buildUnknownSession(venue, approxDate, defaultSpec.rules, defaultSpec.spec_digest, "invalid_timestamp");
  }

  const instantIso = new Date(instMs).toISOString();
  const localParts = zonedPartsAtMs(instMs, SUPPORTED_TIMEZONE);
  if (localParts.date < covStart || localParts.date > covEnd) {
    const boundarySpec = selectSpecForDate(localParts.date, explicitSpec);
    return buildUnknownSession(venue, localParts.date, boundarySpec.rules, boundarySpec.spec_digest, "out_of_range");
  }

  for (let offset = 0; offset < 15; offset += 1) {
    const cand = shiftIsoDate(localParts.date, -offset);
    if (!cand || cand < covStart) break;
    const sess = resolveSession(venue, cand, explicitSpec ? { spec: explicitSpec } : {});
    if (sess.is_trading_day && !sess.blocks_eligibility && sess.close_utc && sess.close_utc <= instantIso) {
      return sess;
    }
  }

  const boundarySpec = selectSpecForDate(localParts.date, explicitSpec);
  return buildUnknownSession(venue, localParts.date, boundarySpec.rules, boundarySpec.spec_digest, "out_of_range");
}

/**
 * Returns the immediately preceding verified XNYS trading date strictly before sessionDate, or null.
 */
export function resolvePreviousTradingDate(sessionDate, options = {}) {
  const opts = options || {};
  const venue = opts.venue || SUPPORTED_EXCHANGE;
  if (venue !== SUPPORTED_EXCHANGE) return null;
  if (!parseIsoDateStrict(sessionDate)) return null;

  const explicitSpec = opts.spec ? loadSpec(opts.spec) : null;
  const allSpecs = explicitSpec ? null : loadAllSpecs();
  const covStart = explicitSpec
    ? explicitSpec.rules.coverage_start_date
    : allSpecs["csa22-v1"].rules.coverage_start_date;
  const covEnd = explicitSpec
    ? explicitSpec.rules.coverage_end_date
    : allSpecs["csa22-v2"].rules.coverage_end_date;

  if (sessionDate <= covStart || sessionDate > covEnd) return null;
  let cursor = shiftIsoDate(sessionDate, -1);
  while (cursor && cursor >= covStart) {
    const sess = resolveSession(venue, cursor, explicitSpec ? { spec: explicitSpec } : {});
    if (sess.is_trading_day && !sess.blocks_eligibility) {
      return cursor;
    }
    cursor = shiftIsoDate(cursor, -1);
  }
  return null;
}

/**
 * Returns the next verified XNYS trading date strictly after sessionDate, or null if out of coverage.
 */
export function resolveNextTradingDate(sessionDate, options = {}) {
  const opts = options || {};
  const venue = opts.venue || SUPPORTED_EXCHANGE;
  if (venue !== SUPPORTED_EXCHANGE) return null;
  if (!parseIsoDateStrict(sessionDate)) return null;

  const explicitSpec = opts.spec ? loadSpec(opts.spec) : null;
  const allSpecs = explicitSpec ? null : loadAllSpecs();
  const covStart = explicitSpec
    ? explicitSpec.rules.coverage_start_date
    : allSpecs["csa22-v1"].rules.coverage_start_date;
  const covEnd = explicitSpec
    ? explicitSpec.rules.coverage_end_date
    : allSpecs["csa22-v2"].rules.coverage_end_date;

  if (sessionDate < covStart || sessionDate >= covEnd) return null;
  let cursor = shiftIsoDate(sessionDate, 1);
  while (cursor && cursor <= covEnd) {
    const sess = resolveSession(venue, cursor, explicitSpec ? { spec: explicitSpec } : {});
    if (sess.is_trading_day && !sess.blocks_eligibility) {
      return cursor;
    }
    cursor = shiftIsoDate(cursor, 1);
  }
  return null;
}

/**
 * Resolves broker clearing trade date under the US 23/5 post-21:00 ET T+1 boundary,
 * isolating evening clearing activity from T's official close snapshot.
 */
export function resolveClearingTradeDate(timestampUtc, options = {}) {
  const opts = options || {};
  const venue = opts.venue || SUPPORTED_EXCHANGE;
  if (venue !== SUPPORTED_EXCHANGE) {
    return { trade_date: null, clearing_shifted: false, belongs_to_prior_eod: false, reason: "unsupported_venue" };
  }
  const instMs = parseUtcInstantMs(timestampUtc);
  if (instMs === null) {
    return { trade_date: null, clearing_shifted: false, belongs_to_prior_eod: false, reason: "invalid_timestamp" };
  }
  const parts = zonedPartsAtMs(instMs, SUPPORTED_TIMEZONE);
  const localSess = resolveSession(venue, parts.date, opts.spec ? { spec: opts.spec } : {});
  if (localSess.session_state === "unknown") {
    return {
      trade_date: null,
      clearing_shifted: false,
      belongs_to_prior_eod: false,
      reason: localSess.reason,
    };
  }
  if (parts.hhmm >= "21:00") {
    const nextTradeDate = resolveNextTradingDate(parts.date, opts);
    if (!nextTradeDate) {
      return { trade_date: null, clearing_shifted: true, belongs_to_prior_eod: false, reason: "out_of_range" };
    }
    return {
      trade_date: nextTradeDate,
      clearing_shifted: true,
      belongs_to_prior_eod: false,
      reason: "post_2100_et_next_trade_date",
    };
  }
  if (!localSess.is_trading_day || localSess.blocks_eligibility) {
    const nextTradeDate = resolveNextTradingDate(parts.date, opts);
    if (!nextTradeDate) {
      return { trade_date: null, clearing_shifted: true, belongs_to_prior_eod: false, reason: "out_of_range" };
    }
    return {
      trade_date: nextTradeDate,
      clearing_shifted: true,
      belongs_to_prior_eod: false,
      reason: localSess.reason || "non_trading_day_next_trade_date",
    };
  }
  return {
    trade_date: parts.date,
    clearing_shifted: false,
    belongs_to_prior_eod: true,
    reason: "same_trade_date",
  };
}

/**
 * Classifies a UTC timestamp into core RTH vs US 23/5 extended/overnight windows.
 */
export function classifyUsEquitySessionWindow(timestampUtc, calendarSession) {
  const instMs = parseUtcInstantMs(timestampUtc);
  if (instMs === null) return "closed";
  const tz = String(calendarSession?.timezone || SUPPORTED_TIMEZONE);
  const parts = zonedPartsAtMs(instMs, tz);
  const tradeDate = String(calendarSession?.trade_date || "");

  if (parts.hhmm >= "20:00" || parts.hhmm < "04:00") {
    return "extended_overnight_open";
  }
  if (!calendarSession?.is_trading_day || calendarSession?.blocks_eligibility) {
    return "closed";
  }
  if (parts.date > tradeDate) {
    return "next_trade_date_window";
  }
  if (parts.date < tradeDate) {
    return "closed";
  }

  const openMs = parseUtcInstantMs(calendarSession.open_utc);
  const closeMs = parseUtcInstantMs(calendarSession.close_utc);
  if (openMs !== null && closeMs !== null) {
    if (instMs >= openMs && instMs <= closeMs) {
      return "core_session_open";
    }
    if (instMs > closeMs && parts.hhmm < "20:00") {
      return "after_hours_extended";
    }
    if (parts.hhmm >= "04:00" && instMs < openMs) {
      return "pre_market_extended";
    }
    return "closed";
  }

  const closeLocal = String(calendarSession.close_local || "16:00");
  if (parts.hhmm >= "09:30" && parts.hhmm <= closeLocal) {
    return "core_session_open";
  }
  if (parts.hhmm > closeLocal && parts.hhmm < "20:00") {
    return "after_hours_extended";
  }
  if (parts.hhmm >= "04:00" && parts.hhmm < "09:30") {
    return "pre_market_extended";
  }
  return "closed";
}

/**
 * Validates that a bar/snapshot print timestamp belongs to core RTH and not 23/5 overnight or T+1.
 */
export function isOfficialCloseBarTimestamp(timestampUtc, calendarSession) {
  const instMs = parseUtcInstantMs(timestampUtc);
  if (instMs === null) {
    return { valid: false, reason: "invalid_bar_timestamp" };
  }
  const tz = String(calendarSession?.timezone || SUPPORTED_TIMEZONE);
  const parts = zonedPartsAtMs(instMs, tz);
  const tradeDate = String(calendarSession?.trade_date || "");

  if (parts.date > tradeDate) {
    return { valid: false, reason: "next_trade_date_contamination" };
  }
  if (parts.date < tradeDate) {
    return { valid: false, reason: "session_not_in_payload" };
  }
  if (!calendarSession?.is_trading_day || calendarSession?.blocks_eligibility) {
    return { valid: false, reason: "non_trading_session" };
  }

  if (parts.hhmm >= "21:00") {
    return { valid: false, reason: "next_trade_date_contamination" };
  }
  const openMs = parseUtcInstantMs(calendarSession.open_utc);
  const closeMs = parseUtcInstantMs(calendarSession.close_utc);
  if (openMs === null || closeMs === null || instMs < openMs || instMs > closeMs) {
    return { valid: false, reason: "extended_hours_overnight_rejected" };
  }
  return { valid: true, reason: null };
}

/**
 * Builds a runtime calendarProvider compatible with sizing_unit/freshness.js (#15 seam).
 * Defaults to spanning both verified csa22-v1 (2025) and csa22-v2 (2026).
 */
export function createXnysRuntimeProvider(options = {}) {
  const versionOption = options?.version ?? null;
  if (versionOption !== null) {
    const loaded = loadSpec(versionOption);
    return Object.freeze({
      calendar_version: loaded.calendar_version,
      exchange: SUPPORTED_EXCHANGE,
      spec_digest: loaded.spec_digest,
      is_pinned: true,
      coverage() {
        return {
          start_date: loaded.rules.coverage_start_date,
          end_date: loaded.rules.coverage_end_date,
        };
      },
      getSession(tradeDate) {
        if (typeof tradeDate !== "string") return null;
        return resolveSession(SUPPORTED_EXCHANGE, tradeDate, { spec: loaded });
      },
    });
  }

  const all = loadAllSpecs();
  const versionDigests = Object.freeze({
    "csa22-v1": all["csa22-v1"].spec_digest,
    "csa22-v2": all["csa22-v2"].spec_digest,
  });
  return Object.freeze({
    calendar_version: "csa22-v2",
    calendar_versions: Object.freeze(["csa22-v1", "csa22-v2"]),
    version_digests: versionDigests,
    exchange: SUPPORTED_EXCHANGE,
    spec_digest: all["csa22-v2"].spec_digest,
    is_pinned: true,
    coverage() {
      return {
        start_date: all["csa22-v1"].rules.coverage_start_date,
        end_date: all["csa22-v2"].rules.coverage_end_date,
      };
    },
    getSession(tradeDate) {
      if (typeof tradeDate !== "string") return null;
      return resolveSession(SUPPORTED_EXCHANGE, tradeDate);
    },
  });
}
