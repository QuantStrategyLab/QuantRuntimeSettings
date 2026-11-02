/**
 * Desk number and time formatting. Money and ratios are decimal strings and are formatted
 * with string arithmetic, so they never pass through a float. Every function returns null
 * for missing or malformed input; callers render null through the Read/unknown path, so a
 * missing value can never print as 0, "0.00%" or "0 min".
 */
import type { Language } from "../lib/prefs";
import { deskTranslate } from "./i18n/index.ts";

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
  return { negative: match[1] === "-", int: match[2].replace(/^0+(?=\d)/, ""), frac: match[3] ?? "" };
}

const isZero = (parts: Parts) => /^0*$/.test(parts.int + parts.frac);

/** Round half away from zero to `digits` places, on strings. */
function round(parts: Parts, digits: number): Parts {
  const padded = parts.int + parts.frac.padEnd(digits + 1, "0");
  const cut = parts.int.length + digits;
  const kept = BigInt(padded.slice(0, cut) || "0") + (padded[cut] >= "5" ? 1n : 0n);
  const text = kept.toString().padStart(digits + 1, "0");
  const rounded = { negative: parts.negative, int: digits ? text.slice(0, -digits) : text, frac: digits ? text.slice(-digits) : "" };
  return { ...rounded, negative: parts.negative && !isZero(rounded) };
}

const group = (int: string) => int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const body = (parts: Parts) => `${group(parts.int)}${parts.frac ? `.${parts.frac}` : ""}`;

const SYMBOLS: Record<string, string> = { USD: "$", HKD: "HK$", CNY: "¥" };

export interface MoneyOptions {
  /** Decimal places; default 2. */
  digits?: number;
  /** Prefix + on gains (day change). */
  signed?: boolean;
}

/** ("1189800", "USD") -> "$1,189,800.00"; unknown currencies use the code: "USDT 78,070.00". */
export function formatMoney(amount: unknown, currency: unknown, options: MoneyOptions = {}): string | null {
  const parts = parse(amount);
  if (!parts || typeof currency !== "string" || !/^[A-Z]{3,4}$/.test(currency)) return null;
  const rounded = round(parts, options.digits ?? 2);
  const symbol = SYMBOLS[currency] ?? `${currency} `;
  const sign = rounded.negative ? "−" : options.signed && !isZero(rounded) ? "+" : "";
  return `${sign}${symbol}${body(rounded)}`;
}

/** Split for display type: "$", "1,189,800", ".00" (the hero figure styles each part). */
export function moneyParts(amount: unknown, currency: unknown, digits = 2): { sign: string; symbol: string; whole: string; cents: string } | null {
  const parts = parse(amount);
  if (!parts || typeof currency !== "string" || !/^[A-Z]{3,4}$/.test(currency)) return null;
  const rounded = round(parts, digits);
  return {
    sign: rounded.negative ? "−" : "",
    symbol: SYMBOLS[currency] ?? `${currency} `,
    whole: group(rounded.int),
    cents: rounded.frac ? `.${rounded.frac}` : "",
  };
}

/** Grouped decimal without a currency: "18200" -> "18,200". */
export function formatDecimal(value: unknown, digits = 0): string | null {
  const parts = parse(value);
  if (!parts) return null;
  const rounded = round(parts, digits);
  return `${rounded.negative ? "−" : ""}${body(rounded)}`;
}

export type Direction = "up" | "down" | "flat";

export interface RatioText {
  /** Signed percentage: "+1.84%", "−0.62%", "0.00%". */
  text: string;
  direction: Direction;
  /** Direction never relies on colour alone. */
  glyph: "▲" | "▼" | "–";
}

/** Shift the decimal point two places: "0.0184" -> 1.84 (as Parts), no float maths. */
function percentParts(parts: Parts): Parts {
  const frac = parts.frac.padEnd(2, "0");
  return { negative: parts.negative, int: (parts.int + frac.slice(0, 2)).replace(/^0+(?=\d)/, ""), frac: frac.slice(2) };
}

/** A ratio string scaled to percent: "0.0184" -> "+1.84%". `signed: false` drops the +. */
export function formatRatio(ratio: unknown, digits = 2, signed = true): RatioText | null {
  const parts = parse(ratio);
  if (!parts) return null;
  const rounded = round(percentParts(parts), digits);
  const direction: Direction = isZero(rounded) ? "flat" : rounded.negative ? "down" : "up";
  const sign = direction === "down" ? "−" : direction === "up" && signed ? "+" : "";
  return { text: `${sign}${body(rounded)}%`, direction, glyph: direction === "up" ? "▲" : direction === "down" ? "▼" : "–" };
}

/**
 * Share of a limit used, for the drawdown ring: (-0.062, -0.15) -> 41. Integer percent,
 * clamped to 0..100. Uses Number only on the final, already-validated ratio.
 */
export function limitUsedPercent(ratio: unknown, limit: unknown): number | null {
  const value = parse(ratio);
  const cap = parse(limit);
  if (!value || !cap || isZero(cap)) return null;
  const used = Math.abs(Number(`${value.int}.${value.frac || "0"}`)) / Math.abs(Number(`${cap.int}.${cap.frac || "0"}`));
  if (!Number.isFinite(used)) return null;
  return Math.max(0, Math.min(100, Math.round(used * 100)));
}

/**
 * Compact age in the UI language: zh "3 小时 12 分", en "3 h 12 m". Rounds down. A negative
 * or non-finite age means a bad clock and returns null instead of being clamped to 0.
 */
export function formatAge(seconds: unknown, language: Language): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return null;
  const total = Math.floor(seconds);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return deskTranslate(language, "age.dh", { d: days, h: two(hours) });
  if (hours > 0) return deskTranslate(language, "age.hm", { h: hours, m: two(minutes) });
  if (minutes > 0) return deskTranslate(language, "age.m", { m: minutes });
  return deskTranslate(language, "age.s", { s: total });
}

/** "6 分钟前" / "6 min ago". */
export function formatAgo(seconds: unknown, language: Language): string | null {
  const age = formatAge(seconds, language);
  return age === null ? null : deskTranslate(language, "age.ago", { age });
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

function utcDate(value: unknown): Date | null {
  if (typeof value !== "string" || !ISO_UTC.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const two = (n: number) => String(n).padStart(2, "0");

/** "2026-11-02T14:26:00Z" -> "14:26". Times are UTC; labels say so. */
export function formatUtcHm(iso: unknown): string | null {
  const date = utcDate(iso);
  return date ? `${two(date.getUTCHours())}:${two(date.getUTCMinutes())}` : null;
}

/** "2026-11-02T14:32:07Z" -> "14:32:07". */
export function formatUtcHms(iso: unknown): string | null {
  const date = utcDate(iso);
  return date ? `${formatUtcHm(iso)}:${two(date.getUTCSeconds())}` : null;
}

const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Header date in UTC: zh "11月2日 周一", en "Mon 2 Nov". */
export function formatUtcDayLabel(iso: unknown, language: Language): string | null {
  const date = utcDate(iso);
  if (!date) return null;
  const weekday = deskTranslate(language, `weekday.${date.getUTCDay()}` as "weekday.0");
  const month = language === "zh" ? String(date.getUTCMonth() + 1) : EN_MONTHS[date.getUTCMonth()];
  return deskTranslate(language, "date.month_day", { month, day: date.getUTCDate(), weekday });
}

/** Server minus client clock, in ms, so the header clock ignores browser skew. */
export function clockOffsetMs(serverTime: unknown, clientNowMs: number): number | null {
  const date = utcDate(serverTime);
  return date ? date.getTime() - clientNowMs : null;
}

/** Server-adjusted now as ISO; with no known offset it is the client clock. */
export function serverNowIso(offsetMs: number | null, clientNowMs: number): string {
  return new Date(clientNowMs + (offsetMs ?? 0)).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Whole seconds from `earlier` to `later`, or null if either is malformed. */
export function secondsBetween(earlier: unknown, later: unknown): number | null {
  const a = utcDate(earlier);
  const b = utcDate(later);
  return a && b ? Math.floor((b.getTime() - a.getTime()) / 1000) : null;
}
