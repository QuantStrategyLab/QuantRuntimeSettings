import type {
  AccountManagementApplyRequest,
  AccountManagementDraftSaveRequest,
  AccountManagementReceipt,
  AccountManagementSettingsSection,
} from "./api/contracts.ts";
import { accountSettingDraftBody, type AccountSettingOverridePatch } from "./operations.ts";
import { cashDraftDirty, decimalUnitRatio, percentTextToRatio } from "./presentation.ts";
import { createRequestGate } from "./requestGate.js";

export type AccountSettingsReadbackResult = { status: "ready" } | { status: "superseded" } | { status: "failed"; message: string };

export async function refreshAccountSettingsReadback(
  controller: Pick<ReturnType<typeof createAccountSettingsController>, "isCurrent" | "applyRefresh" | "abandon">,
  op: AccountSettingsOp,
  read: () => Promise<Record<string, any>>,
): Promise<AccountSettingsReadbackResult> {
  try {
    const payload = await read();
    if (!controller.isCurrent(op)) return { status: "superseded" };
    if (!controller.applyRefresh(op, payload)) {
      controller.abandon(op);
      return { status: "failed", message: "设置读回与所选账户不一致，请重新读取。" };
    }
    return { status: "ready" };
  } catch (error) {
    if (!controller.isCurrent(op)) return { status: "superseded" };
    controller.abandon(op);
    const status = Number((error as { status?: number })?.status || 0);
    return { status: "failed", message: status === 401 || status === 403 ? "没有权限读取这项设置。" : "账户设置暂时读不到。" };
  }
}

export type AccountSettingsAccount = { platform: string; key: string };
export type CashEditMode = "" | "inherit" | "floor" | "ratio" | "both";
export type AccountDeclarationFields = { environment: "" | "live" | "paper"; accountType: "" | "cash" | "margin" };
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
export type AccountSettingsReview = { draft: boolean; risk: boolean; declaration: boolean; management: boolean };
export type AccountManagementEditorState = {
  section: AccountManagementSettingsSection | null;
  draftValue: "" | "true" | "false";
  dirty: boolean;
  saving: "" | "management_draft" | "management_apply";
  uncertain: boolean;
  uncertainRequestKey: string | null;
  uncertainOperation: "" | "management_draft" | "management_apply";
  staleReplayIgnored: boolean;
};
export type AccountSettingsView = {
  account: AccountSettingsAccount | null;
  settings: Record<string, any> | null;
  preference: string;
  declaration: AccountDeclarationFields;
  notice: string;
  noticeGroup: "" | "cash" | "income" | "option" | "strategy" | "risk" | "declaration" | "management";
  unavailable: string;
  saving: string;
  review: AccountSettingsReview;
  draft: AccountSettingsDraftFields;
  management: AccountManagementEditorState;
};
export type AccountSettingsOp = {
  token: number;
  account: AccountSettingsAccount;
  kind: "read" | "save" | "refresh" | "management_draft" | "management_apply";
  body?: Record<string, unknown>;
};
type ManagementPendingSave = {
  token: number;
  requestKey: string;
  operation: "management_draft" | "management_apply";
  account: AccountSettingsAccount;
  siblings: string[];
  identity: unknown;
  instanceRevision: number;
  policyRevision: number;
  draftRevision: number;
  appliedRevision: number;
  targetEnabled: boolean | null;
};
type AccountSettingsSaveSnapshot = {
  token: number;
  body: Record<string, any>;
  draft: { status: string; revision: number; identity: unknown; current_identity: unknown; overrides: Record<string, unknown> };
  risk: { revision: number; scope_id: string; preference: string | null };
  declaration: { present: boolean; status: string; revision: number; environment: string | null; account_type: string | null; source: string | null };
};

function record(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function copyJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sameSavedValue(left: unknown, right: unknown): boolean {
  const canonical = (value: unknown): unknown => Array.isArray(value)
    ? value.map(canonical)
    : record(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function validDeclaration(value: unknown): value is Record<string, any> {
  return record(value) && ["empty", "current", "identity_conflict"].includes(value.status)
    && value.source === "user_declared" && Number.isSafeInteger(value.revision) && value.revision >= 0
    && [null, "live", "paper"].includes(value.environment) && [null, "cash", "margin"].includes(value.account_type);
}

function matchesSaveAcknowledgement(snapshot: AccountSettingsSaveSnapshot, payload: Record<string, any>): boolean {
  const body = snapshot.body;
  if (!record(payload) || payload.ok !== true || payload.platform !== body.platform || payload.key !== body.key
    || !record(payload.identity) || !sameSavedValue(payload.identity, body.identity)
    || payload.adopted !== false || payload.no_order !== true || payload.execution_authority_granted !== false) return false;
  // applyRead refreshes both groups. A partial envelope must not erase the
  // unsubmitted group's saved baseline even when the submitted values match.
  if (!record(payload.draft) || !["empty", "current", "identity_conflict"].includes(payload.draft.status)
    || !Number.isSafeInteger(payload.draft.revision) || payload.draft.revision < 0 || !record(payload.draft.overrides)
    || !record(payload.draft.current_identity) || !sameSavedValue(payload.draft.current_identity, body.identity)
    || !record(payload.risk) || !Number.isSafeInteger(payload.risk.revision) || payload.risk.revision < 0
    || typeof snapshot.risk.scope_id !== "string" || !snapshot.risk.scope_id || payload.risk.scope_id !== snapshot.risk.scope_id
    || ![null, "CAPITAL_PRESERVATION", "BALANCED_COMPOUNDING", "GROWTH_COMPOUNDING"].includes(payload.risk.preference)) return false;
  const declaration = payload.declaration;
  const submittedDeclaration = Object.prototype.hasOwnProperty.call(body, "declaration");
  if (snapshot.declaration.present || submittedDeclaration) {
    if (!validDeclaration(declaration)) return false;
    if (submittedDeclaration) {
      if (!record(body.declaration) || declaration.status !== "current"
        || declaration.revision !== snapshot.declaration.revision + 1
        || declaration.environment !== body.declaration.environment
        || declaration.account_type !== body.declaration.account_type) return false;
    } else if (declaration.revision < snapshot.declaration.revision
      || (declaration.revision === snapshot.declaration.revision && !sameSavedValue(
        {status:declaration.status,revision:declaration.revision,environment:declaration.environment,account_type:declaration.account_type,source:declaration.source},
        {status:snapshot.declaration.status,revision:snapshot.declaration.revision,environment:snapshot.declaration.environment,account_type:snapshot.declaration.account_type,source:snapshot.declaration.source}))) return false;
  }
  if (!Object.prototype.hasOwnProperty.call(body, "overrides")) {
    const draft = payload.draft;
    if (draft.revision < snapshot.draft.revision || (draft.revision === snapshot.draft.revision
      && !sameSavedValue({ status: draft.status, revision: draft.revision, identity: draft.identity, current_identity: draft.current_identity, overrides: draft.overrides }, snapshot.draft))) return false;
  }
  if (!Object.prototype.hasOwnProperty.call(body, "risk_preference")) {
    const risk = payload.risk;
    if (risk.revision < snapshot.risk.revision || (risk.revision === snapshot.risk.revision
      && risk.preference !== snapshot.risk.preference)) return false;
  }
  if (Object.prototype.hasOwnProperty.call(body, "overrides")) {
    const draft = payload.draft;
    if (!record(draft) || draft.status !== "current" || !record(draft.overrides)
      || !record(draft.identity) || !sameSavedValue(draft.identity, body.identity)
      || !record(draft.current_identity) || !sameSavedValue(draft.current_identity, body.identity)) return false;
    const rebuilding = snapshot.draft.status === "identity_conflict" && body.acknowledge_identity_conflict === true;
    const expected = rebuilding ? {} : { ...snapshot.draft.overrides };
    for (const [key, value] of Object.entries(body.overrides)) {
      if (value === null) delete expected[key]; else expected[key] = value;
    }
    const changed = snapshot.draft.status === "empty" || rebuilding || !sameSavedValue(expected, snapshot.draft.overrides);
    const revision = snapshot.draft.revision + (changed ? 1 : 0);
    if (!Number.isSafeInteger(revision) || revision < 0 || draft.revision !== revision
      || !sameSavedValue(draft.overrides, expected)) return false;
  }
  if (Object.prototype.hasOwnProperty.call(body, "risk_preference")) {
    const risk = payload.risk;
    if (!record(risk) || typeof snapshot.risk.scope_id !== "string" || !snapshot.risk.scope_id
      || risk.scope_id !== snapshot.risk.scope_id || risk.preference !== body.risk_preference
      || !Number.isSafeInteger(risk.revision) || risk.revision < 0) return false;
    const changed = body.risk_preference !== snapshot.risk.preference;
    const revision = snapshot.risk.revision + (changed ? 1 : 0);
    // Setting the same preference can still refresh server-owned actor/time
    // metadata. A cleared, already-absent binding does not have that variation.
    const metadataOnlyChange = !changed && body.risk_preference !== null && risk.revision === revision + 1;
    if (!Number.isSafeInteger(revision) || (risk.revision !== revision && !metadataOnlyChange)) return false;
  }
  return true;
}

function blankDraft(): AccountSettingsDraftFields {
  return {
    strategy: "", floor: "", ratio: "", percent: "", income: "", option: "",
    dcaMode: "", dcaAmount: "", dcaProfile: "",
    strategyTouched: false, incomeTouched: false, optionTouched: false, floorTouched: false, ratioTouched: false, dcaTouched: false,
    clearStrategy: false, clearFloor: false, clearRatio: false, clearDca: false, cashMode: "", acknowledge: false,
  };
}

function emptyReview(): AccountSettingsReview {
  return { draft: false, risk: false, declaration: false, management: false };
}

function emptyManagementState(): AccountManagementEditorState {
  return {
    section: null,
    draftValue: "",
    dirty: false,
    saving: "",
    uncertain: false,
    uncertainRequestKey: null,
    uncertainOperation: "",
    staleReplayIgnored: false,
  };
}

const BLOCKING_MANAGEMENT_REASONS = new Set([
  "management_policy_unavailable",
  "management_policy_invalid",
  "runtime_instances_not_initialized",
  "deployment_unclassified",
  "deployment_claimed_by_multiple_accounts",
  "sibling_not_current",
  "sibling_duplicated",
  "sibling_retiring",
  "top_config_key_mismatch",
  "physical_identity_changed",
  "claimant_shadowing",
  "legacy_key_cross_platform_collision",
  "local_history_unreadable",
  "stored_identity_differs_from_current",
  "stored_identity_unreadable",
  "management_identity_differs_from_current",
  "management_record_unreadable",
  "management_journal_unreadable",
  "local_store_unreadable",
  "declared_environment_differs_from_current",
  "management_binding_changed",
  "history_identity_differs_from_current",
]);

function validManagementSection(value: unknown): value is AccountManagementSettingsSection {
  return record(value)
    && typeof value.evidence_scope === "string"
    && typeof value.management_status === "string"
    && typeof value.evidence_state === "string"
    && Array.isArray(value.reasons)
    && typeof value.processing_eligible === "boolean"
    && Array.isArray(value.siblings);
}

function managementDraftBaseline(section: AccountManagementSettingsSection | null): "" | "true" | "false" {
  if (!section) return "";
  if (section.draft?.status === "pending") return section.draft.management_enabled ? "true" : "false";
  if (section.applied) return section.applied.management_enabled ? "true" : "false";
  return "";
}

function canWriteManagement(
  settings: Record<string, any> | null,
  section: AccountManagementSettingsSection | null,
): section is AccountManagementSettingsSection {
  if (!settings || !section) return false;
  if (settings.operations?.save_draft !== true) return false;
  if (section.management_class !== "eligible") return false;
  if (!Number.isSafeInteger(section.policy_revision) || (section.policy_revision ?? 0) < 1) return false;
  if (!Number.isSafeInteger(section.instance_revision) || (section.instance_revision ?? -1) < 0) return false;
  if (section.evidence_state === "conflict") return false;
  return !section.reasons.some(reason => BLOCKING_MANAGEMENT_REASONS.has(reason));
}

function managementSiblingKeys(
  account: AccountSettingsAccount,
  siblings?: ReadonlyArray<{ platform?: string; key?: string; legacy_key?: string }> | null,
): string[] {
  const keys = new Set([`${account.platform}:${account.key}`]);
  for (const item of siblings || []) {
    const k = typeof item.key === "string" && item.key ? item.key : item.legacy_key;
    if (typeof item.platform === "string" && item.platform && typeof k === "string" && k) {
      keys.add(`${item.platform}:${k}`);
    }
  }
  return [...keys];
}

function matchesManagementAcknowledgement(
  pending: ManagementPendingSave,
  payload: Record<string, any>,
): boolean {
  if (!record(payload) || !sameSavedValue(payload.identity, pending.identity)) return false;
  const section = payload.management;
  if (!validManagementSection(section)) return false;
  const draftRevision = section.draft?.revision ?? 0;
  const appliedRevision = section.applied?.revision ?? 0;
  if (pending.operation === "management_draft") {
    if (draftRevision <= pending.draftRevision) return false;
    if (draftRevision === pending.draftRevision + 1 && section.draft?.status === "pending") {
      return section.draft.management_enabled === pending.targetEnabled;
    }
    return true;
  }
  if (appliedRevision <= pending.appliedRevision) return false;
  if (appliedRevision === pending.appliedRevision + 1) {
    return section.applied?.management_enabled === pending.targetEnabled
      && (section.draft?.consumed_applied_revision ?? 0) >= appliedRevision;
  }
  return true;
}

const MANAGEMENT_STORES = new WeakMap<
  Map<string, AccountSettingsSaveSnapshot>,
  {
    pending: Map<string, ManagementPendingSave>;
    cache: Map<string, AccountManagementSettingsSection>;
  }
>();

function managementStoreFor(unresolvedSaves: Map<string, AccountSettingsSaveSnapshot>) {
  let store = MANAGEMENT_STORES.get(unresolvedSaves);
  if (!store) {
    store = { pending: new Map(), cache: new Map() };
    MANAGEMENT_STORES.set(unresolvedSaves, store);
  }
  return store;
}

function newRequestKey(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return "00000000-0000-4000-8000-000000000001";
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

export function sameIdentity(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function declarationFields(value: unknown): AccountDeclarationFields {
  const declaration = record(value) ? value : {};
  return {
    environment: declaration.environment === "live" || declaration.environment === "paper" ? declaration.environment : "",
    accountType: declaration.account_type === "cash" || declaration.account_type === "margin" ? declaration.account_type : "",
  };
}

function pendingKind(body: Record<string, unknown>): "risk" | "declaration" | "draft" {
  if (Object.prototype.hasOwnProperty.call(body, "risk_preference")) return "risk";
  if (Object.prototype.hasOwnProperty.call(body, "declaration")) return "declaration";
  return "draft";
}

function savedNoticeGroup(op: AccountSettingsOp): AccountSettingsView["noticeGroup"] {
  if (op.body && Object.prototype.hasOwnProperty.call(op.body, "declaration")) return "declaration";
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
  return {
    account: null,
    settings: null,
    preference: "",
    declaration: { environment: "", accountType: "" },
    notice: "",
    noticeGroup: "",
    unavailable: "",
    saving: "",
    review: emptyReview(),
    draft: blankDraft(),
    management: emptyManagementState(),
  };
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

export function createAccountSettingsController(unresolvedSaves = new Map<string, AccountSettingsSaveSnapshot>()) {
  const gate = createRequestGate();
  const mgmtStore = managementStoreFor(unresolvedSaves);
  let selected: AccountSettingsAccount | null = null;
  let view = emptyView();
  let lastSettings: Record<string, any> | null = null;
  let saveSnapshot: AccountSettingsSaveSnapshot | null = null;
  let managementSnapshot: ManagementPendingSave | null = null;
  const sameAccount = (account: AccountSettingsAccount | null) => Boolean(
    selected && account && selected.platform === account.platform && selected.key === account.key,
  );
  const current = (op: AccountSettingsOp | null | undefined) => Boolean(
    op && gate.isCurrent(op.token) && sameAccount(op.account),
  );
  const clearPendingManagement = (match: ManagementPendingSave) => {
    for (const sibKey of match.siblings) {
      if (mgmtStore.pending.get(sibKey)?.token === match.token || mgmtStore.pending.get(sibKey)?.requestKey === match.requestKey) {
        mgmtStore.pending.delete(sibKey);
      }
      mgmtStore.cache.delete(sibKey);
    }
  };
  return {
    selectedId() {
      return selected ? `${selected.platform}:${selected.key}` : "";
    },
    cachedManagementSection(account: AccountSettingsAccount) {
      return mgmtStore.cache.get(`${account.platform}:${account.key}`) || null;
    },
    view() {
      const id = this.selectedId();
      const pending = unresolvedSaves.get(id);
      if (pending) {
        const kind = pendingKind(pending.body);
        view = { ...view, review: { ...view.review, [kind]: true } };
      }
      const pendingMgmt = mgmtStore.pending.get(id);
      if (pendingMgmt) {
        view = {
          ...view,
          review: { ...view.review, management: true },
          management: {
            ...view.management,
            uncertain: true,
            uncertainRequestKey: pendingMgmt.requestKey,
            uncertainOperation: pendingMgmt.operation,
          },
        };
      }
      return view;
    },
    riskDirty() {
      const baseline = view.settings || lastSettings;
      return (view.preference || "") !== (typeof baseline?.risk?.preference === "string" ? baseline.risk.preference : "");
    },
    declarationDirty() {
      const baseline = view.settings || lastSettings;
      const saved = declarationFields(baseline?.declaration);
      return view.declaration.environment !== saved.environment || view.declaration.accountType !== saved.accountType;
    },
    select(account: AccountSettingsAccount) {
      const changed = !sameAccount(account);
      selected = { platform: account.platform, key: account.key };
      if (changed) {
        gate.invalidate();
        view = { ...emptyView(), account: selected };
        lastSettings = null;
        saveSnapshot = null;
        managementSnapshot = null;
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
    applyRead(op: AccountSettingsOp, payload: Record<string, any>, options: { preserveNotice?: boolean; keepCash?: boolean; keepPreference?: boolean; keepIncome?: boolean; keepStrategy?: boolean; keepOption?: boolean; keepDeclaration?: boolean; keepManagement?: boolean } = {}) {
      if (!current(op) || payload?.platform !== op.account.platform || payload?.key !== op.account.key) return false;
      const pending = unresolvedSaves.get(this.selectedId());
      const hadDeclaration = record((view.settings || lastSettings)?.declaration) || pending?.declaration.present;
      if ((hadDeclaration || Object.prototype.hasOwnProperty.call(payload, "declaration")) && !validDeclaration(payload.declaration)) return false;
      const resolved = pending && matchesSaveAcknowledgement(pending, payload);
      if (resolved) unresolvedSaves.delete(this.selectedId());
      const incomingSection = validManagementSection(payload.management) ? copyJson(payload.management) : null;
      const pendingMgmt = mgmtStore.pending.get(this.selectedId());
      const mgmtResolved = Boolean(pendingMgmt && incomingSection && matchesManagementAcknowledgement(pendingMgmt, payload));
      if (mgmtResolved && pendingMgmt) clearPendingManagement(pendingMgmt);
      if (incomingSection) mgmtStore.cache.set(this.selectedId(), copyJson(incomingSection));
      const draft = payload.draft?.overrides || {};
      const savedPreference = typeof (view.settings || lastSettings)?.risk?.preference === "string" ? (view.settings || lastSettings)!.risk.preference : "";
      const keepCash = options.keepCash === true && cashDraftDirty(view.draft);
      const savedDeclaration = declarationFields((view.settings || lastSettings)?.declaration);
      const keepDeclaration = options.keepDeclaration === true
        && (view.declaration.environment !== savedDeclaration.environment || view.declaration.accountType !== savedDeclaration.accountType);
      const keepPreference = options.keepPreference === true && (view.preference || "") !== savedPreference;
      const keepIncome = options.keepIncome === true && view.draft.incomeTouched === true;
      const keepStrategy = options.keepStrategy === true && strategyGroupDirty(view.draft);
      const keepOption = options.keepOption === true && view.draft.optionTouched === true;
      const keepManagement = options.keepManagement === true && view.management.dirty && view.management.draftValue !== "";
      const nextMgmtSection = incomingSection ?? (payload.management === null ? null : view.management.section);
      const baselineMgmt = managementDraftBaseline(nextMgmtSection);
      const stillPendingMgmt = mgmtStore.pending.get(this.selectedId());
      lastSettings = payload;
      view = {
        account: { platform: op.account.platform, key: op.account.key },
        settings: payload,
        preference: keepPreference ? view.preference : (payload.risk?.preference || ""),
        declaration: keepDeclaration ? view.declaration : declarationFields(payload.declaration),
        notice: options.preserveNotice ? view.notice : "",
        noticeGroup: options.preserveNotice ? view.noticeGroup : "",
        unavailable: "",
        saving: "",
        review: { ...emptyReview(), management: Boolean(stillPendingMgmt) },
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
        management: {
          section: nextMgmtSection,
          draftValue: keepManagement ? view.management.draftValue : baselineMgmt,
          dirty: keepManagement ? (view.management.draftValue !== baselineMgmt) : false,
          saving: "",
          uncertain: Boolean(stillPendingMgmt),
          uncertainRequestKey: stillPendingMgmt?.requestKey || null,
          uncertainOperation: stillPendingMgmt?.operation || "",
          staleReplayIgnored: options.preserveNotice ? view.management.staleReplayIgnored : false,
        },
      };
      if (pending) {
        const kind = pendingKind(pending.body);
        view = { ...view, notice: resolved ? (kind === "risk" ? "偏好已保存" : kind === "declaration" ? "声明已保存" : "草案已保存") : "状态未知",
          noticeGroup: resolved ? savedNoticeGroup({ ...op, body: pending.body }) : "",
          review: { ...view.review, [kind]: !resolved } };
      } else if (pendingMgmt) {
        view = {
          ...view,
          notice: mgmtResolved ? (pendingMgmt.operation === "management_apply" ? "管理设置已应用" : "管理草案已保存") : "状态未知",
          noticeGroup: mgmtResolved ? "management" : "",
          review: { ...view.review, management: !mgmtResolved },
        };
      }
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
    editDeclaration(patch: Partial<AccountDeclarationFields>) {
      if (!view.settings || !sameAccount(view.account)) return false;
      view = { ...view, declaration: { ...view.declaration, ...patch } };
      return true;
    },
    startSave(kind: "draft" | "risk" | "declaration" | "cash" | "income" | "option" | "strategy") {
      if (view.saving || unresolvedSaves.has(this.selectedId())) return null;
      if (!selected || !view.settings || !sameAccount(view.account)) return null;
      if (view.settings.platform !== selected.platform || view.settings.key !== selected.key) return null;
      if (!view.settings.identity || typeof view.settings.identity !== "object") return null;
      const account = { platform: selected.platform, key: selected.key };
      let body: Record<string, unknown>;
      if (kind === "declaration") {
        if (view.settings.operations?.save_declaration !== true) return null;
        if (view.review?.declaration) return null;
        if (!Number.isSafeInteger(view.settings.declaration?.revision)) return null;
        const saved = declarationFields(view.settings.declaration);
        if (view.declaration.environment === saved.environment && view.declaration.accountType === saved.accountType) return null;
        body = {
          platform: account.platform,
          key: account.key,
          identity: view.settings.identity,
          expected_declaration_revision: view.settings.declaration.revision,
          declaration: {
            environment: view.declaration.environment || null,
            account_type: view.declaration.accountType || null,
          },
        };
      } else if (kind === "risk") {
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
        if (kind === "strategy" && !Object.prototype.hasOwnProperty.call(overrides || {}, "strategy_profile")) return null;
        if (!overrides || !Object.keys(overrides).length || !Number.isSafeInteger(view.settings.draft?.revision)) return null;
        if (Object.prototype.hasOwnProperty.call(view.settings.draft?.overrides || {}, "option_overlay_enabled")) overrides.option_overlay_enabled = null;
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
      const token = gate.begin();
      saveSnapshot = {
        token,
        body: copyJson(body),
        draft: copyJson({ status: view.settings.draft.status, revision: view.settings.draft.revision, identity: view.settings.draft.identity, current_identity: view.settings.draft.current_identity, overrides: view.settings.draft.overrides || {} }),
        risk: copyJson({ revision: view.settings.risk.revision, scope_id: view.settings.risk.scope_id, preference: view.settings.risk.preference || null }),
        declaration: copyJson({
          present: record(view.settings.declaration),
          status: typeof view.settings.declaration?.status === "string" ? view.settings.declaration.status : "empty",
          source: typeof view.settings.declaration?.source === "string" ? view.settings.declaration.source : null,
          revision: Number.isSafeInteger(view.settings.declaration?.revision) ? view.settings.declaration.revision : 0,
          environment: view.settings.declaration?.environment === "live" || view.settings.declaration?.environment === "paper" ? view.settings.declaration.environment : null,
          account_type: view.settings.declaration?.account_type === "cash" || view.settings.declaration?.account_type === "margin" ? view.settings.declaration.account_type : null,
        }),
      };
      return { token, account, kind: "save" as const, body: copyJson(body) };
    },
    requestBody(op: AccountSettingsOp | null | undefined) {
      if (!op?.body || !current(op)) return null;
      if (op.body.platform !== op.account.platform || op.body.key !== op.account.key) return null;
      return op.body;
    },
    markSaving(op: AccountSettingsOp, kind: string) {
      if (view.saving || !current(op)) return false;
      if (saveSnapshot?.token === op.token) unresolvedSaves.set(this.selectedId(), saveSnapshot);
      view = { ...view, saving: kind, notice: "" };
      return true;
    },
    applySave(op: AccountSettingsOp, payload: Record<string, any>, notice: string) {
      if (!current(op)) return false;
      const pending = unresolvedSaves.get(this.selectedId());
      if ((pending && pending !== saveSnapshot) || (view.saving && !pending)) return false;
      if (!saveSnapshot || saveSnapshot.token !== op.token || !sameSavedValue(op.body, saveSnapshot.body)
        || !matchesSaveAcknowledgement(saveSnapshot, payload)) {
        if (saveSnapshot?.token === op.token) unresolvedSaves.set(this.selectedId(), saveSnapshot);
        const kind = saveSnapshot?.token === op.token ? pendingKind(saveSnapshot.body) : "draft";
        view = { ...view, notice: "状态未知", noticeGroup: "", review: { ...view.review, [kind]: true } };
        return false;
      }
      unresolvedSaves.delete(this.selectedId());
      const overrides = op.body?.overrides as Record<string, unknown> | undefined;
      const intendedCash = pendingDraftOverrides(view.draft, "cash");
      const sentCash = Boolean(overrides && (Object.prototype.hasOwnProperty.call(overrides, "reserved_cash_floor") || Object.prototype.hasOwnProperty.call(overrides, "reserved_cash_ratio")));
      const sentIncome = Boolean(overrides && Object.prototype.hasOwnProperty.call(overrides, "income_layer_enabled"));
      const sentOption = Boolean(overrides && Object.prototype.hasOwnProperty.call(overrides, "option_overlay_enabled"));
      const sentStrategy = Boolean(overrides && Object.prototype.hasOwnProperty.call(overrides, "strategy_profile"));
      const sentDca = Boolean(overrides && (Object.prototype.hasOwnProperty.call(overrides, "dca_mode") || Object.prototype.hasOwnProperty.call(overrides, "dca_base_investment_usd")));
      const sentRisk = Boolean(op.body && Object.prototype.hasOwnProperty.call(op.body, "risk_preference"));
      const sentDeclaration = Boolean(op.body && Object.prototype.hasOwnProperty.call(op.body, "declaration"));
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
      const sentDeclarationBody = op.body?.declaration && typeof op.body.declaration === "object"
        ? op.body.declaration as { environment?: unknown; account_type?: unknown }
        : {};
      const sentEnvironment = typeof sentDeclarationBody.environment === "string" ? sentDeclarationBody.environment : "";
      const sentAccountType = typeof sentDeclarationBody.account_type === "string" ? sentDeclarationBody.account_type : "";
      const savedDeclaration = declarationFields(beforeSettings?.declaration);
      const declarationMoved = sentDeclaration
        ? view.declaration.environment !== sentEnvironment || view.declaration.accountType !== sentAccountType
        : view.declaration.environment !== savedDeclaration.environment || view.declaration.accountType !== savedDeclaration.accountType;
      const declarationConflict = !sentDeclaration && declarationMoved
        && (identityChanged || beforeSettings?.declaration?.revision !== payload?.declaration?.revision);
      if (!this.applyRead(op, payload, {
        keepCash: sentCash ? cashMoved : cashDraftDirty(view.draft),
        keepIncome: sentIncome ? incomeMoved : view.draft.incomeTouched === true,
        keepOption: sentOption ? optionMoved : view.draft.optionTouched === true,
        keepStrategy: (sentStrategy || sentDca) ? strategyGroupMoved : strategyGroupDirty(view.draft),
        keepPreference: preferenceMoved,
        keepDeclaration: declarationMoved,
        keepManagement: view.management.dirty,
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
          declaration: sentDeclaration ? false : review.declaration || declarationConflict,
          management: Boolean(review.management) || mgmtStore.pending.has(this.selectedId()),
        },
      };
      return true;
    },
    fail(op: AccountSettingsOp, notice: string, unknown = false) {
      if (!current(op)) return false;
      const pending = unresolvedSaves.get(this.selectedId());
      if ((pending && pending !== saveSnapshot) || (unknown && !pending)) return false;
      if (!unknown) unresolvedSaves.delete(this.selectedId());
      else if (saveSnapshot?.token === op.token) unresolvedSaves.set(this.selectedId(), saveSnapshot);
      const kind = saveSnapshot ? pendingKind(saveSnapshot.body) : "draft";
      view = { ...view, notice: unknown ? "状态未知" : notice, noticeGroup: "", saving: "",
        review: unknown ? { ...view.review, [kind]: true } : view.review };
      return true;
    },
    applyRefresh(op: AccountSettingsOp, payload: Record<string, any>) {
      if (!current(op)) return false;
      const before = view;
      const pending = unresolvedSaves.get(this.selectedId());
      if (pending && matchesSaveAcknowledgement(pending, payload)) {
        saveSnapshot = { ...pending, token: op.token };
        unresolvedSaves.set(this.selectedId(), saveSnapshot);
        const kind = pendingKind(pending.body);
        return this.applySave({ ...op, body: copyJson(pending.body) }, payload,
          kind === "risk" ? "偏好已保存" : kind === "declaration" ? "声明已保存" : "草案已保存");
      }
      const pendingMgmt = mgmtStore.pending.get(this.selectedId());
      const mgmtResolvedNow = Boolean(pendingMgmt && validManagementSection(payload.management) && matchesManagementAcknowledgement(pendingMgmt, payload));
      const notice = (pending || (pendingMgmt && !mgmtResolvedNow)) ? "状态未知" : before.notice;
      const beforeSettings = before.settings || lastSettings;
      const dirtyCash = cashDraftDirty(before.draft);
      const dirtyIncome = before.draft.incomeTouched === true;
      const dirtyOption = before.draft.optionTouched === true;
      const dirtyStrategy = strategyGroupDirty(before.draft);
      const savedPreference = typeof beforeSettings?.risk?.preference === "string" ? beforeSettings!.risk.preference : "";
      const dirtyRisk = (before.preference || "") !== savedPreference;
      const savedDeclaration = declarationFields(beforeSettings?.declaration);
      const dirtyDeclaration = before.declaration.environment !== savedDeclaration.environment || before.declaration.accountType !== savedDeclaration.accountType;
      const beforeMgmt = before.management.section;
      const incomingMgmt = validManagementSection(payload.management) ? payload.management : null;
      const mgmtRevisionChanged = Boolean(
        (beforeMgmt?.draft?.revision ?? 0) !== (incomingMgmt?.draft?.revision ?? 0)
        || (beforeMgmt?.applied?.revision ?? 0) !== (incomingMgmt?.applied?.revision ?? 0)
        || beforeMgmt?.policy_revision !== incomingMgmt?.policy_revision,
      );
      const identityChanged = !sameIdentity(beforeSettings?.identity, payload?.identity);
      const draftChanged = Number(beforeSettings?.draft?.revision) !== Number(payload?.draft?.revision);
      const riskChanged = Number(beforeSettings?.risk?.revision) !== Number(payload?.risk?.revision);
      const declarationChanged = Number(beforeSettings?.declaration?.revision) !== Number(payload?.declaration?.revision);
      if (!this.applyRead(op, payload, { preserveNotice: true, keepCash: true, keepPreference: true, keepIncome: true, keepOption: true, keepStrategy: true, keepDeclaration: true, keepManagement: !mgmtRevisionChanged && !mgmtResolvedNow })) return false;
      const remainingMgmt = mgmtStore.pending.get(this.selectedId());
      view = {
        ...view,
        notice: mgmtResolvedNow ? (pendingMgmt?.operation === "management_apply" ? "管理设置已应用" : "管理草案已保存") : notice,
        noticeGroup: mgmtResolvedNow ? "management" : view.noticeGroup,
        saving: "",
        review: {
          draft: Boolean(before.review?.draft) || (dirtyCash || dirtyIncome || dirtyOption || dirtyStrategy) && (identityChanged || draftChanged),
          risk: Boolean(before.review?.risk) || dirtyRisk && (identityChanged || riskChanged),
          declaration: Boolean(before.review?.declaration) || dirtyDeclaration && (identityChanged || declarationChanged),
          management: mgmtResolvedNow ? false : Boolean(remainingMgmt) || (Boolean(before.review?.management) && !incomingMgmt) || (before.management.dirty && (identityChanged || mgmtRevisionChanged)),
        },
      };
      return true;
    },
    acknowledgeReview(kind: "draft" | "risk" | "declaration" | "management") {
      const pending = unresolvedSaves.get(this.selectedId());
      if (pending && pendingKind(pending.body) === kind) return false;
      if (kind === "management" && mgmtStore.pending.has(this.selectedId())) return false;
      if (!view.review?.[kind]) return false;
      view = { ...view, review: { ...view.review, [kind]: false } };
      return true;
    },
    revertDraft() {
      if (!view.settings) return false;
      const overrides = view.settings.draft?.overrides || {};
      view = {
        ...view,
        review: { draft: false, risk: Boolean(view.review?.risk), declaration: Boolean(view.review?.declaration), management: Boolean(view.review?.management) },
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
        review: { draft: incomeStill ? Boolean(view.review?.draft) : false, risk: Boolean(view.review?.risk), declaration: Boolean(view.review?.declaration), management: Boolean(view.review?.management) },
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
        review: { draft: still ? Boolean(view.review?.draft) : false, risk: Boolean(view.review?.risk), declaration: Boolean(view.review?.declaration), management: Boolean(view.review?.management) },
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
        review: { draft: still ? Boolean(view.review?.draft) : false, risk: Boolean(view.review?.risk), declaration: Boolean(view.review?.declaration), management: Boolean(view.review?.management) },
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
        review: { draft: Boolean(view.review?.draft), risk: false, declaration: Boolean(view.review?.declaration), management: Boolean(view.review?.management) },
      };
      return true;
    },
    revertDeclaration() {
      if (!view.settings) return false;
      view = {
        ...view,
        declaration: declarationFields(view.settings.declaration),
        review: { ...view.review, declaration: false },
      };
      return true;
    },
    editManagement(enabled: boolean) {
      if (!view.settings || !sameAccount(view.account)) return false;
      if (view.management.saving || view.management.uncertain || mgmtStore.pending.has(this.selectedId())) return false;
      if (!canWriteManagement(view.settings, view.management.section)) return false;
      const next: "true" | "false" = enabled ? "true" : "false";
      const baseline = managementDraftBaseline(view.management.section);
      view = {
        ...view,
        management: {
          ...view.management,
          draftValue: next,
          dirty: next !== baseline,
          staleReplayIgnored: false,
        },
      };
      return true;
    },
    revertManagement() {
      if (!view.settings || mgmtStore.pending.has(this.selectedId())) return false;
      const baseline = managementDraftBaseline(view.management.section);
      view = {
        ...view,
        review: { ...view.review, management: false },
        management: {
          ...view.management,
          draftValue: baseline,
          dirty: false,
        },
      };
      return true;
    },
    startManagementDraftSave(requestKey = newRequestKey()): { op: AccountSettingsOp; body: AccountManagementDraftSaveRequest } | null {
      if (view.saving || view.management.saving || mgmtStore.pending.has(this.selectedId())) return null;
      if (!selected || !view.settings || !sameAccount(view.account)) return null;
      if (view.settings.platform !== selected.platform || view.settings.key !== selected.key) return null;
      if (!record(view.settings.identity)) return null;
      const section = view.management.section;
      if (!canWriteManagement(view.settings, section) || view.review.management) return null;
      if (view.management.draftValue !== "true" && view.management.draftValue !== "false") return null;
      const siblings = managementSiblingKeys(selected, section.siblings);
      if (siblings.some(sibKey => mgmtStore.pending.has(sibKey))) return null;
      const managementEnabled = view.management.draftValue === "true";
      const draftRevision = section.draft ? section.draft.revision : 0;
      const appliedRevision = section.applied ? section.applied.revision : 0;
      const body: AccountManagementDraftSaveRequest = {
        platform: selected.platform,
        key: selected.key,
        identity: copyJson(view.settings.identity),
        request_key: requestKey,
        expected_instance_revision: section.instance_revision!,
        expected_policy_revision: section.policy_revision!,
        expected_management_draft_revision: draftRevision,
        expected_management_revision: appliedRevision,
        management_draft: { management_enabled: managementEnabled },
      };
      const token = gate.begin();
      managementSnapshot = {
        token,
        requestKey,
        operation: "management_draft",
        account: { platform: selected.platform, key: selected.key },
        siblings,
        identity: copyJson(view.settings.identity),
        instanceRevision: section.instance_revision!,
        policyRevision: section.policy_revision!,
        draftRevision,
        appliedRevision,
        targetEnabled: managementEnabled,
      };
      const op: AccountSettingsOp = { token, account: { platform: selected.platform, key: selected.key }, kind: "management_draft", body: copyJson(body) as unknown as Record<string, unknown> };
      return { op, body };
    },
    startManagementApply(requestKey = newRequestKey()): { op: AccountSettingsOp; body: AccountManagementApplyRequest } | null {
      if (view.saving || view.management.saving || mgmtStore.pending.has(this.selectedId())) return null;
      if (!selected || !view.settings || !sameAccount(view.account)) return null;
      if (view.settings.platform !== selected.platform || view.settings.key !== selected.key) return null;
      if (!record(view.settings.identity)) return null;
      const section = view.management.section;
      if (!canWriteManagement(view.settings, section) || view.review.management) return null;
      if (!section.draft || section.draft.status !== "pending" || view.management.dirty) return null;
      const siblings = managementSiblingKeys(selected, section.siblings);
      if (siblings.some(sibKey => mgmtStore.pending.has(sibKey))) return null;
      const draftRevision = section.draft.revision;
      const appliedRevision = section.applied ? section.applied.revision : 0;
      const body: AccountManagementApplyRequest = {
        platform: selected.platform,
        key: selected.key,
        identity: copyJson(view.settings.identity),
        request_key: requestKey,
        expected_instance_revision: section.instance_revision!,
        expected_policy_revision: section.policy_revision!,
        expected_management_draft_revision: draftRevision,
        expected_management_revision: appliedRevision,
      };
      const token = gate.begin();
      managementSnapshot = {
        token,
        requestKey,
        operation: "management_apply",
        account: { platform: selected.platform, key: selected.key },
        siblings,
        identity: copyJson(view.settings.identity),
        instanceRevision: section.instance_revision!,
        policyRevision: section.policy_revision!,
        draftRevision,
        appliedRevision,
        targetEnabled: section.draft.management_enabled,
      };
      const op: AccountSettingsOp = { token, account: { platform: selected.platform, key: selected.key }, kind: "management_apply", body: copyJson(body) as unknown as Record<string, unknown> };
      return { op, body };
      return { op, body };
    },
    markManagementSubmitting(op: AccountSettingsOp) {
      if (view.saving || view.management.saving || !current(op)) return false;
      if (!managementSnapshot || managementSnapshot.token !== op.token) return false;
      if (op.kind !== "management_draft" && op.kind !== "management_apply") return false;
      for (const sibKey of managementSnapshot.siblings) {
        mgmtStore.pending.set(sibKey, managementSnapshot);
        mgmtStore.cache.delete(sibKey);
      }
      view = {
        ...view,
        notice: "",
        noticeGroup: "",
        management: {
          ...view.management,
          saving: op.kind,
          staleReplayIgnored: false,
        },
      };
      return true;
    },
    failManagement(op: AccountSettingsOp, uncertain = false, notice = "状态未知") {
      const targetKey = `${op.account.platform}:${op.account.key}`;
      const match = (managementSnapshot && managementSnapshot.token === op.token ? managementSnapshot : null)
        ?? (mgmtStore.pending.get(targetKey)?.token === op.token ? mgmtStore.pending.get(targetKey)! : null);
      if (match) {
        if (!uncertain) {
          clearPendingManagement(match);
        } else {
          for (const sibKey of match.siblings) {
            mgmtStore.pending.set(sibKey, match);
            mgmtStore.cache.delete(sibKey);
          }
        }
      }
      if (!current(op)) return false;
      const stillPending = mgmtStore.pending.get(this.selectedId());
      view = {
        ...view,
        notice: uncertain ? "状态未知" : notice,
        noticeGroup: "",
        review: { ...view.review, management: true },
        management: {
          ...view.management,
          saving: "",
          uncertain: Boolean(stillPending),
          uncertainRequestKey: stillPending?.requestKey || null,
          uncertainOperation: stillPending?.operation || "",
        },
      };
      return true;
    },
    applyManagementSuccess(op: AccountSettingsOp, receipt: AccountManagementReceipt, readbackPayload?: Record<string, any> | null) {
      if (!record(receipt) || receipt.ok !== true || receipt.platform !== op.account.platform || receipt.key !== op.account.key) {
        return false;
      }
      const targetKey = `${op.account.platform}:${op.account.key}`;
      const match = (managementSnapshot && managementSnapshot.token === op.token ? managementSnapshot : null)
        ?? (mgmtStore.pending.get(targetKey)?.token === op.token ? mgmtStore.pending.get(targetKey)! : null);
      const siblingKeys = managementSiblingKeys(op.account, [
        ...(receipt.deployments || []),
        ...((match?.siblings || []).map(k => {
          const idx = k.indexOf(":");
          return idx > 0 ? { platform: k.slice(0, idx), key: k.slice(idx + 1) } : {};
        })),
      ]);
      const freshSection = readbackPayload && validManagementSection(readbackPayload.management)
        ? copyJson(readbackPayload.management)
        : null;
      let highestKnown = freshSection;
      for (const sibKey of siblingKeys) {
        const cached = mgmtStore.cache.get(sibKey);
        if (!highestKnown && cached) highestKnown = cached;
        if (cached && highestKnown) {
          const cApp = cached.applied?.revision ?? 0;
          const hApp = highestKnown.applied?.revision ?? 0;
          const cDraft = cached.draft?.revision ?? 0;
          const hDraft = highestKnown.draft?.revision ?? 0;
          if (cApp > hApp || (cApp === hApp && cDraft > hDraft)) highestKnown = cached;
        }
      }
      const isHistoricalReplay = receipt.replayed === true && Boolean(highestKnown) && (
        (highestKnown!.applied?.revision ?? 0) > receipt.management_revision
        || (highestKnown!.draft?.revision ?? 0) > receipt.management_draft_revision
      );
      if (match) clearPendingManagement(match);
      for (const sibKey of siblingKeys) {
        mgmtStore.cache.delete(sibKey);
        const existingPending = mgmtStore.pending.get(sibKey);
        if (existingPending && (existingPending.token === op.token || existingPending.requestKey === receipt.request_key)) {
          mgmtStore.pending.delete(sibKey);
        }
      }
      if (isHistoricalReplay) {
        if (freshSection) mgmtStore.cache.set(targetKey, copyJson(freshSection));
        if (!current(op)) return false;
        if (readbackPayload) {
          this.applyRead(op, readbackPayload, { preserveNotice: false });
        }
        view = {
          ...view,
          management: {
            ...view.management,
            saving: "",
            staleReplayIgnored: true,
          },
        };
        return true;
      }
      if (freshSection) mgmtStore.cache.set(targetKey, copyJson(freshSection));
      if (!current(op)) return false;
      if (readbackPayload && this.applyRead(op, readbackPayload, { preserveNotice: false })) {
        view = {
          ...view,
          notice: receipt.outcome === "applied" ? "管理设置已应用" : receipt.outcome === "no_op" ? "管理设置未变更" : "管理草案已保存",
          noticeGroup: "management",
          management: {
            ...view.management,
            saving: "",
            uncertain: false,
            uncertainRequestKey: null,
            uncertainOperation: "",
            staleReplayIgnored: false,
          },
        };
        return true;
      }
      const prevSection = view.management.section;
      const nextSection: AccountManagementSettingsSection | null = prevSection ? copyJson(prevSection) : null;
      if (nextSection) {
        nextSection.policy_revision = receipt.policy_revision;
        nextSection.instance_revision = receipt.instance_revision;
        if (receipt.outcome === "draft_saved") {
          nextSection.draft = {
            management_enabled: receipt.management_enabled,
            revision: receipt.management_draft_revision,
            base_applied_revision: receipt.management_revision,
            status: "pending",
            consumed_applied_revision: null,
          };
        } else if (receipt.outcome === "applied") {
          nextSection.applied = {
            management_enabled: receipt.management_enabled,
            revision: receipt.management_revision,
            effective_at: receipt.committed_at,
          };
          nextSection.management_status = receipt.management_enabled ? "managed" : "management_disabled";
          nextSection.evidence_state = "known";
          nextSection.processing_eligible = receipt.management_enabled;
          nextSection.reasons = [];
          nextSection.draft = {
            management_enabled: receipt.management_enabled,
            revision: receipt.management_draft_revision,
            base_applied_revision: receipt.previous_management_revision ?? nextSection.draft?.base_applied_revision ?? 0,
            status: "consumed",
            consumed_applied_revision: receipt.management_revision,
          };
        }
        mgmtStore.cache.set(targetKey, copyJson(nextSection));
      }
      const nextBaseline = managementDraftBaseline(nextSection);
      view = {
        ...view,
        notice: receipt.outcome === "applied" ? "管理设置已应用" : receipt.outcome === "no_op" ? "管理设置未变更" : "管理草案已保存",
        noticeGroup: "management",
        review: { ...view.review, management: false },
        management: {
          section: nextSection,
          draftValue: nextBaseline,
          dirty: false,
          saving: "",
          uncertain: false,
          uncertainRequestKey: null,
          uncertainOperation: "",
          staleReplayIgnored: false,
        },
      };
      return true;
    },
    finish(op: AccountSettingsOp) {
      if (!current(op)) return false;
      view = {
        ...view,
        saving: "",
        management: { ...view.management, saving: "" },
      };
      return true;
    },
  };
}
