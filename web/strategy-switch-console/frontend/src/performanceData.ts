import { loadAccountFactsHistory, loadBinanceWalletHistory } from "./api.ts";
import { amountToUsd, parseMoneyForChart } from "./presentation.ts";
import { aggregateEquity } from "./performanceMath.ts";
import type { AccountEquity, EquityPoint } from "./performanceMath.ts";
import type { OverviewAccount } from "./OverviewPage";

export type PerformanceData = {
  accounts: AccountEquity[];
  failed: string[];
  omittedCurrencies: string[];
  truncated: boolean;
  referenceFx: boolean;
  incompleteDates: number;
};

/** Only existing same-origin history GETs; no current snapshot backfill. */
export async function loadPerformanceData(
  accounts: readonly OverviewAccount[],
  rates: Readonly<Record<string, string>>,
  loaders = { account: loadAccountFactsHistory, wallet: loadBinanceWalletHistory },
): Promise<PerformanceData> {
  const failed: string[] = [];
  const omittedCurrencies = new Set<string>();
  let truncated = false;
  let referenceFx = false;
  let incompleteDates = 0;
  const rows = await Promise.all(accounts.map(async account => {
    try {
      if (account.platformKey === "binance") {
        const payload = await loaders.wallet(account.accountKey);
        if (payload.currency !== "USDT" || !Array.isArray(payload.points)) throw new Error("invalid_wallet_history");
        return { id: account.id, crypto: true, points: payload.points.flatMap(p => {
          const value = parseMoneyForChart(p.amount);
          return value === null ? [] : [{ date: p.observation_date, value, externalFlow: null, breakBefore: p.break_before }];
        }) };
      }
      const currencies = [...new Set((account.facts?.balances || []).map(b => b.currency).filter(Boolean))];
      if (!currencies.length) throw new Error("missing_currency");
      const parts = await Promise.all(currencies.map(async currency => {
        const payload = await loaders.account(account.platformKey, account.accountKey, currency);
        if (payload.identity_mismatch || payload.platform !== account.platformKey || payload.account_key !== account.accountKey
          || payload.series?.currency !== currency) throw new Error("history_identity_mismatch");
        truncated ||= payload.series.truncated === true;
        if (amountToUsd(currency, "1", rates) === null) { omittedCurrencies.add(currency); return { id: currency, points: [] }; }
        referenceFx ||= currency !== "USD" && currency !== "USDT";
        const points: EquityPoint[] = (payload.series.points || []).flatMap(p => {
          if (p.currency !== currency) return [];
          const converted = amountToUsd(currency, p.net_assets, rates);
          const value = converted === null ? null : parseMoneyForChart(converted);
          // This API does not supply external cash-flow coverage. Never infer
          // flows from total_cash, orders, or differences between valuations.
          return value === null ? [] : [{ date: p.observation_date, value, externalFlow: null }];
        });
        return { id: currency, points };
      }));
      // Exclude an account with a missing currency instead of understating it.
      if (parts.some(p => !p.points.length)) throw new Error("incomplete_currency_history");
      const combined = aggregateEquity(parts);
      incompleteDates += combined.omittedDates;
      return { id: account.id, points: combined.points };
    } catch {
      failed.push(account.id);
      return { id: account.id, points: [] };
    }
  }));
  return { accounts: rows, failed, omittedCurrencies: [...omittedCurrencies].sort(), truncated, referenceFx, incompleteDates };
}
