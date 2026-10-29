import { useDisplayNames } from "../../lib/useDisplayNames";
import { useEffect, useState } from "react";
import type { RunControlAvailability } from "../../api/contracts";
import { loadAccountSettings, loadRunControls } from "../../api/endpoints";
import { postJson } from "../../api/client";
import { useT } from "../../i18n";
import { useApi } from "../../lib/hooks";
import { ErrorState, Skeleton } from "../../components/primitives";
import { DangerRow, DangerZone } from "../../components/DangerZone";
import { useToast } from "../../components/Toast";
import type { ConfirmRequest } from "../../components/Dialog";
import { targetNameFor, type AccountRow, type ConsoleConfig } from "./helpers";

type Confirm = (request: ConfirmRequest) => Promise<boolean>;
type ActionName = "enable" | "stop" | "resume" | "approve_application";
type Lock = "submitted" | "unknown";

/** Platforms that own one outstanding runtime control per target. */
const RUNTIME_CONTROL_PLATFORMS = new Set(["ibkr", "schwab"]);

/** Non-terminal phases keep both enable and stop locked. */
const CONTROL_LOCKED_PHASES = new Set(["reserved", "accepted", "unknown", "partial"]);
/** Terminal phases are the only thing that may release the lock. */
const CONTROL_TERMINAL_PHASES = new Set(["applied", "protected", "rejected"]);

const ACTION_ORDER: { name: ActionName; titleKey: string; summaryKey: string }[] = [
  { name: "enable", titleKey: "controls.enable", summaryKey: "controls.enable_summary" },
  { name: "stop", titleKey: "controls.stop", summaryKey: "controls.stop_summary" },
  { name: "resume", titleKey: "controls.resume", summaryKey: "controls.resume_summary" },
  { name: "approve_application", titleKey: "controls.approve_application", summaryKey: "controls.approve_summary" },
];

/** Legacy settings payload pieces needed by the profile-application approve POST. */
interface LegacySettings {
  identity?: unknown;
  instance_revision?: unknown;
  draft?: { revision?: unknown; overrides?: Record<string, unknown> };
  effective?: { strategy_profile?: { status?: unknown; value?: unknown } };
}

export function ControlsTab({
  account,
  config,
  confirm,
}: {
  account: AccountRow;
  config: ConsoleConfig | null;
  confirm: Confirm;
}) {
  const t = useT();
  const toast = useToast();
  const names = useDisplayNames(config);
  const state = useApi(() => loadRunControls(account.account_alias, account.platform), [account.account_alias, account.platform]);
  const [busy, setBusy] = useState<ActionName | null>(null);
  // Unknown or ambiguous outcomes lock the action until the availability is reloaded.
  const [locks, setLocks] = useState<Partial<Record<ActionName, Lock>>>({});
  const targetKey = `${account.platform}:${account.account_alias}`;
  const [pendingControl, setPendingControl] = useState<{ requestId: string; targetKey: string } | null>(null);
  const [busyControl, setBusyControl] = useState<{ name: ActionName; targetKey: string } | null>(null);

  useEffect(() => {
    if (state.phase !== "ready" || !pendingControl || pendingControl.targetKey !== targetKey
        || state.data.account_alias !== account.account_alias || state.data.platform !== account.platform) return;
    const control = state.data.runtime_control;
    if (!control || control.request_id !== pendingControl.requestId) return;
    if (!CONTROL_TERMINAL_PHASES.has(control.phase || "")) return;
    setPendingControl(null);
  }, [state, pendingControl, targetKey]);

  if (state.phase === "loading") return <Skeleton height={200} />;
  if (state.phase === "error") return <ErrorState onRetry={state.reload} />;
  const data: RunControlAvailability = state.data;
  if (data.account_alias !== account.account_alias || data.platform !== account.platform) return <Skeleton height={200} />;
  const isRuntimeControlPlatform = RUNTIME_CONTROL_PLATFORMS.has(account.platform.toLowerCase());

  const reasonText = (reason: string): string => {
    const key = `reason.${reason}`;
    const translated = t(key);
    return translated === key ? reason : translated;
  };

  const control = data.runtime_control;
  const controlLocked = Boolean(pendingControl?.targetKey === targetKey) || Boolean(control && CONTROL_LOCKED_PHASES.has(control.phase || ""));
  const controlNote = control?.unavailable_reason
    ? reasonText(control.unavailable_reason)
    : control && (control.phase === "unknown" || control.phase === "partial")
      ? t("controls.unknown_result")
      : t("controls.submitted");

  const inspectControl = async () => {
    try {
      await postJson("/api/runtime-stop", {
        platform: account.platform,
        target_name: targetNameFor(config, account.platform, account.account_alias),
        operation: "inspect",
        confirm: "READ_ONLY",
      });
    } catch {
      // Inspect is advisory; the reload below still surfaces the server state.
    } finally {
      state.reload();
    }
  };

  const reload = () => {
    setLocks({});
    if (!isRuntimeControlPlatform || !control || !CONTROL_LOCKED_PHASES.has(control.phase || "")) {
      state.reload();
      return;
    }
    // Explicit refresh asks the runtime to reconcile, then reloads run controls.
    void inspectControl();
  };

  const finish = (name: ActionName, ok: boolean) => {
    setLocks(prev => ({ ...prev, [name]: ok ? "submitted" : "unknown" }));
    toast({ kind: ok ? "success" : "error", text: t(ok ? "controls.submitted" : "controls.unknown_result") });
  };

  const submitStop = async () => {
    if (isRuntimeControlPlatform) {
      await submitControl("disable");
      return;
    }
    const accepted = await confirm({
      title: t("controls.stop_confirm_title"),
      target: names.account(account.account_alias, account.platform),
      summary: t("controls.stop_summary"),
      consequence: t("controls.stop_consequence"),
      tone: "danger",
      confirmLabel: t("controls.stop"),
      typeToConfirm: {
        label: t("controls.stop_type_alias", { alias: account.account_alias }),
        expected: account.account_alias,
        mismatch: t("controls.alias_mismatch"),
      },
    });
    if (!accepted) return;
    setBusy("stop");
    try {
      await postJson("/api/runtime-stop", {
        platform: account.platform,
        target_name: targetNameFor(config, account.platform, account.account_alias),
        confirm: "STOP_ONLY",
      });
      finish("stop", true);
    } catch {
      finish("stop", false);
    } finally {
      setBusy(null);
    }
  };

  const submitResume = async () => {
    const sha256 = data.resume_binding?.runtime_target_sha256;
    if (typeof sha256 !== "string" || !sha256) return;
    const accepted = await confirm({
      title: t("controls.confirm.resume_title"),
      target: names.account(account.account_alias, account.platform),
      summary: t("controls.resume_summary"),
      tone: "danger",
      confirmLabel: t("controls.resume"),
    });
    if (!accepted) return;
    setBusy("resume");
    try {
      await postJson("/api/runtime-resume", {
        platform: account.platform,
        target_name: targetNameFor(config, account.platform, account.account_alias),
        runtime_target_sha256: sha256,
        confirm: "RESUME_EXISTING",
      });
      finish("resume", true);
    } catch {
      finish("resume", false);
    } finally {
      setBusy(null);
    }
  };

  const submitApprove = async () => {
    const accepted = await confirm({
      title: t("controls.confirm.approve_title"),
      target: names.account(account.account_alias, account.platform),
      summary: t("controls.approve_summary"),
      tone: "danger",
      confirmLabel: t("controls.approve_application"),
    });
    if (!accepted) return;
    setBusy("approve_application");
    try {
      const settings = (await loadAccountSettings(account.platform, account.account_alias)) as LegacySettings;
      const overrides = settings.draft?.overrides || {};
      const keys = Object.keys(overrides);
      const pending = typeof overrides.strategy_profile === "string" ? overrides.strategy_profile.trim() : "";
      const effectiveField = settings.effective?.strategy_profile;
      const effective = effectiveField?.status === "known" && typeof effectiveField.value === "string" ? effectiveField.value.trim() : "";
      const eligible = Boolean(
        settings.identity
        && Number.isSafeInteger(settings.instance_revision)
        && Number.isSafeInteger(settings.draft?.revision)
        && keys.length === 1
        && keys[0] === "strategy_profile"
        && pending
        && effective
        && pending !== effective,
      );
      if (!eligible) {
        // Nothing was sent; this is a local pre-check, not an ambiguous outcome.
        toast({ kind: "error", text: t("controls.approve_not_ready") });
        return;
      }
      await postJson("/api/account-settings/profile-application/approve", {
        platform: account.platform,
        key: account.account_alias,
        request_key: crypto.randomUUID(),
        identity: settings.identity,
        expected_instance_revision: settings.instance_revision,
        expected_draft_revision: settings.draft?.revision,
        old_profile: effective,
        new_profile: pending,
      });
      finish("approve_application", true);
    } catch {
      finish("approve_application", false);
    } finally {
      setBusy(null);
    }
  };

  const submitControl = async (operation: "enable" | "disable") => {
    const name: ActionName = operation === "enable" ? "enable" : "stop";
    const accepted = await confirm(operation === "enable"
      ? {
          title: t("controls.confirm.enable_title"),
          target: names.account(account.account_alias, account.platform),
          summary: t("controls.enable_summary"),
          consequence: t("controls.enable_control_note"),
          tone: "normal",
          confirmLabel: t("controls.enable"),
        }
      : {
          title: t("controls.stop_confirm_title"),
          target: names.account(account.account_alias, account.platform),
          summary: t("controls.stop_summary"),
          consequence: t("controls.stop_consequence"),
          tone: "danger",
          confirmLabel: t("controls.stop"),
          typeToConfirm: {
            label: t("controls.stop_type_alias", { alias: account.account_alias }),
            expected: account.account_alias,
            mismatch: t("controls.alias_mismatch"),
          },
        });
    if (!accepted) return;
    const requestId = crypto.randomUUID();
    setPendingControl({ requestId, targetKey });
    setBusyControl({ name, targetKey });
    try {
      await postJson("/api/runtime-stop", {
        platform: account.platform,
        target_name: targetNameFor(config, account.platform, account.account_alias),
        operation,
        request_id: requestId,
        confirm: "CONTROL_ONLY",
      });
      toast({ kind: "success", text: t("controls.submitted") });
    } catch {
      toast({ kind: "error", text: t("controls.unknown_result") });
    } finally {
      setBusyControl(current => current?.targetKey === targetKey ? null : current);
      state.reload();
    }
  };

  const submitEnable = async () => {
    if (isRuntimeControlPlatform) {
      await submitControl("enable");
      return;
    }
    // No direct enable write exists for the other platforms; point to the existing flow.
    await confirm({
      title: t("controls.confirm.enable_title"),
      target: names.account(account.account_alias, account.platform),
      summary: t("controls.enable_summary"),
      consequence: t("controls.enable_note"),
      tone: "normal",
      confirmLabel: t("common.close"),
    });
  };

  const handlers: Record<ActionName, () => Promise<void>> = {
    enable: submitEnable,
    stop: submitStop,
    resume: submitResume,
    approve_application: submitApprove,
  };

  return (
    <div className="section-stack">
      {isRuntimeControlPlatform && control?.phase === "rejected" && control.unavailable_reason && <p className="card-note">{reasonText(control.unavailable_reason)}</p>}
      {isRuntimeControlPlatform && control?.phase === "protected" && <p className="card-note">{t("controls.protected")}</p>}
      <DangerZone>
        {ACTION_ORDER.map(({ name, titleKey, summaryKey }) => {
          const action = data.actions[name];
          const lock = locks[name];
          const controlLock = controlLocked && (name === "enable" || name === "stop");
          const disabled = busy !== null || busyControl?.targetKey === targetKey || Boolean(lock) || controlLock || !action.enabled;
          const note = lock
            ? t(lock === "submitted" ? "controls.submitted" : "controls.unknown_result")
            : controlLock
              ? controlNote
              : !action.enabled
                ? reasonText(action.reason)
                : null;
          return (
            <DangerRow
              key={name}
              title={t(titleKey)}
              summary={t(summaryKey)}
              unavailableReason={note}
              action={
                <button
                  type="button"
                  className={`button ${name === "stop" || name === "resume" ? "button-danger-outline" : "button-secondary"}`}
                  disabled={disabled}
                  onClick={() => void handlers[name]()}
                >
                  {busy === name || (busyControl?.targetKey === targetKey && busyControl.name === name) ? t("controls.submitting") : t(titleKey)}
                </button>
              }
            />
          );
        })}
      </DangerZone>
      <p className="card-note">
        <button type="button" className="accounts-alias-button" onClick={reload}>{t("common.refresh")}</button>
      </p>
    </div>
  );
}
