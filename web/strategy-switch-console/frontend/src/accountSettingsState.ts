import { accountSettingDraftBody, type AccountSettingOverridePatch } from "./operations.ts";
import { cashDraftDirty, decimalUnitRatio, percentTextToRatio } from "./presentation.ts";
import { createRequestGate } from "./requestGate.js";

export type AccountSettingsAccount = { platform: string; key: string };
export type CashEditMode = "" | "inherit" | "floor" | "ratio" | "both";
export type AccountSettingsDraftFields = {
  strategy: string;
  floor: string;
  ratio: string;
  percent: string;
  income: string;
  option: string;
  dcaMode: "" | "fixed" | "smart";
  dcaAmount: string;
  dcaProfile: string;
  strategyTouched: boolean;
  incomeTouched: boolean;
  optionTouched: boolean;
  floorTouched: boolean;
  ratioTouched: boolean;
  dcaTouched: boolean;
  clearStrategy: boolean;
  clearFloor: boolean;
  clearRatio: boolean;
  clearDca: boolean;
  cashMode: CashEditMode;
  acknowledge: boolean;
};
export type AccountSettingsReview = { draft: boolean; risk: boolean };
export type AccountSettingsView = {
  account: AccountSettingsAccount | null;
  settings: Record<string, any> | null;
  preference: string;
  notice: string;
  noticeGroup: "" | "cash" | "income" | "option" | "strategy" | "risk";
  unavailable: string;
  saving: string;
  review: AccountSettingsReview;
  draft: AccountSettingsDraftFields;
};
export type AccountSettingsOp = {
  token: number;
  account: AccountSettingsAccount;
  kind: "read" | "save" | "refresh";
  body?: Record<string, unknown>;
};

function blankDraft(): AccountSettingsDraftFields {
  return {
    strategy: "", floor: "", ratio: "", percent: "", income: "", option: "",
    dcaMode: "", dcaAmount: "", dcaProfile: "",
    strategyTouched: false, incomeTouched: false, optionTouched: false, floorTouched: false, ratioTouched: false, dcaTouched: false,
    clearStrategy: false, clearFloor: false, clearRatio: false, clearDca: false, cashMode: "", acknowledge: false,
  };
}

function emptyReview(): AccountSettingsReview {
  return { draft: false, risk: false };
}

function layerDraftValue(overrides: Record<string, any> | undefined, key: string): string {
  if (!overrides || !Object.prototype.hasOwnProperty.call(overrides, key)) return "";
  if (overrides[key] === true) return "true";
  if (overrides[key] === false) return "false";
  return "";
}

function incomeDraftValue(overrides: Record<string, any> | undefined): string {
  return layerDraftValue(overrides, "income_layer_enabled");
}

function effectiveText(settings: Record<string, any> | null, key: string): string {
  const field = settings?.effective?.[key];
  return field?.status === "known" && typeof field.value === "string" ? field.value : "";
}

function sameIdentity(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function savedNoticeGroup(op: AccountSettingsOp): AccountSettingsView["noticeGroup"] {
  if (op.body && Object.prototype.hasOwnProperty.call(op.body, "risk_preference")) return "risk";
  const overrides = op.body?.overrides;
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) return "";
  const record = overrides as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, "strategy_profile") || Object.prototype.hasOwnProperty.call(record, "dca_mode") || Object.prototype.hasOwnProperty.call(record, "dca_base_investment_usd")) return "strategy";
  if (Object.prototype.hasOwnProperty.call(record, "option_overlay_enabled")) return "option";
  if (Object.prototype.hasOwnProperty.call(record, "income_layer_enabled")) return "income";
  if (Object.prototype.hasOwnProperty.call(record, "reserved_cash_floor") || Object.prototype.hasOwnProperty.call(record, "reserved_cash_ratio")) return "cash";
  return "";
}

function emptyView(): AccountSettingsView {
  return { account: null, settings: null, preference: "", notice: "", noticeGroup: "", unavailable: "", saving: "", review: emptyReview(), draft: blankDraft() };
}

function floorText(value: string): boolean {
  return /^\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value));
}

function positiveDcaAmount(value: string): boolean {
  return value.length <= 32 && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value)) && Number(value) > 0;
}

function strategyGroupDirty(draft: AccountSettingsDraftFields): boolean {
  return draft.strategyTouched === true || draft.dcaTouched === true || draft.clearDca === true;
}

function editedRatio(draft: AccountSettingsDraftFields): string | null {
  if (draft.cashMode === "ratio" || draft.cashMode === "both" || draft.percent !== "") return percentTextToRatio(draft.percent);
  return decimalUnitRatio(draft.ratio);
}

export function pendingDraftOverrides(draft: AccountSettingsDraftFields, scope: "all" | "cash" | "income" | "option" | "strategy" = "all"): AccountSettingOverridePatch | null {
  const overrides: AccountSettingOverridePatch = {};
  const includeStrategy = scope === "all" || scope === "strategy";
  const includeIncome = scope === "all" || scope === "income";
  const includeOption = scope === "all" || scope === "option";
  const includeCash = scope === "all" || scope === "cash";
  if (includeStrategy) {
    if (draft.clearDca) {
      overrides.dca_mode = null;
      overrides.dca_base_investment_usd = null;
    } else if (draft.dcaTouched) {
      if (draft.dcaMode !== "fixed" && draft.dcaMode !== "smart") return null;
      if (!positiveDcaAmount(draft.dcaAmount)) return null;
      overrides.dca_mode = draft.dcaMode;
      overrides.dca_base_investment_usd = draft.dcaAmount;
    }
    if (draft.clearStrategy) overrides.strategy_profile = null;
    else if (draft.strategyTouched && draft.strategy) overrides.strategy_profile = draft.strategy;
    else if ((draft.dcaTouched || draft.clearDca) && draft.dcaProfile) overrides.strategy_profile = draft.dcaProfile;
  }
  if (includeIncome) {
    if (draft.incomeTouched && draft.income === "true") overrides.income_layer_enabled = true;
    else if (draft.incomeTouched && draft.income === "false") overrides.income_layer_enabled = false;
    else if (draft.incomeTouched && draft.income === "clear") overrides.income_layer_enabled = null;
  }
  if (includeOption) {
    if (draft.optionTouched && draft.option === "true") overrides.option_overlay_enabled = true;
    else if (draft.optionTouched && draft.option === "false") overrides.option_overlay_enabled = false;
    else if (draft.optionTouched && draft.option === "clear") overrides.option_overlay_enabled = null;
  }
  if (includeCash) {
    if (draft.cashMode === "inherit") {
      overrides.reserved_cash_floor = null;
      overrides.reserved_cash_ratio = null;
    } else if (draft.cashMode === "floor") {
      if (!floorText(draft.floor)) return null;
      overrides.reserved_cash_floor = draft.floor;
      overrides.reserved_cash_ratio = "0";
    } else if (draft.cashMode === "ratio" || draft.cashMode === "both") {
      const ratio = editedRatio(draft);
      if (!ratio) return null;
      if (draft.cashMode === "both" && !floorText(draft.floor)) return null;
      overrides.reserved_cash_floor = draft.cashMode === "ratio" ? "0" : draft.floor;
      overrides.reserved_cash_ratio = ratio;
    } else {
      if (draft.clearFloor) overrides.reserved_cash_floor = null;
      else if (draft.floorTouched) {
        if (!floorText(draft.floor)) return null;
        overrides.reserved_cash_floor = draft.floor;
      }
      if (draft.clearRatio) overrides.reserved_cash_ratio = null;
      else if (draft.ratioTouched) {
        const ratio = editedRatio(draft);
        if (!ratio) return null;
        overrides.reserved_cash_ratio = ratio;
      }
    }
  }
  return overrides;
}

export function createAccountSettingsController() {
  const gate = createRequestGate();
  let selected: AccountSettingsAccount | null = null;
  let view = emptyView();
  let lastSettings: Record<string, any> | null = null;
  const sameAccount = (account: AccountSettingsAccount | null) => Boolean(
    selected && account && selected.platform === account.platform && selected.key === account.key,
  );
  const current = (op: AccountSettingsOp | null | undefined) => Boolean(
    op && gate.isCurrent(op.token) && sameAccount(op.account),
  );
  return {
    selectedId() {
      return selected ? `${selected.platform}:${selected.key}` : "";
    },
    view() {
      return view;
    },
    riskDirty() {
      const baseline = view.settings || lastSettings;
      return (view.preference || "") !== (typeof baseline?.risk?.preference === "string" ? baseline.risk.preference : "");
    },
    select(account: AccountSettingsAccount) {
      const changed = !sameAccount(account);
      selected = { platform: account.platform, key: account.key };
      if (changed) {
        gate.invalidate();
        view = { ...emptyView(), account: selected };
        lastSettings = null;
      }
      return this.start("read");
    },
    start(kind: AccountSettingsOp["kind"]): AccountSettingsOp {
      if (!selected) throw new Error("account_settings_account_required");
      return { token: gate.begin(), account: { platform: selected.platform, key: selected.key }, kind };
    },
    isCurrent(op: AccountSettingsOp | null | undefined) {
      return current(op);
    },
    abandon(op: AccountSettingsOp) {
      if (current(op)) gate.invalidate();
    },
    applyRead(op: AccountSettingsOp, payload: Record<string, any>, options: { preserveNotice?: boolean; keepCash?: boolean; keepPreference?: boolean; keepIncome?: boolean; keepStrategy?: boolean; keepOption?: boolean } = {}) {
      if (!current(op) || payload?.platform !== op.account.platform || payload?.key !== op.account.key) return false;
      const draft = payload.draft?.overrides || {};
      const savedPreference = typeof (view.settings || lastSettings)?.risk?.preference === "string" ? (view.settings || lastSettings)!.risk.preference : "";
      const keepCash = options.keepCash === true && cashDraftDirty(view.draft);
      const keepPreference = options.keepPreference === true && (view.preference || "") !== savedPreference;
      const keepIncome = options.keepIncome === true && view.draft.incomeTouched === true;
      const keepStrategy = options.keepStrategy === true && strategyGroupDirty(view.draft);
      const keepOption = options.keepOption === true && view.draft.optionTouched === true;
      lastSettings = payload;
      view = {
        account: { platform: op.account.platform, key: op.account.key },
        settings: payload,
        preference: keepPreference ? view.preference : (payload.risk?.preference || ""),
        notice: options.preserveNotice ? view.notice : "",
        noticeGroup: options.preserveNotice ? view.noticeGroup : "",
        unavailable: "",
        saving: "",
        review: emptyReview(),
        draft: {
          strategy: keepStrategy ? view.draft.strategy : (typeof draft.strategy_profile === "string" ? draft.strategy_profile : ""),
          floor: keepCash ? view.draft.floor : (typeof draft.reserved_cash_floor === "string" ? draft.reserved_cash_floor : ""),
          ratio: keepCash ? view.draft.ratio : (typeof draft.reserved_cash_ratio === "string" ? draft.reserved_cash_ratio : ""),
          percent: keepCash ? view.draft.percent : "",
          income: keepIncome ? view.draft.income : incomeDraftValue(draft),
          option: keepOption ? view.draft.option : layerDraftValue(draft, "option_overlay_enabled"),
          dcaMode: keepStrategy ? view.draft.dcaMode : (draft.dca_mode === "fixed" || draft.dca_mode === "smart" ? draft.dca_mode : (payload.current_dca_supported === true ? effectiveText(payload, "dca_mode") : "")),
          dcaAmount: keepStrategy ? view.draft.dcaAmount : (typeof draft.dca_base_investment_usd === "string" ? draft.dca_base_investment_usd : (payload.current_dca_supported === true ? effectiveText(payload, "dca_base_investment_usd") : "")),
          dcaProfile: keepStrategy ? view.draft.dcaProfile : (typeof draft.strategy_profile === "string" ? draft.strategy_profile : (payload.current_dca_supported === true ? effectiveText(payload, "strategy_profile") : "")),
          strategyTouched: keepStrategy ? view.draft.strategyTouched : false,
          incomeTouched: keepIncome,
          optionTouched: keepOption,
          floorTouched: keepCash ? view.draft.floorTouched : false,
          ratioTouched: keepCash ? view.draft.ratioTouched : false,
          dcaTouched: keepStrategy ? view.draft.dcaTouched : false,
          clearStrategy: keepStrategy ? view.draft.clearStrategy : false,
          clearDca: keepStrategy ? view.draft.clearDca : false,
          clearFloor: keepCash ? view.draft.clearFloor : false,
          clearRatio: keepCash ? view.draft.clearRatio : false,
          cashMode: keepCash ? view.draft.cashMode : "",
          acknowledge: false,
        },
      };
      return true;
    },
    applyUnavailable(op: AccountSettingsOp, message: string) {
      if (!current(op)) return false;
      view = { ...view, settings: null, unavailable: message, saving: "" };
      return true;
    },
    edit(patch: Partial<AccountSettingsDraftFields> & { preference?: string }) {
      if (!view.settings || !sameAccount(view.account)) return false;
      const { preference, ...draftPatch } = patch;
      view = {
        ...view,
        preference: preference === undefined ? view.preference : preference,
        draft: { ...view.draft, ...draftPatch },
      };
      return true;
    },
    startSave(kind: "draft" | "risk" | "cash" | "income" | "option" | "strategy") {
      if (!selected || !view.settings || !sameAccount(view.account)) return null;
      if (view.settings.platform !== selected.platform || view.settings.key !== selected.key) return null;
      if (!view.settings.identity || typeof view.settings.identity !== "object") return null;
      const account = { platform: selected.platform, key: selected.key };
      let body: Record<string, unknown>;
      if (kind === "risk") {
        if (view.settings.operations?.save_risk_preference !== true) return null;
        if (view.review?.risk) return null;
        if (!Number.isSafeInteger(view.settings.risk?.revision)) return null;
        body = {
          platform: account.platform,
          key: account.key,
          identity: view.settings.identity,
          expected_risk_revision: view.settings.risk.revision,
          risk_preference: view.preference || null,
        };
      } else {
        if (view.settings.operations?.save_draft !== true) return null;
        if ((kind === "option") && (view.draft.option === "true" || view.draft.option === "false") && view.settings.operations?.save_option_draft !== true) return null;
        if (view.review?.draft) return null;
        if (view.settings.draft?.status === "identity_conflict" && !view.draft.acknowledge) return null;
        const scope = kind === "income" || kind === "cash" || kind === "option" || kind === "strategy" ? kind : "all";
        const overrides = pendingDraftOverrides(view.draft, scope);
        if (overrides && kind === "strategy" && view.draft.optionTouched && view.draft.option === "clear") overrides.option_overlay_enabled = null;
        if (kind === "strategy" && !Object.prototype.hasOwnProperty.call(overrides || {}, "strategy_profile")) return null;
        if (!overrides || !Object.keys(overrides).length || !Number.isSafeInteger(view.settings.draft?.revision)) return null;
        body = {
          platform: account.platform,
          key: account.key,
          ...accountSettingDraftBody({
            expectedDraftRevision: view.settings.draft.revision,
            identity: view.settings.identity,
            overrides,
            acknowledgeIdentityConflict: view.settings.draft?.status === "identity_conflict" && view.draft.acknowledge,
          }),
        };
      }
      if (body.platform !== account.platform || body.key !== account.key) return null;
      return { token: gate.begin(), account, kind: "save" as const, body };
    },
    requestBody(op: AccountSettingsOp | null | undefined) {
      if (!op?.body || !current(op)) return null;
      if (op.body.platform !== op.account.platform || op.body.key !== op.account.key) return null;
      return op.body;
    },
    markSaving(op: AccountSettingsOp, kind: string) {
      if (!current(op)) return false;
      view = { ...view, saving: kind, notice: "" };
      return true;
    },
    applySave(op: AccountSettingsOp, payload: Record<string, any>, notice: string) {
      const overrides = op.body?.overrides as Record<string, unknown> | undefined;
      const intendedCash = pendingDraftOverrides(view.draft, "cash");
      const sentCash = Boolean(overrides && (Object.prototype.hasOwnProperty.call(overrides, "reserved_cash_floor") || Object.prototype.hasOwnProperty.call(overrides, "reserved_cash_ratio")));
      const sentIncome = Boolean(overrides && Object.prototype.hasOwnProperty.call(overrides, "income_layer_enabled"));
      const sentOption = Boolean(overrides && Object.prototype.hasOwnProperty.call(overrides, "option_overlay_enabled"));
      const sentStrategy = Boolean(overrides && Object.prototype.hasOwnProperty.call(overrides, "strategy_profile"));
      const sentDca = Boolean(overrides && (Object.prototype.hasOwnProperty.call(overrides, "dca_mode") || Object.prototype.hasOwnProperty.call(overrides, "dca_base_investment_usd")));
      const sentRisk = Boolean(op.body && Object.prototype.hasOwnProperty.call(op.body, "risk_preference"));
      const sentIncomeValue = view.draft.income === "true" ? true : view.draft.income === "false" ? false : null;
      const sentOptionValue = view.draft.option === "true" ? true : view.draft.option === "false" ? false : null;
      const cashMoved = cashDraftDirty(view.draft) && (intendedCash === null || (["reserved_cash_floor", "reserved_cash_ratio"] as const).some((key) => {
        if (!Object.prototype.hasOwnProperty.call(intendedCash, key)) return false;
        return !overrides || !Object.prototype.hasOwnProperty.call(overrides, key) || overrides[key] !== intendedCash[key];
      }));
      const incomeMoved = view.draft.incomeTouched === true && !(sentIncome && overrides?.income_layer_enabled === sentIncomeValue);
      const optionMoved = view.draft.optionTouched === true && !(sentOption && overrides?.option_overlay_enabled === sentOptionValue);
      const strategyMatches = sentStrategy && ((view.draft.clearStrategy && overrides?.strategy_profile === null) || (view.draft.strategyTouched && overrides?.strategy_profile === view.draft.strategy) || ((view.draft.dcaTouched || view.draft.clearDca) && overrides?.strategy_profile === view.draft.dcaProfile));
      const strategyMoved = view.draft.strategyTouched === true && !strategyMatches;
      const dcaMatches = sentDca && ((view.draft.clearDca && overrides?.dca_mode === null && overrides?.dca_base_investment_usd === null) || (!view.draft.clearDca && overrides?.dca_mode === view.draft.dcaMode && overrides?.dca_base_investment_usd === view.draft.dcaAmount));
      const dcaMoved = (view.draft.dcaTouched === true || view.draft.clearDca === true) && !dcaMatches;
      const strategyGroupMoved = strategyMoved || dcaMoved;
      const savedPreference = typeof (view.settings || lastSettings)?.risk?.preference === "string" ? (view.settings || lastSettings)!.risk.preference : "";
      const preferenceMoved = sentRisk
        ? (view.preference || "") !== (op.body?.risk_preference || "")
        : (view.preference || "") !== savedPreference;
      const review = view.review || emptyReview();
      const beforeSettings = view.settings || lastSettings;
      const identityChanged = !sameIdentity(beforeSettings?.identity, payload?.identity);
      const draftDirty = cashDraftDirty(view.draft) || view.draft.incomeTouched === true || view.draft.optionTouched === true || strategyGroupDirty(view.draft);
      const draftConflict = !sentCash && !sentIncome && !sentOption && !sentStrategy && !sentDca && draftDirty && (identityChanged || beforeSettings?.draft?.revision !== payload?.draft?.revision);
      const riskConflict = !sentRisk && preferenceMoved && (identityChanged || beforeSettings?.risk?.revision !== payload?.risk?.revision);
      if (!this.applyRead(op, payload, {
        keepCash: sentCash ? cashMoved : cashDraftDirty(view.draft),
        keepIncome: sentIncome ? incomeMoved : view.draft.incomeTouched === true,
        keepOption: sentOption ? optionMoved : view.draft.optionTouched === true,
        keepStrategy: (sentStrategy || sentDca) ? strategyGroupMoved : strategyGroupDirty(view.draft),
        keepPreference: preferenceMoved,
      })) return false;
      const sentDraft = sentCash || sentIncome || sentOption || sentStrategy || sentDca;
      const otherMoved = (sentCash && (incomeMoved || optionMoved || strategyGroupMoved))
        || (sentIncome && (cashMoved || optionMoved || strategyGroupMoved))
        || (sentOption && (cashMoved || incomeMoved || strategyGroupMoved))
        || ((sentStrategy || sentDca) && (cashMoved || incomeMoved || optionMoved));
      view = {
        ...view,
        notice,
        noticeGroup: savedNoticeGroup(op),
        saving: "",
        review: {
          draft: sentDraft ? Boolean(identityChanged && otherMoved) : review.draft || draftConflict,
          risk: sentRisk ? false : review.risk || riskConflict,
        },
      };
      return true;
    },
    fail(op: AccountSettingsOp, notice: string) {
      if (!current(op)) return false;
      view = { ...view, notice, noticeGroup: "", saving: "" };
      return true;
    },
    applyRefresh(op: AccountSettingsOp, payload: Record<string, any>) {
      if (!current(op)) return false;
      const before = view;
      const notice = before.notice;
      const beforeSettings = before.settings || lastSettings;
      const dirtyCash = cashDraftDirty(before.draft);
      const dirtyIncome = before.draft.incomeTouched === true;
      const dirtyOption = before.draft.optionTouched === true;
      const dirtyStrategy = strategyGroupDirty(before.draft);
      const savedPreference = typeof beforeSettings?.risk?.preference === "string" ? beforeSettings!.risk.preference : "";
      const dirtyRisk = (before.preference || "") !== savedPreference;
      const identityChanged = !sameIdentity(beforeSettings?.identity, payload?.identity);
      const draftChanged = Number(beforeSettings?.draft?.revision) !== Number(payload?.draft?.revision);
      const riskChanged = Number(beforeSettings?.risk?.revision) !== Number(payload?.risk?.revision);
      if (!this.applyRead(op, payload, { preserveNotice: true, keepCash: true, keepPreference: true, keepIncome: true, keepOption: true, keepStrategy: true })) return false;
      view = {
        ...view,
        notice,
        saving: "",
        review: {
          draft: Boolean(before.review?.draft) || (dirtyCash || dirtyIncome || dirtyOption || dirtyStrategy) && (identityChanged || draftChanged),
          risk: Boolean(before.review?.risk) || dirtyRisk && (identityChanged || riskChanged),
        },
      };
      return true;
    },
    acknowledgeReview(kind: "draft" | "risk") {
      if (!view.review?.[kind]) return false;
      view = { ...view, review: { ...view.review, [kind]: false } };
      return true;
    },
    revertDraft() {
      if (!view.settings) return false;
      const overrides = view.settings.draft?.overrides || {};
      view = {
        ...view,
        review: { draft: false, risk: Boolean(view.review?.risk) },
        draft: {
          ...blankDraft(),
          strategy: typeof overrides.strategy_profile === "string" ? overrides.strategy_profile : "",
          dcaMode: overrides.dca_mode === "fixed" || overrides.dca_mode === "smart" ? overrides.dca_mode : (view.settings.current_dca_supported === true ? effectiveText(view.settings, "dca_mode") : ""),
          dcaAmount: typeof overrides.dca_base_investment_usd === "string" ? overrides.dca_base_investment_usd : (view.settings.current_dca_supported === true ? effectiveText(view.settings, "dca_base_investment_usd") : ""),
          dcaProfile: typeof overrides.strategy_profile === "string" ? overrides.strategy_profile : (view.settings.current_dca_supported === true ? effectiveText(view.settings, "strategy_profile") : ""),
          floor: typeof overrides.reserved_cash_floor === "string" ? overrides.reserved_cash_floor : "",
          ratio: typeof overrides.reserved_cash_ratio === "string" ? overrides.reserved_cash_ratio : "",
          income: incomeDraftValue(overrides),
          option: layerDraftValue(overrides, "option_overlay_enabled"),
        },
      };
      return true;
    },
    revertCash() {
      if (!view.settings) return false;
      const overrides = view.settings.draft?.overrides || {};
      const incomeStill = view.draft.incomeTouched === true || view.draft.optionTouched === true || strategyGroupDirty(view.draft);
      view = {
        ...view,
        review: { draft: incomeStill ? Boolean(view.review?.draft) : false, risk: Boolean(view.review?.risk) },
        draft: {
          ...view.draft,
          floor: typeof overrides.reserved_cash_floor === "string" ? overrides.reserved_cash_floor : "",
          ratio: typeof overrides.reserved_cash_ratio === "string" ? overrides.reserved_cash_ratio : "",
          percent: "",
          floorTouched: false,
          ratioTouched: false,
          clearFloor: false,
          clearRatio: false,
          cashMode: "",
        },
      };
      return true;
    },
    revertStrategy() {
      if (!view.settings) return false;
      const overrides = view.settings.draft?.overrides || {};
      const still = cashDraftDirty(view.draft) || view.draft.incomeTouched === true || view.draft.optionTouched === true;
      const current = view.settings.draft?.overrides || {};
      view = {
        ...view,
        review: { draft: still ? Boolean(view.review?.draft) : false, risk: Boolean(view.review?.risk) },
        draft: {
          ...view.draft,
          strategy: typeof overrides.strategy_profile === "string" ? overrides.strategy_profile : "",
          dcaMode: current.dca_mode === "fixed" || current.dca_mode === "smart" ? current.dca_mode : (view.settings.current_dca_supported === true ? effectiveText(view.settings, "dca_mode") : ""),
          dcaAmount: typeof current.dca_base_investment_usd === "string" ? current.dca_base_investment_usd : (view.settings.current_dca_supported === true ? effectiveText(view.settings, "dca_base_investment_usd") : ""),
          dcaProfile: typeof current.strategy_profile === "string" ? current.strategy_profile : (view.settings.current_dca_supported === true ? effectiveText(view.settings, "strategy_profile") : ""),
          strategyTouched: false,
          dcaTouched: false,
          clearStrategy: false,
          clearDca: false,
        },
      };
      return true;
    },
    revertOption() {
      if (!view.settings) return false;
      const overrides = view.settings.draft?.overrides || {};
      const still = cashDraftDirty(view.draft) || view.draft.incomeTouched === true || strategyGroupDirty(view.draft);
      view = {
        ...view,
        review: { draft: still ? Boolean(view.review?.draft) : false, risk: Boolean(view.review?.risk) },
        draft: {
          ...view.draft,
          option: layerDraftValue(overrides, "option_overlay_enabled"),
          optionTouched: false,
        },
      };
      return true;
    },
    revertRisk() {
      if (!view.settings) return false;
      view = {
        ...view,
        preference: typeof view.settings.risk?.preference === "string" ? view.settings.risk.preference : "",
        review: { draft: Boolean(view.review?.draft), risk: false },
      };
      return true;
    },
    finish(op: AccountSettingsOp) {
      if (!current(op)) return false;
      view = { ...view, saving: "" };
      return true;
    },
  };
}
