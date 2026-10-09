/** Overview USD reporting: live FX (Frankfurter) + two-decimal display. Fail closed on fetch errors. */

const MONEY_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

/** Frankfurter ECB reference feed (no API key). Quotes are USD→foreign; we invert to foreign→USD. */
export const OVERVIEW_FX_SOURCE = "api.frankfurter.dev (ECB reference rates via Frankfurter)";
export const OVERVIEW_FX_API_URL =
  "https://api.frankfurter.dev/v1/latest?base=USD&symbols=CNY,EUR,HKD,SGD";
export const OVERVIEW_FX_SYMBOLS = Object.freeze(["CNY", "EUR", "HKD", "SGD"] as const);
/** Brief in-memory cache; omit currencies on fetch failure (fail closed). */
export const OVERVIEW_FX_CACHE_MS = 60 * 60 * 1000;

function reciprocalDecimal(quote: string, places = 12): string | null {
  if (typeof quote !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(quote)) return null;
  if (/^0+(?:\.0+)?$/.test(quote)) return null;
  const [integer, fraction = ""] = quote.split(".");
  const scale = fraction.length;
  const denom = BigInt(integer + fraction);
  if (denom === 0n) return null;
  const numer = 10n ** BigInt(scale + places);
  const quot = numer / denom;
  const rem = numer % denom;
  const rounded = rem * 2n >= denom ? quot + 1n : quot;
  const digits = rounded.toString().padStart(places + 1, "0");
  const amount = `${digits.slice(0, -places)}.${digits.slice(-places)}`.replace(/\.?0+$/, "");
  if (amount === "" || amount === "0" || amount === ".") return null;
  return amount.endsWith(".") ? amount.slice(0, -1) : amount;
}

/** Round a decimal money string half-up to a fixed number of fraction digits. */
export function roundDecimalHalfUp(amount: string, places: number): string | null {
  if (typeof amount !== "string" || amount.length > 128 || !MONEY_RE.test(amount)) return null;
  if (!Number.isInteger(places) || places < 0 || places > 18) return null;
  const negative = amount.startsWith("-");
  const [integer, fraction = ""] = amount.replace(/^-/, "").split(".");
  if (fraction.length <= places) {
    const padded = fraction.padEnd(places, "0");
    return places === 0
      ? `${negative ? "-" : ""}${integer || "0"}`
      : `${negative ? "-" : ""}${integer || "0"}.${padded}`;
  }
  const keep = fraction.slice(0, places);
  const nextDigit = fraction.charAt(places);
  let digits = BigInt((integer || "0") + keep);
  if (nextDigit >= "5") digits += 1n;
  const str = digits.toString().padStart(places + 1, "0");
  const out = places === 0
    ? `${negative ? "-" : ""}${str}`
    : `${negative ? "-" : ""}${str.slice(0, -places)}.${str.slice(-places)}`;
  if (out === "-0" || out === `-0.${"0".repeat(places)}`) {
    return places === 0 ? "0" : `0.${"0".repeat(places)}`;
  }
  return out;
}

/** Overview home-card USD figure: exactly two decimal places with thousands separators. */
export function formatOverviewUsdAmount(amount: string): string {
  const rounded = roundDecimalHalfUp(amount, 2);
  if (rounded === null) return amount;
  const match = /^(-?)(\d+)\.(\d{2})$/.exec(rounded);
  if (!match) return rounded;
  return `${match[1]}${match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${match[3]}`;
}

/**
 * Parse a Frankfurter latest payload (base USD) into currency→USD multipliers.
 * CNH reuses the CNY onshore reference when present. Invalid/missing quotes are skipped.
 */
export function parseFrankfurterUsdBaseRates(payload: unknown): Readonly<Record<string, string>> {
  if (!payload || typeof payload !== "object") return Object.freeze({});
  const body = payload as { base?: unknown; rates?: unknown };
  if (body.base !== "USD" || !body.rates || typeof body.rates !== "object" || Array.isArray(body.rates)) {
    return Object.freeze({});
  }
  const rates: Record<string, string> = {};
  for (const [code, value] of Object.entries(body.rates as Record<string, unknown>)) {
    if (!/^[A-Z]{3}$/.test(code)) continue;
    const quote = typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : typeof value === "string"
        ? value
        : null;
    if (!quote) continue;
    const multiplier = reciprocalDecimal(quote);
    if (!multiplier) continue;
    rates[code] = multiplier;
  }
  if (rates.CNY && !rates.CNH) rates.CNH = rates.CNY;
  return Object.freeze(rates);
}

type OverviewFxCache = { at: number; rates: Readonly<Record<string, string>> };
let overviewFxCache: OverviewFxCache | null = null;
let overviewFxInflight: Promise<Readonly<Record<string, string>>> | null = null;

/** Clear the in-memory Frankfurter cache (tests). */
export function resetOverviewUsdRatesCache(): void {
  overviewFxCache = null;
  overviewFxInflight = null;
}

/**
 * Fetch live overview FX multipliers. Fail closed: network/parse errors yield {}.
 * Results cache briefly in memory; callers still omit any currency absent from the map.
 */
export async function loadOverviewUsdRates(
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
): Promise<Readonly<Record<string, string>>> {
  if (overviewFxCache && now - overviewFxCache.at < OVERVIEW_FX_CACHE_MS) {
    return overviewFxCache.rates;
  }
  if (overviewFxInflight) return overviewFxInflight;
  overviewFxInflight = (async () => {
    try {
      const response = await fetchImpl(OVERVIEW_FX_API_URL, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) return Object.freeze({});
      const payload = await response.json();
      const rates = parseFrankfurterUsdBaseRates(payload);
      overviewFxCache = { at: Date.now(), rates };
      return rates;
    } catch {
      return Object.freeze({});
    } finally {
      overviewFxInflight = null;
    }
  })();
  return overviewFxInflight;
}
