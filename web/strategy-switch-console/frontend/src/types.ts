export type AccountFactsReturn = {
  status: "unavailable";
  reason: "external_cashflow_required";
};

export type AccountFactsBalance = {
  currency: string;
  net_assets: string;
  total_cash: string;
};

export type AccountFactsCash = {
  currency: string;
  available_cash: string;
  frozen_cash: string;
  settling_cash: string;
};

export type AccountFactsAccount = {
  platform: string;
  account_key: string;
  binding_status: "bound" | "missing" | "duplicate";
  identity_status: "partial_identity" | "missing_identity";
  identity_mismatch?: boolean;
  data_status: "fresh" | "stale" | "unavailable";
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

export function formatAccountFactAmounts(
  rows: Array<{ currency?: string; [field: string]: unknown }> | null | undefined,
  field: string,
): string | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const parts = rows
    .map((row) => {
      const currency = row?.currency;
      const amount = row?.[field];
      if (typeof currency !== "string" || typeof amount !== "string") return null;
      return `${currency} ${amount}`;
    })
    .filter((item): item is string => Boolean(item));
  return parts.length ? parts.join(" · ") : null;
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
  if (reason === "physical_identity_unverified") {
    return "券商身份仅部分核验，不能汇总全部账户总额；请查看单账户分币种事实。";
  }
  if (reason === "coverage_incomplete") {
    return "账户覆盖不全或快照过期，不提供全部账户总额；未知不等于零。";
  }
  if (reason === "duplicate_account_mapping") {
    return "账户映射重复，金额不汇总；未知不等于零。";
  }
  return "全部账户总额暂不可用；未知不等于零。";
}

export function accountFactsDetail(account: AccountFactsAccount | null | undefined): string {
  if (!account) return "账户资产快照尚未接入；未知不等于零。";
  if (account.identity_mismatch) return "账户身份配置已变化，旧资产快照不可用；未知不等于零。";
  if (account.binding_status === "missing") return "缺少可信 target/source-binding 映射；未知不等于零。";
  if (account.binding_status === "duplicate") return "账户映射重复，金额不汇总；未知不等于零。";
  if (account.identity_status === "partial_identity" && account.data_status === "unavailable") {
    return "身份仅部分核验，尚无可信资产快照；未知不等于零。";
  }
  if (account.data_status === "stale") return "账户资产快照已过期；未知不等于当前余额。";
  if (account.data_status === "unavailable") return "账户资产快照尚未接入；未知不等于零。";
  if (account.identity_status === "partial_identity") {
    return "券商身份仅部分核验；金额按绑定来源分币种展示。";
  }
  return "账户资产快照可供核对。";
}
