/** Page-scoped copy fragment. Add keys here (both languages), never in the shared core files. */
export const zh: Record<string, string> = {
  "performance.current_holdings_unrealized": "当前持仓 · 未实现盈亏",
  "perf.return_kind_twr": "时间加权收益率（TWR）",
  "perf.return_kind_unadjusted": "未经出入金调整的资产变动比例（非 TWR）",
  "perf.per_currency_note": "多币种无法合并为同一条曲线；以下按币种分别计算，不代表组合整体收益。",
  "perf.holdings_coverage_accounts": "覆盖账户：{value}",
  "perf.ranking_note": "按未实现盈亏金额排序；比例为相对成本价的盈亏，缺少成本价的持仓不参与排行。",
  "perf.ranking_winners": "盈利靠前",
  "perf.ranking_losers": "亏损靠前",
};
export const en: Record<string, string> = {
  "performance.current_holdings_unrealized": "Current holdings · unrealized P/L",
  "perf.return_kind_twr": "Time-weighted return (TWR)",
  "perf.return_kind_unadjusted": "Asset-change ratio unadjusted for cash flows (not TWR)",
  "perf.per_currency_note": "Mixed currencies cannot be merged into one curve; each currency below is computed separately and is not a combined portfolio return.",
  "perf.holdings_coverage_accounts": "Covered accounts: {value}",
  "perf.ranking_note": "Ranked by unrealized P/L amount; percentages are relative to cost basis. Holdings without a cost basis are not ranked.",
  "perf.ranking_winners": "Top gainers",
  "perf.ranking_losers": "Top losers",
};
