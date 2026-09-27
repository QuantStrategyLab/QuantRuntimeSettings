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
export type AccountSettingsView = {
  account: AccountSettingsAccount | null;
  settings: Record<string, any> | null;
  preference: string;
  notice: string;
  unavailable: string;
  saving: string;
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

function emptyView(): AccountSettingsView {
  return { account: null, settings: null, preference: "", notice: "", unavailable: "", saving: "", draft: blankDraft() };
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
    select(account: AccountSettingsAccount) {
      const changed = !sameAccount(account);
      selected = { platform: account.platform, key: account.key };
      if (changed) {
        gate.invalidate();
        view = { ...emptyView(), account: selected };
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
    applyRead(op: AccountSettingsOp, payload: Record<string, any>, options: { preserveNotice?: boolean } = {}) {
      if (!current(op) || payload?.platform !== op.account.platform || payload?.key !== op.account.key) return false;
      const draft = payload.draft?.status === "current" ? payload.draft.overrides || {} : {};
      view = {
        account: { platform: op.account.platform, key: op.account.key },
        settings: payload,
        preference: payload.risk?.preference || "",
        notice: options.preserveNotice ? view.notice : "",
        unavailable: "",
        saving: "",
        draft: {
          strategy: typeof draft.strategy_profile === "string" ? draft.strategy_profile : "",
          floor: typeof draft.reserved_cash_floor === "string" ? draft.reserved_cash_floor : "",
          income: typeof draft.income_layer_enabled === "boolean" ? String(draft.income_layer_enabled) : "",
          strategyTouched: false, incomeTouched: false, floorTouched: false,
          clearStrategy: false, clearFloor: false, acknowledge: false,
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
        if (!Number.isSafeInteger(view.settings.risk?.revision)) return null;
        body = {
          platform: account.platform,
          key: account.key,
          identity: view.settings.identity,
          expected_risk_revision: view.settings.risk.revision,
          risk_preference: view.preference || null,
        };
      } else {
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
      if (!this.applyRead(op, payload)) return false;
      view = { ...view, notice, saving: "" };
      return true;
    },
    fail(op: AccountSettingsOp, notice: string) {
      if (!current(op)) return false;
      view = { ...view, notice, saving: "" };
      return true;
    },
    applyRefresh(op: AccountSettingsOp, payload: Record<string, any>) {
      if (!current(op)) return false;
      const notice = view.notice;
      if (!this.applyRead(op, payload, { preserveNotice: true })) return false;
      view = { ...view, notice, saving: "" };
      return true;
    },
    finish(op: AccountSettingsOp) {
      if (!current(op)) return false;
      view = { ...view, saving: "" };
      return true;
    },
  };
}
