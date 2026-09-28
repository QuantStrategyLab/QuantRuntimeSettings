import { accountSettingDraftBody, type AccountSettingOverridePatch } from "./operations.ts";
import { createRequestGate } from "./requestGate.js";

export type AccountSettingsAccount = { platform: string; key: string };
export type AccountSettingsDraftFields = {
  strategy: string;
  floor: string;
  income: string;
  strategyTouched: boolean;
  incomeTouched: boolean;
  floorTouched: boolean;
  clearStrategy: boolean;
  clearFloor: boolean;
  acknowledge: boolean;
};
export type AccountSettingsReview = { draft: boolean; risk: boolean };
export type AccountSettingsView = {
  account: AccountSettingsAccount | null;
  settings: Record<string, any> | null;
  preference: string;
  notice: string;
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
    strategy: "", floor: "", income: "",
    strategyTouched: false, incomeTouched: false, floorTouched: false,
    clearStrategy: false, clearFloor: false, acknowledge: false,
  };
}

function emptyReview(): AccountSettingsReview {
  return { draft: false, risk: false };
}

function incomeDraftValue(overrides: Record<string, any> | undefined): string {
  if (!overrides || !Object.prototype.hasOwnProperty.call(overrides, "income_layer_enabled")) return "";
  if (overrides.income_layer_enabled === true) return "true";
  if (overrides.income_layer_enabled === false) return "false";
  return "";
}

function sameIdentity(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function emptyView(): AccountSettingsView {
  return { account: null, settings: null, preference: "", notice: "", unavailable: "", saving: "", review: emptyReview(), draft: blankDraft() };
}

function draftOverrides(draft: AccountSettingsDraftFields): AccountSettingOverridePatch {
  const overrides: AccountSettingOverridePatch = {};
  if (draft.clearStrategy) overrides.strategy_profile = null;
  else if (draft.strategyTouched) overrides.strategy_profile = draft.strategy;
  if (draft.incomeTouched && draft.income === "true") overrides.income_layer_enabled = true;
  else if (draft.incomeTouched && draft.income === "false") overrides.income_layer_enabled = false;
  else if (draft.incomeTouched && draft.income === "clear") overrides.income_layer_enabled = null;
  if (draft.clearFloor) overrides.reserved_cash_floor = null;
  else if (draft.floorTouched) overrides.reserved_cash_floor = draft.floor;
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
    applyRead(op: AccountSettingsOp, payload: Record<string, any>, options: { preserveNotice?: boolean; keepCash?: boolean; keepPreference?: boolean; keepIncome?: boolean } = {}) {
      if (!current(op) || payload?.platform !== op.account.platform || payload?.key !== op.account.key) return false;
      const draft = payload.draft?.overrides || {};
      const savedPreference = typeof (view.settings || lastSettings)?.risk?.preference === "string" ? (view.settings || lastSettings)!.risk.preference : "";
      const keepCash = options.keepCash === true && (view.draft.floorTouched || view.draft.clearFloor);
      const keepPreference = options.keepPreference === true && (view.preference || "") !== savedPreference;
      const keepIncome = options.keepIncome === true && view.draft.incomeTouched === true;
      lastSettings = payload;
      view = {
        account: { platform: op.account.platform, key: op.account.key },
        settings: payload,
        preference: keepPreference ? view.preference : (payload.risk?.preference || ""),
        notice: options.preserveNotice ? view.notice : "",
        unavailable: "",
        saving: "",
        review: emptyReview(),
        draft: {
          strategy: typeof draft.strategy_profile === "string" ? draft.strategy_profile : "",
          floor: keepCash ? view.draft.floor : (typeof draft.reserved_cash_floor === "string" ? draft.reserved_cash_floor : ""),
          income: keepIncome ? view.draft.income : incomeDraftValue(draft),
          strategyTouched: false,
          incomeTouched: keepIncome,
          floorTouched: keepCash ? view.draft.floorTouched : false,
          clearStrategy: false,
          clearFloor: keepCash ? view.draft.clearFloor : false,
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
    startSave(kind: "draft" | "risk") {
      if (!selected || !view.settings || !sameAccount(view.account)) return null;
      if (view.settings.platform !== selected.platform || view.settings.key !== selected.key) return null;
      if (!view.settings.identity || typeof view.settings.identity !== "object") return null;
      const account = { platform: selected.platform, key: selected.key };
      let body: Record<string, unknown>;
      if (kind === "risk") {
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
        if (view.review?.draft) return null;
        if (view.settings.draft?.status === "identity_conflict" && !view.draft.acknowledge) return null;
        const overrides = draftOverrides(view.draft);
        if (!Object.keys(overrides).length || !Number.isSafeInteger(view.settings.draft?.revision)) return null;
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
      const sentCash = Boolean(overrides && Object.prototype.hasOwnProperty.call(overrides, "reserved_cash_floor"));
      const sentIncome = Boolean(overrides && Object.prototype.hasOwnProperty.call(overrides, "income_layer_enabled"));
      const sentRisk = Boolean(op.body && Object.prototype.hasOwnProperty.call(op.body, "risk_preference"));
      const sentIncomeValue = view.draft.income === "true" ? true : view.draft.income === "false" ? false : null;
      const cashMoved = view.draft.clearFloor
        ? !(sentCash && overrides?.reserved_cash_floor === null)
        : view.draft.floorTouched && !(sentCash && overrides?.reserved_cash_floor === view.draft.floor);
      const incomeMoved = view.draft.incomeTouched === true && !(sentIncome && overrides?.income_layer_enabled === sentIncomeValue);
      const savedPreference = typeof (view.settings || lastSettings)?.risk?.preference === "string" ? (view.settings || lastSettings)!.risk.preference : "";
      const preferenceMoved = sentRisk
        ? (view.preference || "") !== (op.body?.risk_preference || "")
        : (view.preference || "") !== savedPreference;
      const review = view.review || emptyReview();
      const beforeSettings = view.settings || lastSettings;
      const identityChanged = !sameIdentity(beforeSettings?.identity, payload?.identity);
      const draftConflict = !sentCash && !sentIncome && (view.draft.floorTouched || view.draft.clearFloor || view.draft.incomeTouched) && (identityChanged || beforeSettings?.draft?.revision !== payload?.draft?.revision);
      const riskConflict = !sentRisk && preferenceMoved && (identityChanged || beforeSettings?.risk?.revision !== payload?.risk?.revision);
      if (!this.applyRead(op, payload, {
        keepCash: sentCash ? cashMoved : view.draft.floorTouched || view.draft.clearFloor,
        keepIncome: sentIncome ? incomeMoved : view.draft.incomeTouched === true,
        keepPreference: preferenceMoved,
      })) return false;
      view = {
        ...view,
        notice,
        saving: "",
        review: {
          draft: sentCash || sentIncome ? false : review.draft || draftConflict,
          risk: sentRisk ? false : review.risk || riskConflict,
        },
      };
      return true;
    },
    fail(op: AccountSettingsOp, notice: string) {
      if (!current(op)) return false;
      view = { ...view, notice, saving: "" };
      return true;
    },
    applyRefresh(op: AccountSettingsOp, payload: Record<string, any>) {
      if (!current(op)) return false;
      const before = view;
      const notice = before.notice;
      const beforeSettings = before.settings || lastSettings;
      const dirtyCash = before.draft.floorTouched || before.draft.clearFloor;
      const dirtyIncome = before.draft.incomeTouched === true;
      const savedPreference = typeof beforeSettings?.risk?.preference === "string" ? beforeSettings!.risk.preference : "";
      const dirtyRisk = (before.preference || "") !== savedPreference;
      const identityChanged = !sameIdentity(beforeSettings?.identity, payload?.identity);
      const draftChanged = Number(beforeSettings?.draft?.revision) !== Number(payload?.draft?.revision);
      const riskChanged = Number(beforeSettings?.risk?.revision) !== Number(payload?.risk?.revision);
      if (!this.applyRead(op, payload, { preserveNotice: true, keepCash: true, keepPreference: true, keepIncome: true })) return false;
      view = {
        ...view,
        notice,
        saving: "",
        review: {
          draft: Boolean(before.review?.draft) || (dirtyCash || dirtyIncome) && (identityChanged || draftChanged),
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
          ...view.draft,
          floor: typeof overrides.reserved_cash_floor === "string" ? overrides.reserved_cash_floor : "",
          floorTouched: false,
          clearFloor: false,
          income: incomeDraftValue(overrides),
          incomeTouched: false,
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
