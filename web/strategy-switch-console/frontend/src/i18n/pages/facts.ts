/** Page-scoped copy fragment. Add keys here (both languages), never in the shared core files. */
export const zh: Record<string, string> = {
  "facts.assets": "资产",
  "facts.cash": "现金",
  "facts.cash_semantics": "券商报告的现金余额；不是购买力、可用资金或保证金。",
  "facts.identity_unverified": "账户身份未核验，金额不展示",
  "facts.observation_conflict": "同一身份的多份观测不一致，金额不展示",
  "facts.platform_total": "平台合计",
  "facts.platform_subtotal": "合计",
  "facts.platform_subtotal_note": "仅统计已核验且估值日期一致的账户。",
  "facts.coverage": "其中 {covered} 个账户有数据",
  "facts.partial_badge": "估值不完整",
  "facts.identity_action": "去核验账户",
};
export const en: Record<string, string> = {
  "facts.assets": "Assets",
  "facts.cash": "Cash",
  "facts.cash_semantics": "Broker-reported cash balance; not buying power, available funds, or margin.",
  "facts.identity_unverified": "Account identity unverified; amounts hidden",
  "facts.observation_conflict": "Conflicting observations for the same identity; amounts hidden",
  "facts.platform_total": "Platform total",
  "facts.platform_subtotal": "Total",
  "facts.platform_subtotal_note": "Only verified accounts with the same valuation date are included.",
  "facts.coverage": "{covered} accounts with data",
  "facts.partial_badge": "Valuation incomplete",
  "facts.identity_action": "Verify accounts",
};
