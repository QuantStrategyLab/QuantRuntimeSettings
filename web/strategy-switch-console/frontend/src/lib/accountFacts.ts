import type { AccountFactsAccount } from "../api/contracts";

/** Broker-reported amounts are decimal strings; anything else is unknown, never zero. */
const DECIMAL_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

export function isMoneyText(value: unknown): value is string {
  return typeof value === "string" && DECIMAL_RE.test(value);
}

/** Validated decimal text, kept as a string end-to-end; never converted to a float. */
export function validMoneyText(value: unknown): string | null {
  return isMoneyText(value) ? value : null;
}

/**
 * Exact decimal-text rendering: the integer part gets thousands separators and
 * the fraction is preserved digit-for-digit (padded to two places only when
 * shorter), so no legal broker amount is ever re-rounded by a float.
 */
export function formatMoneyText(text: string, currency: string | null): string {
  if (!isMoneyText(text)) return "—";
  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const [whole, fraction = ""] = unsigned.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const formatted = `${negative ? "-" : ""}${grouped}.${fraction ? fraction.padEnd(2, "0") : "00"}`;
  return currency ? `${currency} ${formatted}` : formatted;
}

/** Exact decimal-string addition for display subtotals; callers pass only validated texts. */
export function sumMoneyTexts(amounts: string[]): string {
  if (!amounts.length || !amounts.every(isMoneyText)) return "";
  const scale = Math.max(...amounts.map(amount => (amount.split(".")[1] || "").length));
  const total = amounts.reduce((sum, amount) => {
    const [whole, fraction = ""] = amount.replace(/^-/, "").split(".");
    const value = BigInt(whole + fraction.padEnd(scale, "0"));
    return sum + (amount.startsWith("-") ? -value : value);
  }, 0n);
  const digits = (total < 0n ? -total : total).toString().padStart(scale + 1, "0");
  return `${total < 0n ? "-" : ""}${scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/\.?0+$/, "") : digits}`;
}

/**
 * Trusted join only: an account directory row matches a facts row on the exact
 * platform + account key pair. Aliases, route strings, or position in a list
 * never establish identity; an ambiguous match is treated as unverified.
 */
export function factForAccount(
  facts: AccountFactsAccount[] | null | undefined,
  platform: string,
  accountKey: string,
): AccountFactsAccount | null {
  if (!facts) return null;
  const matches = facts.filter(row => row && row.platform === platform && row.account_key === accountKey);
  return matches.length === 1 ? matches[0]! : null;
}

export function isReadableFact(row: AccountFactsAccount | null | undefined): row is AccountFactsAccount {
  return Boolean(row)
    && row!.binding_status === "bound"
    && row!.identity_mismatch !== true
    && (row!.data_status === "fresh" || row!.data_status === "stale");
}

/**
 * Producer paper口径: a row is paper when the wire itself says so
 * (broker_environment or account_scope === "paper"), never by display alias.
 * A row with no scope information at all is unknown: it is never guessed into
 * the live total, but it still counts in the denominator so coverage stays
 * honestly incomplete.
 */
export function isPaperFact(row: AccountFactsAccount): boolean {
  return row.broker_environment === "paper" || row.account_scope === "paper";
}

/** Explicit broker environment from trusted facts; never inferred from an alias. */
export function factEnvironment(row: AccountFactsAccount | null | undefined): "paper" | "live" | null {
  if (!row) return null;
  const broker = row.broker_environment === "paper" || row.broker_environment === "live" ? row.broker_environment : null;
  const scope = row.account_scope === "paper" || row.account_scope === "live" ? row.account_scope : null;
  return broker && scope && broker !== scope ? null : broker ?? scope;
}

function hasScopeSignal(row: AccountFactsAccount): boolean {
  return typeof row.broker_environment === "string" || typeof row.account_scope === "string";
}

/** Matches the producer's accepted instant shapes: Z or numeric offset, compared as real time. */
const INSTANT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-](\d{2}):(\d{2}))$/;

/** Validated observation timestamp as epoch ms; an unparseable value is null, never a guess. */
function parseInstantMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = INSTANT_RE.exec(value);
  if (!match) return null;
  if (Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59) return null;
  if (match[7] !== "Z" && (Number(match[8]) > 23 || Number(match[9]) > 59)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * One trusted identity group (the existing broker-identity grouping) can reach
 * the same physical account through several aliases/strategies. Exactly one
 * representative is picked: the latest observation by actual instant wins
 * (offsets are compared as time, never as strings); disagreement at the same
 * instant is a conflict, never a silent choice. Rows are deduped by reference
 * only — identical content in distinct rows never proves one account.
 */
export function pickIdentityFact(
  rows: (AccountFactsAccount | null)[],
): { fact: AccountFactsAccount | null; conflict: boolean } {
  const present = [...new Set(rows.filter((row): row is AccountFactsAccount => Boolean(row)))];
  const usable = present.filter(isReadableFact);
  // No readable row still deserves its honest state (no_data, identity
  // unverified, unknown): return the latest present row for classification only.
  // Amounts never render for it — accountFactDisplay re-checks every gate.
  const pool = usable.length ? usable : present;
  if (!pool.length) return { fact: null, conflict: false };
  if (pool.length === 1) return { fact: pool[0]!, conflict: false };
  const timed = pool.map(row => ({ row, ms: parseInstantMs(row.observed_finished_at) }));
  if (timed.some(entry => entry.ms === null)) {
    // A time that cannot be compared reliably must never pick an arbitrary amount.
    return usable.length ? { fact: null, conflict: true } : { fact: pool[0]!, conflict: false };
  }
  const latestMs = Math.max(...timed.map(entry => entry.ms as number));
  const latest = timed.filter(entry => entry.ms === latestMs).map(entry => entry.row);
  if (!usable.length) return { fact: latest[0]!, conflict: false };
  const fingerprint = (row: AccountFactsAccount) =>
    JSON.stringify([row.observation_date, row.balances, row.cash]);
  if (latest.some(row => fingerprint(row) !== fingerprint(latest[0]!))) return { fact: null, conflict: true };
  return { fact: latest[0]!, conflict: false };
}

export type FactDisplay =
  | { kind: "not_connected" }
  | { kind: "identity_unverified" }
  | { kind: "no_data" }
  | { kind: "unknown" }
  | {
      kind: "ready";
      stale: boolean;
      asOf: string | null;
      balances: { currency: string; netAssets: string | null }[];
      cash: { currency: string; cashBalance: string | null; available?: boolean }[];
    };

/**
 * Broker-reported cash for one currency, projected from the fields each
 * platform actually reports: IBKR/Schwab/Firstrade report cash_balance in the
 * cash rows; LongBridge reports total_cash on the balance row. available_cash
 * is never relabeled as cash, and an invalid value degrades to unknown.
 */
export function cashTextFor(row: AccountFactsAccount, currency: string): string | null {
  const cashRow = (Array.isArray(row.cash) ? row.cash : []).find(cell => cell?.currency === currency);
  if (cashRow && typeof cashRow.cash_balance === "string") return validMoneyText(cashRow.cash_balance);
  const balanceRow = (Array.isArray(row.balances) ? row.balances : []).find(cell => cell?.currency === currency);
  if (balanceRow && typeof balanceRow.total_cash === "string") return validMoneyText(balanceRow.total_cash);
  return null;
}

/**
 * Display projection for one account card. Only an explicit `bound` binding with
 * a known fresh/stale status may show amounts; unknown enums or missing fields
 * fall back to an honest unknown, never to amounts and never to zero. Amounts
 * stay validated decimal strings all the way to rendering.
 */
export function accountFactDisplay(fact: AccountFactsAccount | null): FactDisplay {
  if (!fact || fact.binding_status === "missing") return { kind: "not_connected" };
  if (fact.binding_status === "duplicate" || fact.identity_mismatch === true) return { kind: "identity_unverified" };
  if (fact.binding_status !== "bound") return { kind: "unknown" };
  if (fact.data_status === "unavailable") return { kind: "no_data" };
  if (fact.data_status !== "fresh" && fact.data_status !== "stale") return { kind: "unknown" };
  const balances = Array.isArray(fact.balances) ? fact.balances : [];
  const cash = Array.isArray(fact.cash) ? fact.cash : [];
  const cashCurrencies = new Set<string>();
  for (const cell of cash) {
    if (cell && typeof cell.currency === "string" && typeof cell.cash_balance === "string") cashCurrencies.add(cell.currency);
  }
  for (const cell of balances) {
    if (cell && typeof cell.currency === "string" && typeof cell.total_cash === "string") cashCurrencies.add(cell.currency);
  }
  return {
    kind: "ready",
    stale: fact.data_status === "stale",
    asOf: typeof fact.observed_finished_at === "string" ? fact.observed_finished_at : null,
    balances: balances
      .filter(row => row && typeof row.currency === "string")
      .map(row => ({ currency: row.currency, netAssets: validMoneyText(row.net_assets) })),
    cash: [
      ...[...cashCurrencies].sort().map(currency => ({ currency, cashBalance: cashTextFor(fact, currency) })),
      ...(fact.platform === "longbridge" ? cash.filter(row => typeof row?.currency === "string" && typeof row.available_cash === "string")
        .map(row => ({ currency: row.currency, cashBalance: validMoneyText(row.available_cash), available: true })) : []),
    ],
  };
}

export interface PlatformCurrencyTotal {
  currency: string;
  /** Decimal-text sum over the accounts summed for this currency and day; null when any included account lacks a valid value. */
  netAssets: string | null;
  cashBalance: string | null;
  /** Unique accounts that actually contributed a valid amount to a displayed sum of this currency. */
  covered: number;
  /** Distinct accounts the platform scope holds (verified or not). */
  expected: number;
  /** False when coverage is partial, valuation days differ, amounts are unknown, or an identity conflicts. */
  complete: boolean;
  /** Any account summed into this subtotal is stale. */
  stale: boolean;
  observationDate: string | null;
}

function factHasCurrency(row: AccountFactsAccount, currency: string): boolean {
  return (Array.isArray(row.balances) && row.balances.some(b => b?.currency === currency))
    || (Array.isArray(row.cash) && row.cash.some(c => c?.currency === currency));
}

/**
 * Per-currency platform rollup over the authoritative backend aggregation
 * conclusion, in the producer's non-paper口径. The live scope is formed first:
 * producer-known "duplicate" aliases and paper rows are outside it as one
 * union — a row that is both leaves the denominator exactly once — while rows
 * with no scope signal stay in the set (they keep the denominator honest
 * without joining any sum). Within the scope, only rows marked
 * aggregation_status "included" — verified unique physical accounts, already
 * deduplicated by the producer — may join a sum, and only when they carry a
 * scope signal. Unverified or conflicting rows never join a sum, and a
 * conflict inside the live scope keeps every block an observed subtotal;
 * conflicts between excluded paper rows keep their own card state but never
 * degrade the live total. Only accounts observed on the latest common
 * valuation date are summed; a missing or differing day is excluded and blocks
 * completeness. Cash and assets are summed independently per currency, a
 * missing value is never summed as zero, and coverage counts only accounts
 * that actually contributed to a displayed sum.
 */
export function platformCurrencyTotals(rows: AccountFactsAccount[], expected: number): PlatformCurrencyTotal[] {
  if (!rows.length || expected < 1) return [];
  const unique = [...new Set(rows)];
  const inScope = unique.filter(row => row.aggregation_status !== "duplicate" && !isPaperFact(row));
  const liveExpected = Math.max(0, expected - (unique.length - inScope.length));
  const readable = inScope.filter(isReadableFact);
  const eligible = readable.filter(row =>
    row.aggregation_status === "included" && hasScopeSignal(row));
  const conflict = readable.some(row => row.aggregation_status === "conflict");
  if (!eligible.length) return [];
  const currencies = new Set<string>();
  for (const rep of eligible) {
    for (const balance of Array.isArray(rep.balances) ? rep.balances : []) {
      if (balance && typeof balance.currency === "string") currencies.add(balance.currency);
    }
    for (const cash of Array.isArray(rep.cash) ? rep.cash : []) {
      // Available cash belongs to the account detail, not a balance total.
      if (cash && typeof cash.currency === "string" && typeof cash.cash_balance === "string") currencies.add(cash.currency);
    }
  }
  return [...currencies].sort().map(currency => {
    const withCurrency = eligible.filter(rep => factHasCurrency(rep, currency));
    // A valuation day must be a real string on every summed account; rows
    // without one can never prove a common day and stay out of the sum.
    const dated = withCurrency.filter(rep => typeof rep.observation_date === "string" && rep.observation_date.length > 0);
    const observationDate = dated.length ? dated.map(rep => rep.observation_date as string).sort().pop()! : null;
    const included = observationDate ? dated.filter(rep => rep.observation_date === observationDate) : [];
    const balanceOf = (rep: AccountFactsAccount) =>
      (Array.isArray(rep.balances) ? rep.balances : []).find(b => b?.currency === currency);
    const netValues = included.map(rep => validMoneyText(balanceOf(rep)?.net_assets));
    const netSum = included.length > 0 && netValues.every(value => value !== null)
      ? sumMoneyTexts(netValues as string[])
      : null;
    const cashValues = included.map(rep => cashTextFor(rep, currency));
    const cashSum = included.length > 0 && cashValues.every(value => value !== null)
      ? sumMoneyTexts(cashValues as string[])
      : null;
    const covered = netSum !== null || cashSum !== null ? included.length : 0;
    return {
      currency,
      netAssets: netSum,
      cashBalance: cashSum,
      covered,
      expected: liveExpected,
      complete: !conflict
        && liveExpected > 0
        && covered === liveExpected
        && included.length === withCurrency.length
        && netSum !== null,
      stale: included.some(rep => rep.data_status === "stale"),
      observationDate,
    };
  });
}
