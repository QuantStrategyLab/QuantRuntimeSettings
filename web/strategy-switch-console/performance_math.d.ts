/** Pure chart calculations. See docs/console-performance-charts.md. */
export type PerformanceRange = "1m" | "3m" | "ytd" | "1y" | "all";
export declare const PERFORMANCE_RANGES: readonly ["1m", "3m", "ytd", "1y", "all"];
export type ValuePoint = {
    date: string;
    value: number;
    breakBefore?: boolean;
};
export type EquityPoint = ValuePoint & {
    externalFlow?: number | null;
};
export type AccountEquity = {
    id: string;
    /** True for 24/7 markets; gap detection must not assume exchange closures. */
    crypto?: boolean;
    points: EquityPoint[];
};
export declare function dateMs(date: string): number;
export declare function rangeStart(range: PerformanceRange, today: string): string;
/** Conflicting duplicate dates are omitted, never arbitrarily picked. */
export declare function cleanPoints<T extends ValuePoint>(points: readonly T[]): T[];
export declare function sliceRange<T extends ValuePoint>(points: readonly T[], range: PerformanceRange, today: string): T[];
export declare function hasGap(previous: ValuePoint, point: ValuePoint, options?: { crypto?: boolean }): boolean;
/** Rebase a positive index/price to percentage return; never fill missing dates. */
export declare function rebase(points: readonly ValuePoint[], start?: string): ValuePoint[];
/** End-flow TWR: 1+r = (V_end - F_end) / V_previous. */
export declare function chainReturns(points: readonly EquityPoint[]): {
    index: ValuePoint[];
    unknownFlow: boolean;
    invalidPeriod: boolean;
};
/** Fixed cohort: no changing membership, carry-forward, or missing-account zeros. */
export declare function aggregateEquity(accounts: readonly AccountEquity[]): {
    points: EquityPoint[];
    missingAccounts: string[];
    omittedDates: number;
};
/** Baseline never changes when the user hides a legend entry. */
export declare function alignReturns(primary: readonly ValuePoint[], comparisons: readonly {
    id: string;
    points: ValuePoint[];
}[]): {
    start: string;
    primary: ValuePoint[];
    benchmarks: {
        points: ValuePoint[];
        id: string;
    }[];
    noCommonDate: boolean;
};

export declare function isAggregateAssetAccount(account: {
    brokerEnvironment: string | null;
    facts: { broker_environment?: string | null; account_scope?: string | null } | null;
}): boolean;
