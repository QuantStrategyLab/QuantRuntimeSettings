import { ACCOUNT_FACTS_STALE_MS, ACCOUNT_FACTS_FUTURE_SKEW_MS } from "../../account_facts.js";

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

export type LongBridgeCashDetail = {
  currency: string;
  total_cash?: string;
  available_cash?: string;
  frozen_cash?: string;
  settling_cash?: string;
};

export type LongBridgeFinancingRiskLevel = "0" | "1" | "2" | "3";

export type LongBridgeFinancingRow = {
  currency: string;
  max_finance_amount?: string;
  remaining_finance_amount?: string;
  init_margin?: string;
  maintenance_margin?: string;
  margin_call?: string;
  buy_power?: string;
  risk_level?: LongBridgeFinancingRiskLevel;
};

export type IbkrAccountFactsCash = {
  currency: string;
  cash_balance: string;
  source_tag: "$LEDGER-CashBalance" | "$LEDGER-TotalCashBalance" | "CashBalance" | "TotalCashBalance" | "SettledCash";
};

export type SchwabAccountFactsCash = {
  currency: "USD";
  cash_balance: string;
  source_tag: "cashBalance";
  currency_source: "owner_confirmed";
};

export type SchwabBrokerAccountType = {
  value: string;
  source_tag: "securitiesAccount.type";
};

export type AccountFactsCash = LongBridgeAccountFactsCash | IbkrAccountFactsCash | SchwabAccountFactsCash;

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
  financing?: LongBridgeFinancingRow[];
  broker_account_type?: SchwabBrokerAccountType;
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

export type BinancePrivateScopeAsset = {
  asset: string;
  free: string;
  locked: string;
};

export type BinanceProviderProductType = {
  value: "SPOT" | "unknown";
  source: "GET /api/v3/account.accountType";
  observed_at: string;
};

export function binanceProviderProductTypeForDisplay(
  report: { provider_product_type?: BinanceProviderProductType } | null | undefined,
  eligibleAccountReport: boolean,
): BinanceProviderProductType | null {
  const productType = report?.provider_product_type;
  if (!eligibleAccountReport || productType?.value !== "SPOT"
      || productType.source !== "GET /api/v3/account.accountType"
      || typeof productType.observed_at !== "string"
      || !Number.isFinite(Date.parse(productType.observed_at))) return null;
  return {
    value: "SPOT",
    source: "GET /api/v3/account.accountType",
    observed_at: productType.observed_at,
  };
}

export type BinancePrivateScopeDisplay = {
  observed_at: string;
  assets: BinancePrivateScopeAsset[];
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

export type BinanceWalletHistoryPoint = {
  observation_date: string;
  observed_at: string;
  amount: string;
  break_before?: true;
};

export type BinanceWalletHistorySnapshot = {
  ok: true;
  metric: "wallet_valuation";
  currency: "USDT";
  scope: "provider_returned_wallet_rows";
  points: BinanceWalletHistoryPoint[];
  gap_dates: string[];
  first_sample_date: string | null;
  retention_days: number;
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

export function hasNonzeroNegativeAccountFactAmount(
  rows: Array<{ [field: string]: unknown }> | null | undefined,
  field: string,
): boolean {
  return Array.isArray(rows) && rows.some((row) => {
    const amount = row?.[field];
    return typeof amount === "string" && /^-\d+(?:\.\d+)?$/.test(amount) && /[1-9]/.test(amount);
  });
}

export function longBridgeCashDetails(account: AccountFactsAccount | null | undefined): LongBridgeCashDetail[] | null {
  if (!account || account.platform !== "longbridge" || account.data_status !== "fresh"
    || account.binding_status !== "bound" || account.identity_mismatch === true
    || typeof account.observed_finished_at !== "string"
    || !Number.isFinite(Date.parse(account.observed_finished_at))) return null;
  const cashRows = account.cash.filter((row): row is LongBridgeAccountFactsCash => (
    ("available_cash" in row || "frozen_cash" in row || "settling_cash" in row)
    && typeof row.currency === "string" && row.currency.length > 0
  ));
  const balanceRows = account.balances.filter((row) => typeof row.currency === "string" && row.currency.length > 0);
  const hasDuplicateCurrency = (rows: Array<{ currency: string }>) => (
    new Set(rows.map((row) => row.currency)).size !== rows.length
  );
  if (hasDuplicateCurrency(cashRows) || hasDuplicateCurrency(balanceRows)) return null;
  const currencies = new Set([...balanceRows.map((row) => row.currency), ...cashRows.map((row) => row.currency)]);
  const result: LongBridgeCashDetail[] = [];
  for (const currency of currencies) {
    const balance = balanceRows.find((row) => row.currency === currency);
    const cash = cashRows.find((row) => row.currency === currency);
    const detail: LongBridgeCashDetail = { currency };
    if (typeof balance?.total_cash === "string") detail.total_cash = balance.total_cash;
    if (typeof cash?.available_cash === "string") detail.available_cash = cash.available_cash;
    if (typeof cash?.frozen_cash === "string") detail.frozen_cash = cash.frozen_cash;
    if (typeof cash?.settling_cash === "string") detail.settling_cash = cash.settling_cash;
    if (Object.keys(detail).length > 1) result.push(detail);
  }
  return result.length ? result : null;
}

const LONG_BRIDGE_FINANCING_MONEY_FIELDS = [
  "max_finance_amount",
  "remaining_finance_amount",
  "init_margin",
  "maintenance_margin",
  "margin_call",
  "buy_power",
] as const;

const LONG_BRIDGE_RISK_LEVEL_WIRE = new Set<LongBridgeFinancingRiskLevel>(["0", "1", "2", "3"]);

export function longBridgeRiskLevelLabel(
  level: LongBridgeFinancingRiskLevel,
): "安全" | "中等" | "预警" | "危险" {
  if (level === "0") return "安全";
  if (level === "1") return "中等";
  if (level === "2") return "预警";
  return "危险";
}

export function longBridgeFinancingDetails(
  account: AccountFactsAccount | null | undefined,
): LongBridgeFinancingRow[] | null {
  if (!account || account.platform !== "longbridge" || account.data_status !== "fresh"
    || account.binding_status !== "bound" || account.identity_mismatch === true
    || typeof account.observed_finished_at !== "string"
    || !Number.isFinite(Date.parse(account.observed_finished_at))
    || !Array.isArray(account.financing) || account.financing.length === 0) return null;
  const balanceCurrencies = new Set(
    account.balances
      .map((row) => row.currency)
      .filter((currency): currency is string => typeof currency === "string" && currency.length > 0),
  );
  const seen = new Set<string>();
  let previousCurrency: string | null = null;
  const result: LongBridgeFinancingRow[] = [];
  for (const row of account.financing) {
    if (!row || typeof row.currency !== "string" || !row.currency
        || seen.has(row.currency) || !balanceCurrencies.has(row.currency)) return null;
    if (previousCurrency !== null && row.currency < previousCurrency) return null;
    seen.add(row.currency);
    previousCurrency = row.currency;
    const detail: LongBridgeFinancingRow = { currency: row.currency };
    let hasNativeField = false;
    for (const field of LONG_BRIDGE_FINANCING_MONEY_FIELDS) {
      const value = row[field];
      if (value === undefined) continue;
      if (typeof value !== "string") return null;
      detail[field] = value;
      hasNativeField = true;
    }
    if (row.risk_level !== undefined) {
      if (!LONG_BRIDGE_RISK_LEVEL_WIRE.has(row.risk_level)) return null;
      detail.risk_level = row.risk_level;
      hasNativeField = true;
    }
    if (!hasNativeField) return null;
    result.push(detail);
  }
  return result.length ? result : null;
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
  if (reason === "physical_identity_unverified") return "实物账户尚未完成去重，暂不合计";
  if (reason === "coverage_incomplete") return "账户资产资料覆盖不全，暂不合计";
  if (reason === "no_non_paper_accounts") return "暂无可合计的非模拟账户";
  return "全部账户总额暂不可用";
}

/** Expire a loaded current snapshot locally; keep source/history values untouched. */
export function accountFactsForDisplay(
  account: AccountFactsAccount | null | undefined,
  now = Date.now(),
): AccountFactsAccount | null | undefined {
  if (!account || account.data_status !== "fresh") return account;
  const observed = typeof account.observed_finished_at === "string" ? Date.parse(account.observed_finished_at) : NaN;
  if (!Number.isFinite(now) || !Number.isFinite(observed) || observed > now + ACCOUNT_FACTS_FUTURE_SKEW_MS) {
    return { ...account, data_status: "unavailable" };
  }
  return now - observed > ACCOUNT_FACTS_STALE_MS ? { ...account, data_status: "stale" } : account;
}

export function accountFactsDisplayReady(account: AccountFactsAccount | null | undefined): boolean {
  return Boolean(account && account.binding_status === "bound" && account.identity_status === "partial_identity"
    && account.identity_mismatch !== true && account.data_status === "fresh");
}

export function accountFactsDetail(account: AccountFactsAccount | null | undefined): string {
  if (!account) return "尚未取得账户资产资料";
  if (account.identity_mismatch === true) return "账户身份不匹配";
  if (account.binding_status === "duplicate") return "账户资料绑定重复";
  if (account.binding_status === "missing") return "账户资料尚未绑定";
  if (account.identity_status !== "partial_identity") return "账户身份待核实";
  if (account.data_status === "stale") return "账户资产资料已过期";
  if (account.data_status === "unavailable") return "尚未取得账户资产资料";
  return accountFactsDisplayReady(account) ? "" : "账户资产资料状态未确认";
}

/** Counts configured rows with a displayed asset value, never physical accounts or totals. */
export function summarizeAccountFactsCoverage(
  accounts: Array<{ id: string; brokerEnvironment: string | null; facts: AccountFactsAccount | null }>,
  eligibleWalletAccountId: string | null = null,
): { total: number; covered: number; paper: number; wallet: number } {
  let covered = 0;
  let paper = 0;
  let wallet = 0;
  for (const account of accounts) {
    if (account.brokerEnvironment === "paper" || account.facts?.account_scope === "paper") paper += 1;
    if (eligibleWalletAccountId !== null && account.id === eligibleWalletAccountId) {
      covered += 1;
      wallet += 1;
    } else if (accountFactsDisplayReady(account.facts) && account.facts!.balances.some(row => (
      /^[A-Z]{3}$/.test(row.currency) && typeof row.net_assets === "string"
      && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(row.net_assets)
    ))) covered += 1;
  }
  return { total: accounts.length, covered, paper, wallet };
}

export type CurrentAccountFactsRow = {
  id: string;
  platform: string;
  brokerEnvironment: string | null;
  facts: AccountFactsAccount | null;
  walletValuation?: { amount: string; currency: string } | null;
};

export type CurrentAccountFactsGroup = {
  accounts: number;
  covered: number;
  unbound: number;
  missing: number;
  assets: Array<{ currency: string; amount: string }>;
  cashBalance: Array<{ currency: string; amount: string }>;
  availableCash: Array<{ currency: string; amount: string }>;
  cashAccounts: number;
  cashCovered: number;
  cashUnbound: number;
  cashMissing: number;
};

export type CurrentAccountFactsSummary = {
  live: CurrentAccountFactsGroup;
  paper: CurrentAccountFactsGroup;
  unknown: CurrentAccountFactsGroup;
  excludingPaper: CurrentAccountFactsGroup;
  duplicateConfigurationKeys: number;
  duplicateConfigurationConflicts: number;
};

function validCurrentAmount(value: unknown): value is string {
  return typeof value === "string" && value.length <= 128
    && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value);
}

function sumCurrentAmounts(rows: Array<{ currency: string; amount: string }>): Array<{ currency: string; amount: string }> {
  const values = new Map<string, string[]>();
  for (const row of rows) values.set(row.currency, [...(values.get(row.currency) || []), row.amount]);
  return Array.from(values, ([currency, amounts]) => {
    let scale = 0;
    const parsed = amounts.map(amount => {
      const [integer, fraction = ""] = amount.replace(/^-/, "").split(".");
      scale = Math.max(scale, fraction.length);
      return { negative: amount.startsWith("-"), integer, fraction };
    });
    const total = parsed.reduce((sum, value) => {
      const magnitude = BigInt(value.integer + value.fraction.padEnd(scale, "0"));
      return sum + (value.negative ? -magnitude : magnitude);
    }, 0n);
    const negative = total < 0n;
    const digits = (negative ? -total : total).toString().padStart(scale + 1, "0");
    const amount = scale
      ? `${negative ? "-" : ""}${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/\.?0+$/, "")
      : `${negative ? "-" : ""}${digits}`;
    return { currency, amount: amount === "-" ? "0" : amount };
  }).sort((left, right) => left.currency.localeCompare(right.currency));
}

/** Summarize only current, fresh, uniquely bound account facts; currencies and cash meanings stay separate. */
export function summarizeCurrentAccountFacts(accounts: CurrentAccountFactsRow[]): CurrentAccountFactsSummary {
  const rowsByConfigKey = new Map<string, CurrentAccountFactsRow[]>();
  for (const account of accounts) {
    const key = JSON.stringify([account.platform, account.id]);
    rowsByConfigKey.set(key, [...(rowsByConfigKey.get(key) || []), account]);
  }
  let duplicateConfigurationKeys = 0;
  let duplicateConfigurationConflicts = 0;
  const uniqueAccounts: CurrentAccountFactsRow[] = [];
  for (const rows of rowsByConfigKey.values()) {
    if (rows.length === 1) {
      uniqueAccounts.push(rows[0]);
      continue;
    }
    duplicateConfigurationKeys += 1;
    const first = rows[0];
    const factsFingerprint = JSON.stringify(first.facts);
    const walletFingerprint = JSON.stringify(first.walletValuation ?? null);
    const factsAgree = rows.every(row => JSON.stringify(row.facts) === factsFingerprint);
    const walletAgrees = rows.every(row => JSON.stringify(row.walletValuation ?? null) === walletFingerprint);
    const knownEnvironments = new Set(rows
      .map(row => row.brokerEnvironment)
      .filter(environment => environment === "live" || environment === "paper"));
    const environmentConflict = knownEnvironments.size > 1;
    const groupConflict = environmentConflict || !factsAgree || !walletAgrees;
    if (groupConflict) duplicateConfigurationConflicts += 1;
    const environmentsAgree = rows.every(row => row.brokerEnvironment === first.brokerEnvironment);
    uniqueAccounts.push({
      ...first,
      brokerEnvironment: environmentsAgree && !environmentConflict ? first.brokerEnvironment : null,
      facts: groupConflict ? null : first.facts,
      walletValuation: groupConflict ? null : first.walletValuation,
    });
  }
  const groups = {
    live: { accounts: 0, covered: 0, unbound: 0, missing: 0, assets: [], cashBalance: [], availableCash: [], cashAccounts: 0, cashCovered: 0, cashUnbound: 0, cashMissing: 0 },
    paper: { accounts: 0, covered: 0, unbound: 0, missing: 0, assets: [], cashBalance: [], availableCash: [], cashAccounts: 0, cashCovered: 0, cashUnbound: 0, cashMissing: 0 },
    unknown: { accounts: 0, covered: 0, unbound: 0, missing: 0, assets: [], cashBalance: [], availableCash: [], cashAccounts: 0, cashCovered: 0, cashUnbound: 0, cashMissing: 0 },
  } as Record<"live" | "paper" | "unknown", {
    accounts: number; covered: number; unbound: number; missing: number;
    assets: Array<{ currency: string; amount: string }>;
    cashBalance: Array<{ currency: string; amount: string }>;
    availableCash: Array<{ currency: string; amount: string }>;
    cashAccounts: number; cashCovered: number; cashUnbound: number; cashMissing: number;
  }>;
  for (const account of uniqueAccounts) {
    const facts = account.facts;
    const paperEvidence = account.brokerEnvironment === "paper"
      || facts?.account_scope === "paper" || facts?.broker_environment === "paper";
    const environmentConflict = (account.brokerEnvironment === "live" && paperEvidence)
      || (account.brokerEnvironment === "paper" && facts?.broker_environment === "live");
    const environment = environmentConflict ? "unknown"
      : paperEvidence ? "paper"
        : account.brokerEnvironment === "live" ? "live" : "unknown";
    const group = groups[environment];
    group.accounts += 1;
    const bound = facts?.binding_status === "bound";
    if (facts && !bound) group.unbound += 1;
    // Configuration and facts refresh separately; conflicting snapshots cannot contribute funds.
    const ready = !environmentConflict && accountFactsDisplayReady(facts);
    const wallet = !environmentConflict && account.walletValuation && /^[A-Z0-9]{3,10}$/.test(account.walletValuation.currency)
      && validCurrentAmount(account.walletValuation.amount) ? account.walletValuation : null;
    const assetRows = wallet
      ? [{ currency: wallet.currency, amount: wallet.amount }]
      : ready ? facts!.balances.flatMap(row => /^[A-Z0-9]{3,10}$/.test(row.currency) && validCurrentAmount(row.net_assets)
        ? [{ currency: row.currency, amount: row.net_assets! }] : []) : [];
    const assetCurrencyCounts = new Map<string, number>();
    for (const row of assetRows) assetCurrencyCounts.set(row.currency, (assetCurrencyCounts.get(row.currency) || 0) + 1);
    const uniqueAssets = assetRows.filter(row => assetCurrencyCounts.get(row.currency) === 1);
    group.assets.push(...uniqueAssets);
    if (uniqueAssets.length) group.covered += 1;
    else group.missing += 1;

    if (!["longbridge", "ibkr", "schwab"].includes(account.platform)) continue;
    group.cashAccounts += 1;
    const cashReady = ready;
    const cashRows = cashReady ? facts!.cash : [];
    const cashField = account.platform === "ibkr" || account.platform === "schwab" ? "cash_balance" : "available_cash";
    const cashAmounts = cashRows.flatMap(row => {
      const amount = cashField === "cash_balance" && "cash_balance" in row ? row.cash_balance
        : cashField === "available_cash" && "available_cash" in row ? row.available_cash : null;
      return /^[A-Z0-9]{3,10}$/.test(row.currency) && validCurrentAmount(amount)
        ? [{ currency: row.currency, amount }] : [];
    });
    const cashCurrencyCounts = new Map<string, number>();
    for (const row of cashAmounts) cashCurrencyCounts.set(row.currency, (cashCurrencyCounts.get(row.currency) || 0) + 1);
    const uniqueCash = cashAmounts.filter(row => cashCurrencyCounts.get(row.currency) === 1);
    if (cashField === "cash_balance") group.cashBalance.push(...uniqueCash);
    else group.availableCash.push(...uniqueCash);
    if (uniqueCash.length) group.cashCovered += 1;
    else group.cashMissing += 1;
    if (facts && !bound) group.cashUnbound += 1;
  }
  for (const group of Object.values(groups)) {
    group.assets = sumCurrentAmounts(group.assets);
    group.cashBalance = sumCurrentAmounts(group.cashBalance);
    group.availableCash = sumCurrentAmounts(group.availableCash);
  }
  const excludingPaper: CurrentAccountFactsGroup = {
    accounts: groups.live.accounts + groups.unknown.accounts,
    covered: groups.live.covered + groups.unknown.covered,
    unbound: groups.live.unbound + groups.unknown.unbound,
    missing: groups.live.missing + groups.unknown.missing,
    assets: sumCurrentAmounts([...groups.live.assets, ...groups.unknown.assets]),
    cashBalance: sumCurrentAmounts([...groups.live.cashBalance, ...groups.unknown.cashBalance]),
    availableCash: sumCurrentAmounts([...groups.live.availableCash, ...groups.unknown.availableCash]),
    cashAccounts: groups.live.cashAccounts + groups.unknown.cashAccounts,
    cashCovered: groups.live.cashCovered + groups.unknown.cashCovered,
    cashUnbound: groups.live.cashUnbound + groups.unknown.cashUnbound,
    cashMissing: groups.live.cashMissing + groups.unknown.cashMissing,
  };
  return { ...groups, excludingPaper, duplicateConfigurationKeys, duplicateConfigurationConflicts };
}

export function accountHistoryCoverage(series: {
  first_sample_date?: string | null;
  retention_days?: number;
  truncated?: boolean;
  gap_dates?: string[];
  points?: Array<{ observation_date: string }>;
} | null | undefined): {
  firstSampleDate: string | null; lastSampleDate: string | null;
  gapCount: number; retentionDays: number | null; truncated: boolean;
} | null {
  if (!series) return null;
  const validDate = (value: unknown): value is string => typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  const dates = (series.points || []).map(row => row.observation_date).filter(validDate).sort();
  return {
    firstSampleDate: validDate(series.first_sample_date) ? series.first_sample_date : null,
    lastSampleDate: dates.at(-1) || null,
    gapCount: new Set((series.gap_dates || []).filter(validDate)).size,
    retentionDays: typeof series.retention_days === "number" && Number.isInteger(series.retention_days)
      && series.retention_days > 0 ? series.retention_days : null,
    truncated: series.truncated === true,
  };
}

export function accountFactsUpdatedAt(account: AccountFactsAccount | null | undefined): string | null {
  if (!account) return null;
  if (account.data_status !== "fresh" && account.data_status !== "stale") return null;
  return typeof account.observed_finished_at === "string" && account.observed_finished_at ? account.observed_finished_at : null;
}
