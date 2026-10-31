import type { ScopeOption } from "../../app/context";

/** US-listed benchmarks that are relevant to the equity pilots by default. */
export const DEFAULT_BENCHMARKS = ["纳斯达克100", "标普500"] as const;

export type BenchmarkScopeReason = "crypto" | "mixed" | null;

export interface BenchmarkPolicy {
  enabled: boolean;
  reason: BenchmarkScopeReason;
  defaults: readonly string[];
}

/**
 * Crypto (7×24, USDT) is never compared with US equity indices. A scope that mixes
 * crypto and equity accounts also has no single relevant market index. Everything
 * else defaults to one or two US benchmarks; the remaining ones stay opt-in.
 */
export function benchmarkPolicy(
  scope: string,
  platform: string | undefined,
  options: readonly ScopeOption[],
): BenchmarkPolicy {
  let platforms: string[];
  if (scope === "all") {
    // An unknown environment is not evidence of a live account, so only accounts
    // the directory declares as non-paper form the live basis.
    const live = options.filter(option => option.paper === false);
    const basis = live.length > 0 ? live : options;
    platforms = basis.map(option => option.platform);
  } else {
    const parsed = platform || scope.slice(0, Math.max(0, scope.indexOf(":")));
    platforms = parsed ? [parsed] : [];
  }
  platforms = [...new Set(platforms.filter(Boolean))];
  const hasCrypto = platforms.includes("binance");
  const hasEquity = platforms.some(item => item !== "binance");
  if (hasCrypto) {
    return { enabled: false, reason: hasEquity ? "mixed" : "crypto", defaults: [] };
  }
  return { enabled: true, reason: null, defaults: DEFAULT_BENCHMARKS };
}

/** Benchmarks compare in USD; USDT (crypto) and other native currencies stay unbenchmarked. */
export function benchmarkCurrencyAllowed(currency: string | null | undefined): boolean {
  return !currency || currency === "USD";
}
