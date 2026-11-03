import type { Language } from "../../lib/prefs";

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Ratio -> "+12.3%" / "−4.5%" (true minus sign); null -> "—". Never prints a missing value as 0. */
export function formatPct(ratio: number | null, digits = 1, signed = true): string {
  if (ratio === null || !Number.isFinite(ratio)) return "—";
  const text = Math.abs(ratio * 100).toFixed(digits);
  const zero = Number(text) === 0;
  return `${zero ? "" : ratio < 0 ? "−" : signed ? "+" : ""}${text}%`;
}

/** Points -> "+3.5" / "−7.6"; null -> "—". */
export function formatPts(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const text = Math.abs(value).toFixed(digits);
  return `${Number(text) === 0 ? "" : value < 0 ? "−" : "+"}${text}`;
}

/** en "31 Oct 2025", zh "2025-10-31". */
export function formatDate(date: string, language: Language): string {
  if (language === "zh") return date;
  const [year, month, day] = date.split("-").map(Number);
  return `${day} ${MONTHS_EN[month - 1]} ${year}`;
}

/** Axis month: en "Nov 23", zh "23年11月". */
export function formatMonth(date: string, language: Language): string {
  const [year, month] = date.split("-").map(Number);
  const yy = String(year % 100).padStart(2, "0");
  return language === "zh" ? `${yy}年${month}月` : `${MONTHS_EN[month - 1]} ${yy}`;
}

/** Short axis day for windows under two months: en "3 Nov", zh "11-03". */
export function formatDay(date: string, language: Language): string {
  const [, month, day] = date.split("-").map(Number);
  return language === "zh" ? `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : `${day} ${MONTHS_EN[month - 1]}`;
}
