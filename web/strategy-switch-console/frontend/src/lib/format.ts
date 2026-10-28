import type { Language } from "./prefs";

const numberFormatters = new Map<string, Intl.NumberFormat>();
const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function localeTag(language: Language): string {
  return language === "zh" ? "zh-CN" : "en-US";
}

function numberFormatter(language: Language, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${language}:${JSON.stringify(options)}`;
  let formatter = numberFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(localeTag(language), options);
    numberFormatters.set(key, formatter);
  }
  return formatter;
}

/** Signed percentage with two decimals, e.g. +1.25% / -0.40%. */
export function formatPercent(value: number | null | undefined, language: Language, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${numberFormatter(language, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(value))}%`;
}

/** Signed basis-point style difference, e.g. +0.85 pp. */
export function formatPercentagePoints(value: number | null | undefined, language: Language): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${numberFormatter(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(value))} pp`;
}

export function formatMoney(value: number | null | undefined, currency: string | null | undefined, language: Language): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const formatted = numberFormatter(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  return currency ? `${currency} ${formatted}` : formatted;
}

const DECIMAL_TEXT = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

/**
 * Hidden amount placeholder: a real negative keeps its sign as −••• so a cash
 * deficit is not mistaken for a positive balance; positive and zero stay •••.
 * Missing or invalid values stay an em dash, never a signed or zero amount.
 * Decimal strings are validated in place and never converted to a number.
 */
export function maskedAmount(value: number | string | null | undefined): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "—";
    return value < 0 ? "−•••" : "•••";
  }
  if (typeof value !== "string" || !DECIMAL_TEXT.test(value)) return "—";
  return value.startsWith("-") && /[1-9]/.test(value) ? "−•••" : "•••";
}

export function formatQuantity(value: number | null | undefined, language: Language): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return numberFormatter(language, { maximumFractionDigits: 6 }).format(value);
}

export function formatPlainNumber(value: number | null | undefined, language: Language, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return numberFormatter(language, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Date-only values render without a timezone shift; timestamps render in the browser zone. */
export function formatDate(value: string | null | undefined, language: Language): string {
  if (!value) return "—";
  if (ISO_DATE.test(value)) return value;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "—";
  const key = `${language}:date`;
  let formatter = dateFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(localeTag(language), { year: "numeric", month: "2-digit", day: "2-digit" });
    dateFormatters.set(key, formatter);
  }
  return formatter.format(new Date(time));
}

/** Business dates stay dates; timestamps use the browser zone and may include the year. */
export function formatDateTime(value: string | null | undefined, language: Language, includeYear = false): { text: string; zone: string } {
  if (!value) return { text: "—", zone: "" };
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return { text: "—", zone: "" };
  if (ISO_DATE.test(value)) return { text: formatDate(value, language), zone: "" };
  const date = new Date(time);
  const key = `${language}:datetime:${includeYear}`;
  let formatter = dateFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(localeTag(language), { year: includeYear ? "numeric" : undefined, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "shortOffset" });
    dateFormatters.set(key, formatter);
  }
  const parts = formatter.formatToParts(date);
  const zone = parts.find(part => part.type === "timeZoneName")?.value || "";
  const text = parts.filter(part => part.type !== "timeZoneName").map(part => part.value).join("").trim();
  return { text, zone };
}

export function relativeFreshness(value: string | null | undefined, language: Language): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
  if (seconds < 60) return language === "zh" ? "刚刚" : "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return language === "zh" ? `${minutes} 分钟前` : `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return language === "zh" ? `${hours} 小时前` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return language === "zh" ? `${days} 天前` : `${days}d ago`;
}
