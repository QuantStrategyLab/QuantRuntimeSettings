import { usePrefs } from "../app/context";
import { useT } from "../i18n";
import { formatMoneyText } from "../lib/accountFacts";
import type { BinanceFactsView } from "../lib/binanceWalletFacts";
import { resolveBinanceWallet } from "../lib/binanceWalletFacts";
import { maskedAmount } from "../lib/format";
import { AsOfStamp, Skeleton } from "./primitives";

const SHORT_STATE: Record<"read_failed" | "no_data" | "pending" | "unavailable", string> = {
  read_failed: "facts.wallet_read_failed",
  no_data: "facts.wallet_no_data",
  pending: "facts.wallet_pending",
  unavailable: "facts.wallet_unavailable",
};

/** Exact decimal-text wallet amount; hiding masks the digits and never fabricates a value. */
function WalletAmount({ amount }: { amount: string }) {
  const { prefs } = usePrefs();
  if (prefs.hideAmounts) return <span className="money">{maskedAmount(amount)}</span>;
  return <span className="money flat">{formatMoneyText(amount, null)}</span>;
}

/**
 * Dedicated wallet rollup for one Binance account. It is deliberately not a
 * net-asset, cash, or P/L figure: the label stays "wallet valuation", the
 * amount comes only from the exact platform + account_key report, and a
 * missing valuation is an em dash with a short state, never zero. Scope and
 * abnormal reasons stay in small title/data attributes rather than body copy.
 */
export function BinanceWalletFacts({ platform, accountKey, view }: {
  platform: string;
  accountKey: string | null;
  view?: BinanceFactsView;
}) {
  const t = useT();
  if (platform !== "binance" || !view) return null;
  const state = resolveBinanceWallet(view, platform, accountKey);

  if (state.kind === "loading") {
    return <div className="account-facts account-facts-binance" data-state="loading" data-scope="spot+flexible_earn">
      <Skeleton height={14} />
    </div>;
  }

  if (state.kind !== "ready") {
    return <div className="account-facts account-facts-binance" data-state={state.kind} data-scope="spot+flexible_earn">
      <span className="account-row account-facts-assets">
        <span title={t("facts.wallet_scope_note")}>{t("facts.wallet_valuation")} · USDT</span>
        <span className="account-facts-state-value">
          <span className="money flat">—</span>
          <span className="account-state-label">{t(SHORT_STATE[state.kind])}</span>
        </span>
      </span>
    </div>;
  }

  const { valuation } = state;
  const available = valuation.kind === "available";
  return <div
    className="account-facts account-facts-binance"
    data-state={available ? "available" : "valuation_unavailable"}
    data-scope="spot+flexible_earn"
    data-wallet-scope="provider_returned_wallet_rows"
    data-reason={available ? undefined : valuation.invalid ? "invalid_valuation" : valuation.reason}
  >
    {!available && <span className="account-row account-facts-binance-holdings" title={t("facts.wallet_holdings_scope_note")}>
      <span>{t("facts.wallet_holdings", { count: state.assetCount })}</span>
    </span>}
    <span className="account-row account-facts-assets">
      <span title={t("facts.wallet_scope_note")}>{t("facts.wallet_valuation")} · USDT</span>
      {available
        ? <WalletAmount amount={valuation.amount} />
        : <span className="account-facts-state-value">
          <span className="money flat">—</span>
          <span className="account-state-label">{t("facts.wallet_unavailable")}</span>
        </span>}
    </span>
    <div className="kpi-foot account-facts-freshness">
      <AsOfStamp value={available ? valuation.observedAt : state.observedAt} />
    </div>
  </div>;
}
