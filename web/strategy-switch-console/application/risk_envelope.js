import { RESEARCH_PROMOTION_RISK_PROFILES } from "./risk_envelope_profiles.js";

export const RISK_ENVELOPE_PREFERENCE_META = {
  CAPITAL_PRESERVATION: {
    short_zh: "保全",
    short_en: "Preserve",
    composer_mdd_multiple: 1.0,
    promotion_size_scale: 0.5,
  },
  BALANCED_COMPOUNDING: {
    short_zh: "均衡",
    short_en: "Balance",
    composer_mdd_multiple: 1.25,
    promotion_size_scale: 0.75,
  },
  GROWTH_COMPOUNDING: {
    short_zh: "增长",
    short_en: "Growth",
    composer_mdd_multiple: 1.5,
    promotion_size_scale: 1.0,
  },
};

/** Read-only console view: preference / capital band / status lamp. No KV writes. */
export function buildRiskEnvelopeView({ riskPreference = null, equityUsd = null, status = null } = {}) {
  const preferenceRaw = String(riskPreference || "").trim().toUpperCase();
  const preference = RESEARCH_PROMOTION_RISK_PROFILES.includes(preferenceRaw) ? preferenceRaw : null;
  const meta = preference ? RISK_ENVELOPE_PREFERENCE_META[preference] : null;
  const hasEquity = equityUsd != null && Number.isFinite(Number(equityUsd));
  // Equity injection is not wired yet — band/status/capital_scale stay unknown.
  const source = hasEquity ? "reconciled_equity" : "design_preview";
  const statusId = hasEquity && status ? String(status) : "unknown";
  const statusLabels = {
    normal: { zh: "正常", en: "Normal" },
    stepped_down: { zh: "已降档", en: "Stepped down" },
    new_risk_blocked: { zh: "禁止新增风险", en: "New risk blocked" },
    unknown: { zh: "待对账权益注入", en: "Awaiting reconciled equity" },
  };
  const statusLabel = statusLabels[statusId] || statusLabels.unknown;
  return {
    schema: "qsl.risk_envelope_view.v1",
    source,
    preference: preference
      ? {
          id: preference,
          label_zh: meta.short_zh,
          label_en: meta.short_en,
        }
      : {
          id: "unknown",
          label_zh: "未设定",
          label_en: "Unset",
        },
    capital_band: {
      id: "unknown",
      label_zh: "待对账权益注入",
      label_en: "Awaiting reconciled equity",
    },
    status: {
      id: statusId,
      label_zh: statusLabel.zh,
      label_en: statusLabel.en,
    },
    scales: {
      composer_mdd_multiple: meta ? meta.composer_mdd_multiple : null,
      promotion_size_scale: meta ? meta.promotion_size_scale : null,
      capital_scale: null,
      vol_scale: null,
      dd_scale: null,
    },
    detail: {
      dual_scale_note_zh:
        "双口径：Composer 相对无杠杆基准 MDD 天花板为 1.00 / 1.25 / 1.50；晋级仓位缩放为 0.50 / 0.75 / 1.00（仅新晋级/材料变更）。资金信封 combined_scale = capital_scale × vol_scale × dd_scale（各因子 ≤1），由系统按权益/波动/回撤计算，禁止自动升档。",
      dual_scale_note_en:
        "Dual scale: Composer unlevered-benchmark MDD caps are 1.00 / 1.25 / 1.50; promotion size scales are 0.50 / 0.75 / 1.00 (new promotion / material change only). Envelope combined_scale = capital_scale × vol_scale × dd_scale (each ≤1), system-computed from equity/vol/drawdown; auto step-up is forbidden.",
    },
    live_authority_granted: false,
  };
}

export function attachRiskEnvelopeView(ticket) {
  if (!ticket || typeof ticket !== "object") return ticket;
  return {
    ...ticket,
    risk_envelope_view: buildRiskEnvelopeView({
      riskPreference: ticket.suggested_risk_profile,
      equityUsd: null,
    }),
  };
}
