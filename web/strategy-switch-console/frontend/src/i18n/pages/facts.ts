/** Page-scoped copy fragment. Add keys here (both languages), never in the shared core files. */
export const zh: Record<string, string> = {
  "facts.assets": "资产",
  "facts.cash": "现金",
  "facts.cash_semantics": "券商报告的现金余额；不是购买力、可用资金或保证金。",
  "facts.identity_unverified": "账户身份未核验，金额不展示",
  "facts.observation_conflict": "同一身份的多份观测不一致，金额不展示",
  "facts.platform_total": "平台合计",
  "facts.platform_subtotal": "已观测小计",
  "facts.platform_subtotal_note": "仅计入已核验且同估值日的账户；缺失或跨日账户不相加，不代表完整平台总额。",
  "facts.coverage": "覆盖 {covered}/{expected} 账户",
};
export const en: Record<string, string> = {
  "facts.assets": "Assets",
  "facts.cash": "Cash",
  "facts.cash_semantics": "Broker-reported cash balance; not buying power, available funds, or margin.",
  "facts.identity_unverified": "Account identity unverified; amounts hidden",
  "facts.observation_conflict": "Conflicting observations for the same identity; amounts hidden",
  "facts.platform_total": "Platform total",
  "facts.platform_subtotal": "Observed subtotal",
  "facts.platform_subtotal_note": "Only verified accounts sharing the latest valuation date are summed; missing or cross-day accounts are not added. Not a complete platform total.",
  "facts.coverage": "Covers {covered}/{expected} accounts",
};
