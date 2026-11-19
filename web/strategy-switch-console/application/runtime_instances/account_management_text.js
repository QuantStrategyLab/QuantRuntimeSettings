// The generic status-to-text table of the management readback, shared by the
// frontend and the contract tests. zh-CN is primary with en alongside. The
// text is fixed here: no producer text is ever accepted. Status copy is about
// management only and never uses a runtime activation label.
export const MANAGEMENT_STATUS_TEXT = Object.freeze({
  managed: Object.freeze({ "zh-CN": "已纳入量化管理", en: "Under quant management" }),
  management_disabled: Object.freeze({ "zh-CN": "已停用量化管理", en: "Quant management disabled" }),
  not_under_management: Object.freeze({ "zh-CN": "不纳入量化管理", en: "Outside quant management" }),
  unknown: Object.freeze({ "zh-CN": "量化管理状态未知", en: "Quant management status unknown" }),
});

// Evidence suffixes are separate from the status text.
export const MANAGEMENT_EVIDENCE_TEXT = Object.freeze({
  unknown: Object.freeze({ "zh-CN": "证据未知", en: "Evidence unknown" }),
  conflict: Object.freeze({ "zh-CN": "证据冲突", en: "Conflicting evidence" }),
  stale: Object.freeze({ "zh-CN": "证据已过期", en: "Stale evidence" }),
});
