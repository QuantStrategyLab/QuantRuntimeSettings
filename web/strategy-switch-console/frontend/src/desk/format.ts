/**
 * Desk number and time formatting. Pure string arithmetic on decimal strings so
 * money never passes through a float. Every function returns `null` for a missing
 * or malformed input: callers render that through `Read`, so a missing value can
 * never print as 0, "0.00%" or "0m".
 */

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

interface Parts {
  negative: boolean;
  int: string;
  frac: string;
}

function parse(value: unknown): Parts | null {
  if (typeof value !== "string") return null;
  const match = DECIMAL.exec(value);
  if (!match) return null;
  return { negative: match[1] === "-", int: match[2], frac: match[3] ?? "" };
}

/** Round half away from zero to `digits` places, still as strings. */
function round(parts: Parts, digits: number): Parts {
  const padded = parts.int + parts.frac.padEnd(digits + 1, "0");
  const cut = parts.int.length + digits;
  const kept = BigInt(padded.slice(0, cut)) + (padded[cut] >= "5" ? 1n : 0n);
  const text = kept.toString().padStart(digits + 1, "0");
  const int = digits === 0 ? text : text.slice(0, -digits);
  const frac = digits === 0 ? "" : text.slice(-digits);
  const zero = /^0*$/.test(int + frac);
  return { negative: parts.negative && !zero, int, frac };
}

function group(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

const SYMBOLS: Record<string, string> = { USD: "$", HKD: "HK$", CNY: "¥", USDT: "USDT " };

export interface MoneyOptions {
  /** Default 0, which suits NAV; pass 2 for prices. */
  digits?: number;
  /** Prefix + for positive amounts (day change). */
  signed?: boolean;
}

/** "412380.55" + "USD" -> "$412,381". */
export function formatMoney(amount: unknown, currency: unknown, options: MoneyOptions = {}): string | null {
  const parts = parse(amount);
  if (!parts || typeof currency !== "string" || currency === "") return null;
  const rounded = round(parts, options.digits ?? 0);
  const symbol = SYMBOLS[currency] ?? `${currency} `;
  const sign = rounded.negative ? "-" : options.signed && !/^0*$/.test(rounded.int + rounded.frac) ? "+" : "";
  return `${sign}${symbol}${group(rounded.int)}${rounded.frac ? `.${rounded.frac}` : ""}`;
}

/** Plain grouped decimal without a currency: "1189800.00" -> "1,189,800.00". */
export function formatNumber(value: unknown, digits = 2): string | null {
  const parts = parse(value);
  if (!parts) return null;
  const rounded = round(parts, digits);
  return `${rounded.negative ? "-" : ""}${group(rounded.int)}${rounded.frac ? `.${rounded.frac}` : ""}`;
}

export type Direction = "up" | "down" | "flat";

export interface RatioText {
  /** Digits and percent sign, with a minus for negatives: "1.84%". */
  text: string;
  direction: Direction;
  /** Glyph so direction never relies on colour alone. */
  glyph: "▲" | "▼" | "–";
}

/** A ratio string ("0.0184") scaled to a percentage ("1.84%") by moving the point, not by float maths. */
export function formatRatio(ratio: unknown, digits = 2): RatioText | null {
  const parts = parse(ratio);
  if (!parts) return null;
  const frac = parts.frac.padEnd(2, "0");
  const shifted: Parts = {
    negative: parts.negative,
    int: (parts.int + frac.slice(0, 2)).replace(/^0+(?=\d)/, ""),
    frac: frac.slice(2),
  };
  const rounded = round(shifted, digits);
  const zero = /^0*$/.test(rounded.int + rounded.frac);
  const direction: Direction = zero ? "flat" : rounded.negative ? "down" : "up";
  const body = `${group(rounded.int)}${rounded.frac ? `.${rounded.frac}` : ""}%`;
  return {
    text: rounded.negative ? `-${body}` : body,
    direction,
    glyph: direction === "up" ? "▲" : direction === "down" ? "▼" : "–",
  };
}

/** Same as formatRatio but with an explicit + for gains ("+1.84%"). */
export function formatSignedRatio(ratio: unknown, digits = 2): string | null {
  const formatted = formatRatio(ratio, digits);
  if (!formatted) return null;
  return formatted.direction === "up" ? `+${formatted.text}` : formatted.text;
}

type Translator = (key: string, params?: Record<string, string | number>) => string;

/**
 * Compact age: "6h 12m", "3d 04h", "45s". Rounds down; negative or non-integer
 * input is rejected rather than clamped, because a negative age means a bad clock.
 */
export function formatAge(seconds: unknown, t: Translator): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return null;
  const total = Math.floor(seconds);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return t("desk.age.dh", { d: days, h: String(hours).padStart(2, "0") });
  if (hours > 0) return t("desk.age.hm", { h: hours, m: String(minutes).padStart(2, "0") });
  if (minutes > 0) return t("desk.age.m", { m: minutes });
  return t("desk.age.s", { s: total });
}

function utcDate(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const two = (n: number) => String(n).padStart(2, "0");

/** "2026-11-02T14:26:00Z" -> "14:26". Times are shown in UTC; the label says so elsewhere. */
export function formatUtcHm(iso: unknown): string | null {
  const date = utcDate(iso);
  return date ? `${two(date.getUTCHours())}:${two(date.getUTCMinutes())}` : null;
}

/** "2026-11-02T14:32:07Z" -> "14:32:07". */
export function formatUtcHms(iso: unknown): string | null {
  const date = utcDate(iso);
  return date ? `${two(date.getUTCHours())}:${two(date.getUTCMinutes())}:${two(date.getUTCSeconds())}` : null;
}

/** "2026-11-02T14:32:07Z" -> "2026-11-02". */
export function formatUtcDate(iso: unknown): string | null {
  const date = utcDate(iso);
  return date ? `${date.getUTCFullYear()}-${two(date.getUTCMonth() + 1)}-${two(date.getUTCDate())}` : null;
}

/** Server clock offset in ms (server minus client) so the header clock ignores browser skew. */
export function clockOffsetMs(serverTime: unknown, clientNowMs: number): number | null {
  const date = utcDate(serverTime);
  return date ? date.getTime() - clientNowMs : null;
}

/** Server-adjusted "now" as an ISO string; falls back to the raw client clock when no offset is known. */
export function serverNowIso(offsetMs: number | null, clientNowMs: number): string {
  return new Date(clientNowMs + (offsetMs ?? 0)).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Whole seconds between two instants (later minus earlier), or null if either is malformed. */
export function secondsBetween(earlier: unknown, later: unknown): number | null {
  const a = utcDate(earlier);
  const b = utcDate(later);
  return a && b ? Math.floor((b.getTime() - a.getTime()) / 1000) : null;
}
