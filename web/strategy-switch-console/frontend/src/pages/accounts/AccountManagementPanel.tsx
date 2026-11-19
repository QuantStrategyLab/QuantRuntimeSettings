import { useEffect, useId, useRef, useState } from "react";
import type {
  AccountManagementApplyRequest,
  AccountManagementDraftSaveRequest,
  AccountManagementSettingsSection,
  ManagementEvidenceState,
  ManagementStatusCode,
} from "../../api/contracts";
import { applyManagementDraft, loadAccountSettings, saveManagementDraft } from "../../api/endpoints";
import {
  type AccountManagementEditorState,
  type AccountSettingsOp,
  createAccountSettingsController,
  refreshAccountSettingsReadback,
} from "../../accountSettingsState";
import { Badge, Skeleton } from "../../components/primitives";
import { useLanguage, useT } from "../../i18n";
import { managementEvidenceText, managementStatusText } from "../../lib/accountManagementText";
import { formatDateTime } from "../../lib/format";

/**
 * Unconfirmed management writes outlive component remounts and account/sibling
 * switches: the shared store locks every sibling deployment until readback
 * confirms settlement.
 */
const unresolvedManagementSaves: Parameters<typeof createAccountSettingsController>[0] = new Map();

function statusBadgeTone(
  status: ManagementStatusCode | string,
  evidence: ManagementEvidenceState | string,
): "ok" | "warn" | "error" | "unknown" {
  if (evidence === "conflict") return "error";
  if (status === "managed") return evidence === "stale" ? "warn" : "ok";
  if (status === "management_disabled") return "warn";
  return "unknown";
}

function evidenceBadgeTone(evidence: ManagementEvidenceState | string): "warn" | "error" | "unknown" {
  if (evidence === "conflict") return "error";
  if (evidence === "stale") return "warn";
  return "unknown";
}

export function ManagementStatusBadges({
  status,
  evidenceState,
}: {
  status: ManagementStatusCode;
  evidenceState: ManagementEvidenceState;
}) {
  const language = useLanguage();
  const evidenceLabel = managementEvidenceText(evidenceState, language);
  return (
    <span className="management-badges" data-management-status={status} data-evidence-state={evidenceState}>
      <Badge tone={statusBadgeTone(status, evidenceState)}>
        {managementStatusText(status, language)}
      </Badge>
      {evidenceLabel && (
        <Badge tone={evidenceBadgeTone(evidenceState)}>
          {evidenceLabel}
        </Badge>
      )}
    </span>
  );
}

export interface AccountManagementSectionViewProps {
  section: AccountManagementSettingsSection | null;
  editor: Pick<
    AccountManagementEditorState,
    "draftValue" | "dirty" | "saving" | "uncertain" | "uncertainRequestKey" | "staleReplayIgnored"
  > & { committedStateUnknown?: boolean };
  canAdminWrite: boolean;
  readState: "loading" | "ready" | "failed";
  feedback: { tone: "success" | "error" | "warn"; text: string } | null;
  onSelectDraft?: (enabled: boolean) => void;
  onSaveDraft?: () => void;
  onApplyDraft?: () => void;
  onRevert?: () => void;
  onRefresh?: () => void;
  onRecover?: () => void;
}

/** Pure SSR-renderable presentation of the account-settings `management` section. */
export function AccountManagementSectionView({
  section,
  editor,
  canAdminWrite,
  readState,
  feedback,
  onSelectDraft,
  onSaveDraft,
  onApplyDraft,
  onRevert,
  onRefresh,
  onRecover,
}: AccountManagementSectionViewProps) {
  const t = useT();
  const language = useLanguage();
  const enableId = useId();
  const disableId = useId();
  const radioName = useId();

  if (readState === "loading" && !section) {
    return (
      <section className="card management-card" data-management-panel="loading">
        <h2 className="card-title">{t("accounts.management.title")}</h2>
        <Skeleton height={120} />
      </section>
    );
  }

  if (readState === "failed" && !section) {
    return (
      <section className="card management-card" data-management-panel="read_failed">
        <div className="accounts-detail-head">
          <h2 className="card-title">{t("accounts.management.title")}</h2>
          <ManagementStatusBadges status="unknown" evidenceState="unknown" />
        </div>
        <p className="card-note">{t("accounts.management.note")}</p>
        <p className="accounts-inline-note error" role="alert" data-state="management.read_failed">
          {t("accounts.management.read_failed")}
        </p>
        {onRefresh && (
          <div className="accounts-toolbar">
            <button type="button" className="button button-secondary" onClick={onRefresh}>
              {t("accounts.management.reread")}
            </button>
          </div>
        )}
      </section>
    );
  }

  if (!section) return null;

  const policyUnavailable = section.policy_revision === null
    || section.reasons.includes("management_policy_unavailable")
    || section.reasons.includes("management_policy_invalid");
  const isDisplayOnly = section.management_class === "display_only";
  const isConflict = section.evidence_state === "conflict";
  const isEligible = section.management_class === "eligible" && !policyUnavailable && !isConflict;
  const controlsDisabled = !canAdminWrite || !isEligible || editor.uncertain || Boolean(editor.saving);
  const canSaveDraft = !controlsDisabled && (editor.draftValue === "true" || editor.draftValue === "false") && (editor.dirty || !section.draft || section.draft.status !== "pending");
  const canApplyDraft = !controlsDisabled && section.draft?.status === "pending" && !editor.dirty;
  const reasonTexts = section.reasons.map(reason => t(`reason.${reason}`)).filter(Boolean);

  const appliedSummary = section.applied
    ? t("accounts.management.applied_value", {
        status: managementStatusText(section.applied.management_enabled ? "managed" : "management_disabled", language),
        revision: section.applied.revision,
        time: formatDateTime(section.applied.effective_at, language).text,
      })
    : isDisplayOnly
      ? managementStatusText("not_under_management", language)
      : policyUnavailable
        ? managementStatusText("unknown", language)
        : t("accounts.management.uninitialized");

  const draftSummary = section.draft?.status === "pending"
    ? t("accounts.management.draft_pending", {
        target: managementStatusText(section.draft.management_enabled ? "managed" : "management_disabled", language),
        revision: section.draft.revision,
        base: section.draft.base_applied_revision,
      })
    : section.draft?.status === "consumed"
      ? t("accounts.management.draft_consumed", {
          revision: section.draft.revision,
          applied: section.draft.consumed_applied_revision ?? section.applied?.revision ?? 0,
        })
      : t("accounts.management.draft_none");

  const classLabel = section.management_class === "eligible"
    ? t("accounts.management.class_eligible")
    : section.management_class === "display_only"
      ? t("accounts.management.class_display_only")
      : t("accounts.management.class_unknown");

  return (
    <section
      className="card management-card"
      data-management-panel="ready"
      data-management-class={section.management_class ?? "unknown"}
    >
      <div className="accounts-detail-head">
        <h2 className="card-title">{t("accounts.management.title")}</h2>
        <ManagementStatusBadges status={section.management_status} evidenceState={section.evidence_state} />
      </div>
      <p className="card-note">{t("accounts.management.note")}</p>

      {policyUnavailable && (
        <p className="accounts-inline-note error" role="alert" data-state="management.policy_unavailable">
          {t("accounts.management.policy_missing_note")}
        </p>
      )}
      {!policyUnavailable && isDisplayOnly && (
        <p className="card-note" data-state="management.display_only">
          {t("accounts.management.display_only_note")}
        </p>
      )}
      {!policyUnavailable && isConflict && (
        <p className="accounts-inline-note error" role="alert" data-state="management.conflict">
          {t("accounts.management.conflict_note", { reasons: reasonTexts.join(" · ") })}
        </p>
      )}
      {editor.uncertain && (
        <p className="accounts-inline-note error" role="alert" data-state="management.uncertain">
          {t("accounts.management.uncertain_error", { requestKey: editor.uncertainRequestKey ?? "—" })}
          {onRecover && (
            <button type="button" className="button button-secondary" disabled={Boolean(editor.saving)} onClick={onRecover}>
              {t("accounts.management.recover")}
            </button>
          )}
        </p>
      )}
      {editor.committedStateUnknown && (
        <p className="accounts-inline-note" role="status" data-state="management.committed_unknown">
          {t("accounts.management.committed_unknown")}
        </p>
      )}
      {editor.staleReplayIgnored && (
        <p className="card-note" data-state="management.stale_replay">
          {t("accounts.management.replay_stale")}
        </p>
      )}

      <div className="accounts-summary-rows">
        <div className="accounts-summary-row">
          <span>{t("accounts.management.class_label")}</span>
          <span>{classLabel}</span>
        </div>
        <div className="accounts-summary-row">
          <span>{t("accounts.management.applied_label")}</span>
          <span>{appliedSummary}</span>
        </div>
        <div className="accounts-summary-row">
          <span>{t("accounts.management.draft_label")}</span>
          <span className={section.draft?.status === "pending" ? "management-draft-pending" : undefined}>
            {draftSummary}
          </span>
        </div>
        <div className="accounts-summary-row">
          <span>{t("accounts.management.siblings_title")}</span>
          <span className="num">
            {section.siblings.length
              ? section.siblings.map(item => `${item.platform}/${item.key}`).join(" · ")
              : t("common.none")}
          </span>
        </div>
      </div>

      <p className="card-note">
        {section.siblings.length > 1
          ? t("accounts.management.siblings_note")
          : t("accounts.management.siblings_single")}
      </p>

      <p className="card-note">
        {t("accounts.management.revisions", {
          policy: section.policy_revision ?? "—",
          instance: section.instance_revision ?? "—",
        })}
      </p>

      {reasonTexts.length > 0 && !policyUnavailable && (
        <p className="card-note">
          {t("accounts.management.reason_summary", { reasons: reasonTexts.join(" · ") })}
        </p>
      )}

      {!canAdminWrite && (
        <p className="card-note">{t("accounts.management.admin_only")}</p>
      )}

      {section.management_class === "eligible" && (
        <div className="management-controls">
          <fieldset className="management-radio-group" disabled={controlsDisabled}>
            <legend className="management-legend">{t("accounts.management.draft_select")}</legend>
            <label htmlFor={enableId} className="management-radio">
              <input
                id={enableId}
                type="radio"
                name={radioName}
                checked={editor.draftValue === "true"}
                disabled={controlsDisabled}
                onChange={() => onSelectDraft?.(true)}
              />
              <span>{t("accounts.management.option_enable")}</span>
            </label>
            <label htmlFor={disableId} className="management-radio">
              <input
                id={disableId}
                type="radio"
                name={radioName}
                checked={editor.draftValue === "false"}
                disabled={controlsDisabled}
                onChange={() => onSelectDraft?.(false)}
              />
              <span>{t("accounts.management.option_disable")}</span>
            </label>
          </fieldset>
          <div className="accounts-toolbar">
            <button
              type="button"
              className="button button-secondary"
              disabled={!canSaveDraft}
              onClick={onSaveDraft}
            >
              {editor.saving === "management_draft"
                ? t("accounts.management.saving_draft")
                : t("accounts.management.save_draft")}
            </button>
            <button
              type="button"
              className="button button-primary"
              disabled={!canApplyDraft}
              onClick={onApplyDraft}
            >
              {editor.saving === "management_apply"
                ? t("accounts.management.applying")
                : t("accounts.management.apply_draft")}
            </button>
            {editor.dirty && onRevert && (
              <button type="button" className="button button-secondary" onClick={onRevert}>
                {t("accounts.management.revert")}
              </button>
            )}
            {onRefresh && (
              <button type="button" className="button button-secondary" onClick={onRefresh}>
                {t("accounts.management.reread")}
              </button>
            )}
          </div>
        </div>
      )}

      {feedback && (
        <p
          className={`accounts-inline-note${feedback.tone === "error" ? " error" : feedback.tone === "success" ? " success" : ""}`}
          role={feedback.tone === "error" ? "alert" : "status"}
        >
          {feedback.text}
        </p>
      )}
    </section>
  );
}

export function AccountManagementPanel({
  platform,
  accountKey,
  onChanged,
}: {
  platform: string;
  accountKey: string;
  onChanged?: () => void;
}) {
  const t = useT();
  const controller = useRef(createAccountSettingsController(unresolvedManagementSaves)).current;
  const [, setTick] = useState(0);
  const [readAttempt, setReadAttempt] = useState(0);
  const [readState, setReadState] = useState<"loading" | "ready" | "failed">("loading");
  const [feedback, setFeedback] = useState<{ tone: "success" | "error" | "warn"; text: string } | null>(null);
  const sync = () => setTick(value => value + 1);
  const view = controller.view();

  useEffect(() => {
    const id = `${platform}:${accountKey}`;
    const same = controller.selectedId() === id;
    if (same && view.management.saving) return;
    const op = same ? controller.start("refresh") : controller.select({ platform, key: accountKey });
    setReadState(controller.view().management.section ? "ready" : "loading");
    setFeedback(null);
    let cancelled = false;
    void (async () => {
      try {
        const payload = await loadAccountSettings(platform, accountKey);
        if (cancelled) return;
        const applied = same ? controller.applyRefresh(op, payload) : controller.applyRead(op, payload);
        if (!applied) {
          if (controller.isCurrent(op)) setReadState("failed");
          return;
        }
        setReadState("ready");
        sync();
      } catch {
        if (cancelled) return;
        if (!controller.applyUnavailable(op, "")) return;
        setReadState("failed");
        sync();
      }
    })();
    return () => { cancelled = true; controller.abandon(op); };
  }, [platform, accountKey, readAttempt, controller]);

  // One execution path for a first submit and for same-key recovery: the
  // durable receipt acknowledges the exact write; presenting the current state
  // needs a valid fresh read, whose absence is reported separately.
  const execute = async (started: { op: AccountSettingsOp; body: Record<string, unknown> }, kind: "management_draft" | "management_apply") => {
    setFeedback(null);
    sync();
    try {
      const receipt = kind === "management_draft"
        ? await saveManagementDraft(started.body as unknown as AccountManagementDraftSaveRequest)
        : await applyManagementDraft(started.body as unknown as AccountManagementApplyRequest);
      const fresh = await loadAccountSettings(platform, accountKey).catch(() => null);
      const acknowledged = controller.applyManagementSuccess(started.op, receipt, fresh);
      if (!controller.isCurrent(started.op)) {
        onChanged?.();
        return;
      }
      const editor = controller.view().management;
      if (!acknowledged) {
        controller.failManagement(started.op, true);
        setFeedback({ tone: "error", text: t("accounts.management.uncertain_error", { requestKey: String(started.body.request_key) }) });
      } else if (editor.committedStateUnknown) {
        setFeedback({ tone: "warn", text: t("accounts.management.committed_unknown") });
      } else if (editor.staleReplayIgnored) {
        setFeedback({ tone: "warn", text: t("accounts.management.replay_stale") });
      } else if (kind === "management_draft") {
        setFeedback({ tone: "success", text: t("accounts.management.saved_draft") });
      } else {
        setFeedback({ tone: "success", text: receipt.outcome === "no_op" ? t("accounts.management.noop_notice") : t("accounts.management.applied_notice") });
      }
      onChanged?.();
    } catch (error) {
      const status = Number((error as { status?: number })?.status || 0);
      const code = (error as { payload?: { error?: string }; message?: string })?.payload?.error || (error as Error)?.message || "unknown";
      const deterministic = status === 400 || status === 409;
      controller.failManagement(started.op, !deterministic, code);
      if (controller.isCurrent(started.op)) {
        setFeedback({
          tone: "error",
          text: deterministic
            ? t("accounts.management.conflict_error", { code: t(`reason.${code}`) })
            : t("accounts.management.uncertain_error", { requestKey: String(started.body.request_key) }),
        });
      }
    } finally {
      controller.finish(started.op);
      sync();
    }
  };

  const submitSaveDraft = async () => {
    const started = controller.startManagementDraftSave();
    if (!started || !controller.markManagementSubmitting(started.op)) return;
    await execute({ op: started.op, body: started.body as unknown as Record<string, unknown> }, "management_draft");
  };

  const submitApplyDraft = async () => {
    const started = controller.startManagementApply();
    if (!started || !controller.markManagementSubmitting(started.op)) return;
    await execute({ op: started.op, body: started.body as unknown as Record<string, unknown> }, "management_apply");
  };

  // Replay the unconfirmed request unchanged (same key); never a new write.
  const submitRecover = async () => {
    const started = controller.recoverManagementPending();
    if (!started || !controller.markManagementSubmitting(started.op)) return;
    await execute(started, started.op.kind as "management_draft" | "management_apply");
  };

  const reread = () => {
    const op = controller.start("refresh");
    setFeedback(null);
    void refreshAccountSettingsReadback(controller, op, () => loadAccountSettings(platform, accountKey)).then(result => {
      if (result.status === "ready") setReadState("ready");
      else if (result.status === "failed") setReadState("failed");
      sync();
    });
  };

  const canAdminWrite = view.settings?.operations?.save_draft === true;

  return (
    <AccountManagementSectionView
      section={view.management.section}
      editor={view.management}
      canAdminWrite={canAdminWrite}
      readState={readState}
      feedback={feedback}
      onSelectDraft={enabled => {
        if (controller.editManagement(enabled)) sync();
      }}
      onSaveDraft={() => void submitSaveDraft()}
      onApplyDraft={() => void submitApplyDraft()}
      onRecover={() => void submitRecover()}
      onRevert={() => {
        if (controller.revertManagement()) sync();
      }}
      onRefresh={() => {
        setReadAttempt(n => n + 1);
        reread();
      }}
    />
  );
}
