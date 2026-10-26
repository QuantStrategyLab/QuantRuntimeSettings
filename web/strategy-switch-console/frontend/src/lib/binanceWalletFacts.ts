import type {
  BinanceAccountFactsAsset,
  BinanceAccountFactsReport,
  BinanceAccountFactsReportStatus,
} from "../api/contracts";

/** Fixed producer identity of the wallet rollup; a different source or scope is not this fact. */
export const BINANCE_WALLET_SOURCE = "GET /sapi/v1/asset/wallet/balance";
export const BINANCE_WALLET_SCOPE = "provider_returned_wallet_rows";
export const BINANCE_FACTS_SCOPE = "spot+flexible_earn";

/** Independent read state of the dedicated endpoint, carried alongside the generic facts view. */
export interface BinanceFactsView {
  phase: "loading" | "error" | "ready";
  status: BinanceAccountFactsReportStatus | null;
  report: BinanceAccountFactsReport | null;
}

export type BinanceWalletValuationDisplay =
  | { kind: "available"; amount: string; currency: "USDT"; observedAt: string }
  | { kind: "none"; invalid?: boolean; reason?: string };

export type BinanceWalletState =
  | { kind: "loading" }
  | { kind: "read_failed" }
  | { kind: "no_data" }
  | { kind: "pending" }
  | { kind: "unavailable" }
  | { kind: "ready"; assetCount: number; observedAt: string; valuation: BinanceWalletValuationDisplay };

/** Non-negative decimal text only; a number, a sign, or an exponent is not a legal amount. */
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
/** Accepted instant shape, compared as real time. */
const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

function isDecimal(value: unknown): value is string {
  return typeof value === "string" && DECIMAL.test(value);
}

function isNonZero(text: string): boolean {
  return /[1-9]/.test(text);
}

function instantMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = INSTANT.exec(value);
  if (!match) return null;
  if (Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59) return null;
  if (match[7] !== "Z") {
    const [hours, minutes] = match[7].slice(1).split(":");
    if (Number(hours) > 23 || Number(minutes) > 59) return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validAsset(value: unknown): value is BinanceAccountFactsAsset {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.asset === "string" && row.asset.length > 0
    && isDecimal(row.quantity) && isDecimal(row.spot_free)
    && isDecimal(row.spot_locked) && isDecimal(row.flexible_earn);
}

/**
 * Consumption-side check of the wallet rollup. Only the fixed source/scope,
 * USDT, a non-negative decimal string, a plausible wallet count, and an
 * observation instant no later than the report are displayable. Anything else
 * is unavailable, never a zero.
 */
function readValuation(raw: unknown, reportFinishedMs: number): BinanceWalletValuationDisplay {
  if (raw === undefined) return { kind: "none" };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { kind: "none", invalid: true };
  const valuation = raw as Record<string, unknown>;
  if (valuation.status === "unavailable") {
    return {
      kind: "none",
      reason: typeof valuation.reason_code === "string" ? valuation.reason_code : undefined,
    };
  }
  if (valuation.status !== "available") return { kind: "none", invalid: true };
  const amount = valuation.amount;
  const walletCount = valuation.wallet_count;
  const observedAt = typeof valuation.observed_at === "string" ? valuation.observed_at : null;
  const observedMs = observedAt === null ? null : instantMs(observedAt);
  if (valuation.source !== BINANCE_WALLET_SOURCE
      || valuation.scope !== BINANCE_WALLET_SCOPE
      || valuation.currency !== "USDT"
      || !isDecimal(amount)
      || typeof walletCount !== "number" || !Number.isInteger(walletCount)
      || walletCount < 1 || walletCount > 32
      || observedAt === null || observedMs === null
      || observedMs > reportFinishedMs) {
    return { kind: "none", invalid: true };
  }
  return { kind: "available", amount, currency: "USDT", observedAt };
}

/**
 * Repeated directory rows for one key share a card. Distinct keys cannot borrow
 * one report even when their display selectors happen to be identical.
 */
export function cardAccountKey(
  rows: { platform: string; account_alias: string }[],
  platform: string,
): string | null {
  const keys = new Set(rows.filter(row => row.platform === platform).map(row => row.account_alias));
  return keys.size === 1 ? [...keys][0]! : null;
}

/**
 * Resolve the dedicated report for exactly one card. The join is platform plus
 * the exact account_key — never an alias prefix, list order, or "only one
 * account" guess. A report for another key is simply not this card's data, so
 * its count, time, and amount never reach the current card.
 */
export function resolveBinanceWallet(
  view: BinanceFactsView,
  platform: string,
  accountKey: string | null,
): BinanceWalletState {
  if (platform !== "binance") return { kind: "no_data" };
  if (view.phase === "loading") return { kind: "loading" };
  if (view.phase === "error") return { kind: "read_failed" };
  if (view.status === "missing") return { kind: "no_data" };
  if (view.status === "expired") return { kind: "pending" };
  if (view.status !== "available") return { kind: "unavailable" };
  const report = view.report;
  if (!report || typeof report !== "object") return { kind: "unavailable" };
  if (!accountKey) return { kind: "unavailable" };
  if (report.platform !== "binance") return { kind: "unavailable" };
  if (report.account_key !== accountKey) return { kind: "no_data" };
  if (report.scope !== BINANCE_FACTS_SCOPE) return { kind: "unavailable" };
  const finishedMs = instantMs(report.observed_finished_at);
  if (finishedMs === null || !Array.isArray(report.assets)) return { kind: "unavailable" };
  if (!report.assets.every(validAsset)) return { kind: "unavailable" };
  return {
    kind: "ready",
    assetCount: report.assets.filter(asset => isNonZero(asset.quantity)).length,
    observedAt: report.observed_finished_at,
    valuation: readValuation(report.wallet_valuation, finishedMs),
  };
}
