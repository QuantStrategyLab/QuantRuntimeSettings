export type AccountFactsReturn = {
  status: "unavailable";
  reason: "external_cashflow_required";
};

export type AccountFactsBalance = {
  currency: string;
  net_assets: string | null;
  total_cash?: string | null;
  source_tag?: "liquidationValue";
  currency_source?: "owner_confirmed";
};

export type LongBridgeAccountFactsCash = {
  currency: string;
  available_cash: string;
  frozen_cash: string;
  settling_cash: string;
};

export type IbkrAccountFactsCash = {
  currency: string;
  cash_balance: string;
  source_tag: "$LEDGER-CashBalance" | "$LEDGER-TotalCashBalance" | "CashBalance" | "TotalCashBalance" | "SettledCash";
};

export type AccountFactsCash = LongBridgeAccountFactsCash | IbkrAccountFactsCash;

export type AccountFactsAccount = {
  platform: string;
  account_key: string;
  binding_status: "bound" | "missing" | "duplicate";
  identity_status: "partial_identity" | "missing_identity";
  identity_mismatch?: boolean;
  data_status: "fresh" | "stale" | "unavailable";
  broker_environment?: string | null;
  target_id: string | null;
  source_binding_id: string | null;
  account_scope?: string | null;
  observation_date: string | null;
  observed_started_at: string | null;
  observed_finished_at: string | null;
  balances: AccountFactsBalance[];
  cash: AccountFactsCash[];
  return: AccountFactsReturn;
};

export type AccountFactsTotals = {
  status: "by_currency" | "unavailable";
  reason: string | null;
  by_currency: Array<{
    currency: string;
    net_assets: string;
    available_cash: string;
    account_count: number;
  }>;
};

export type AccountFactsSnapshot = {
  ok: true;
  enabled?: boolean;
  configured?: boolean;
  accounts: AccountFactsAccount[];
  totals: AccountFactsTotals;
  return: AccountFactsReturn;
};

export type AccountFactsHistoryPoint = {
  observation_date: string;
  observed_finished_at: string;
  currency: string;
  net_assets: string;
  total_cash: string | null;
};

export type AccountFactsHistorySeries = {
  ok: true;
  currency: string | null;
  points: AccountFactsHistoryPoint[];
  gap_dates: string[];
  first_sample_date: string | null;
  truncated: boolean;
  retention_days: number;
  note: string | null;
};

export type AccountFactsHistorySnapshot = {
  ok: true;
  enabled?: boolean;
  platform: string;
  account_key: string;
  binding_status: "bound" | "missing" | "duplicate";
  identity_status: "partial_identity" | "missing_identity";
  identity_mismatch?: boolean;
  target_id: string | null;
  source_binding_id: string | null;
  account_scope: string | null;
  series: AccountFactsHistorySeries;
  retention_days?: number;
  return: AccountFactsReturn;
};

export function formatAccountFactAmounts(
  rows: Array<{ currency?: string; [field: string]: unknown }> | null | undefined,
  field: string,
): string | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const validRows = rows.filter((row) => (
    typeof row?.currency === "string" && typeof row?.[field] === "string"
  ));
  if (!validRows.length) return null;
  const parts = validRows
    .map((row) => {
      const currency = row.currency;
      const amount = row[field];
      if (typeof currency !== "string" || typeof amount !== "string" || /^-?0(?:\.0+)?$/.test(amount)) return null;
      return currency + " " + amount;
    })
    .filter((item): item is string => Boolean(item));
  return parts.length ? parts.join(" · ") : "0";
}

export function accountFactsForRow(
  facts: AccountFactsSnapshot | null | undefined,
  platform: string,
  accountKey: string,
): AccountFactsAccount | null {
  if (!facts?.accounts?.length) return null;
  return facts.accounts.find((item) => item.platform === platform && item.account_key === accountKey) || null;
}

export function totalsUnavailableDetail(reason: string | null | undefined): string {
  void reason;
  return "暂不可用";
}

export function accountFactsDetail(account: AccountFactsAccount | null | undefined): string {
  if (!account) return "暂无数据";
  if (account.identity_mismatch || account.binding_status === "missing" || account.binding_status === "duplicate") {
    return "暂不可用";
  }
  if (account.data_status === "stale") return "数据暂不可用";
  if (account.data_status === "unavailable") return "暂无数据";
  return "";
}

export function accountFactsUpdatedAt(account: AccountFactsAccount | null | undefined): string | null {
  if (!account) return null;
  if (account.data_status !== "fresh" && account.data_status !== "stale") return null;
  return typeof account.observed_finished_at === "string" && account.observed_finished_at ? account.observed_finished_at : null;
}
