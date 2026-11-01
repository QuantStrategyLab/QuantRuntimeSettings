import { useEffect, useRef, useState } from "react";
import type { AsyncState } from "../../lib/hooks";
import { createRequestGate } from "../../lib/hooks";
import { newRequestId } from "../../api/cockpit";
import { AccessError } from "../../api/client";
import type {
  CredentialRotationEnvelope,
  CredentialRotationState,
  CredentialRotationStepUpMethod,
} from "../../api/contracts";
import {
  cancelCredentialRotation,
  finalizeCredentialRotation,
  isRotationTimestamp,
  rotationErrorCode,
  stageCredentialRotation,
  type CredentialMaintenance,
} from "../../api/endpoints";
import { useLanguage, useT } from "../../i18n";
import type { ConfirmRequest } from "../../components/Dialog";
import { Badge, ErrorState, Skeleton } from "../../components/primitives";
import { formatDateTime } from "../../lib/format";

export type RotationRead<T> = AsyncState<T> & { reload: () => void };

type ReminderPhase = CredentialMaintenance["phase"];
type Tone = "ok" | "warn" | "error" | "unknown";

const REMINDER_TONE: Record<ReminderPhase, Tone> = {
  expired: "error",
  "7": "warn",
  "14": "warn",
  "30": "warn",
  not_due: "ok",
  unknown: "unknown",
};

/** States that leave no open operation, so a new stage may begin. */
const CLOSED_STATES: readonly CredentialRotationState[] = ["finalized", "canceled", "failed"];
/** States where the server did not confirm the outcome: no further write is offered. */
const UNKNOWN_STATES: readonly CredentialRotationState[] = ["add_unknown", "finalize_unknown", "cancel_unknown"];
/** Colour is never the only signal: every state also carries its own text and icon badge. */
const STATE_TONE: Record<CredentialRotationState, Tone> = {
  adding_version: "unknown",
  staged: "warn",
  finalizing: "unknown",
  finalized: "ok",
  canceling: "unknown",
  canceled: "unknown",
  add_unknown: "error",
  finalize_unknown: "error",
  cancel_unknown: "error",
  failed: "error",
};

/** Fixed codes that confirm the server refused before any write. */
const DENIED_CODES = [
  "origin_required", "cross_origin_rejected", "rotation_owner_required", "step_up_invalid",
  "step_up_rate_limited", "credential_rotation_unavailable",
  "credential_rotation_operation_not_found", "credential_rotation_request_conflict",
  "credential_rotation_state_conflict", "credential_maintenance_revision_conflict",
];
/** Rejected before or without any write: the form or the operator needs to change. */
const INVALID_INPUT_CODES = [
  "invalid_credential_rotation_request", "invalid_credential_expiry",
  "request_id_invalid", "operation_id_invalid", "credential_value_length_invalid",
  "step_up_method_invalid", "step_up_code_required", "downstream_verification_required",
];

export interface StepUpForm {
  method: CredentialRotationStepUpMethod;
  code: string;
}

export interface StageForm extends StepUpForm {
  new_value: string;
  expires_at: string;
}

export const EMPTY_STEP_UP: StepUpForm = { method: "totp", code: "" };

export function emptyStageForm(): StageForm {
  return { new_value: "", expires_at: "", method: "totp", code: "" };
}

/** The expiry must carry an explicit offset; a naive local time is not a moment. */
export function stageFormIncomplete(form: StageForm): boolean {
  return form.new_value.length === 0 || !isRotationTimestamp(form.expires_at) || form.code.length === 0;
}

export function stepUpIncomplete(stepUp: StepUpForm): boolean {
  return stepUp.code.length === 0;
}

/** Holds one ID per logical write slot plus the block set for unconfirmed outcomes. */
export interface RotationRequestIds {
  acquire(key: string): string;
  block(key: string): void;
  isBlocked(key: string): boolean;
  release(key: string): void;
  releaseAll(): void;
  peek(key: string): string | null;
}

export function createRotationRequestIds(): RotationRequestIds {
  const ids = new Map<string, string>();
  const blocked = new Set<string>();
  return {
    acquire: key => {
      const existing = ids.get(key);
      if (existing) return existing;
      const id = newRequestId();
      ids.set(key, id);
      return id;
    },
    block: key => { blocked.add(key); },
    isBlocked: key => blocked.has(key),
    release: key => { ids.delete(key); blocked.delete(key); },
    releaseAll: () => { ids.clear(); blocked.clear(); },
    peek: key => ids.get(key) ?? null,
  };
}

export type RotationOutcome =
  | { kind: "envelope"; envelope: CredentialRotationEnvelope }
  | { kind: "superseded" }
  | { kind: "invalid"; code?: string }
  | { kind: "unavailable"; code?: string }
  | { kind: "unconfirmed" };

/**
 * One request ID per logical write. A fixed refusal confirms no write, so the slot
 * is released and the next attempt is a new logical write with a new ID: the server
 * rejects a reused ID carrying a different fingerprint. An outcome the server never
 * confirmed blocks the slot; the owner reconciles by reading, never by resubmitting.
 */
async function runRotation(
  slot: string,
  requests: RotationRequestIds,
  isCurrent: () => boolean,
  clearSecrets: () => void,
  invoke: (requestId: string) => Promise<CredentialRotationEnvelope>,
): Promise<RotationOutcome> {
  if (requests.isBlocked(slot)) return { kind: "unconfirmed" };
  const requestId = requests.acquire(slot);
  // Dropped before the first await, so the value never survives the submit tick.
  clearSecrets();
  try {
    const envelope = await invoke(requestId);
    if (!isCurrent()) return { kind: "superseded" };
    requests.release(slot);
    return { kind: "envelope", envelope };
  } catch (error) {
    // The shared client invalidates the session on 401 and on every 403 except a
    // rejected second factor, which stays an HttpError with its own fixed code.
    const code = rotationErrorCode(error);
    const refused = (error instanceof AccessError && error.status === 403)
      || (code !== null && DENIED_CODES.includes(code));
    if (refused) {
      if (isCurrent()) requests.release(slot);
      return code ? { kind: "unavailable", code } : { kind: "unavailable" };
    }
    if (code !== null && INVALID_INPUT_CODES.includes(code)) {
      if (isCurrent()) requests.release(slot);
      return { kind: "invalid", code };
    }
    if (isCurrent()) requests.block(slot);
    return { kind: "unconfirmed" };
  }
}

export function submitStage(options: {
  form: StageForm;
  slot: string;
  requests: RotationRequestIds;
  isCurrent: () => boolean;
  clearSecrets: () => void;
}): Promise<RotationOutcome> {
  if (stageFormIncomplete(options.form)) return Promise.resolve({ kind: "invalid" });
  const { new_value: newValue, expires_at: expiresAt, method, code } = options.form;
  return runRotation(options.slot, options.requests, options.isCurrent, options.clearSecrets, requestId =>
    stageCredentialRotation({ request_id: requestId, new_value: newValue, expires_at: expiresAt, step_up: { method, code } }));
}

export function submitFinalize(options: {
  stepUp: StepUpForm;
  operationId: string;
  downstreamVerified: boolean;
  slot: string;
  requests: RotationRequestIds;
  isCurrent: () => boolean;
  clearSecrets: () => void;
}): Promise<RotationOutcome> {
  if (!options.downstreamVerified || stepUpIncomplete(options.stepUp)) return Promise.resolve({ kind: "invalid" });
  const { method, code } = options.stepUp;
  return runRotation(options.slot, options.requests, options.isCurrent, options.clearSecrets, requestId =>
    finalizeCredentialRotation({
      operation_id: options.operationId,
      request_id: requestId,
      downstream_verified: true,
      step_up: { method, code },
    }));
}

export function submitCancel(options: {
  stepUp: StepUpForm;
  operationId: string;
  slot: string;
  requests: RotationRequestIds;
  isCurrent: () => boolean;
  clearSecrets: () => void;
}): Promise<RotationOutcome> {
  if (stepUpIncomplete(options.stepUp)) return Promise.resolve({ kind: "invalid" });
  const { method, code } = options.stepUp;
  return runRotation(options.slot, options.requests, options.isCurrent, options.clearSecrets, requestId =>
    cancelCredentialRotation({ operation_id: options.operationId, request_id: requestId, step_up: { method, code } }));
}

/** `HttpError` and `AccessError` are read for their fixed code only; payload and upstream text are never used. */
export function outcomeErrorKey(outcome: RotationOutcome): string | null {
  const code = "code" in outcome ? outcome.code : undefined;
  // Every distinct fixed code resolves to its own copy; the generic keys stay as
  // the fallback for a stop raised before any code exists.
  if (code) return `reason.${code}`;
  if (outcome.kind === "invalid") return "health.rotation.validation";
  if (outcome.kind === "unavailable") return "health.rotation.unavailable";
  if (outcome.kind === "unconfirmed") return "health.rotation.request_failed";
  return null;
}

/** Every mutation control is derived from the server's own `allowed_actions`. */
export function rotationActions(envelope: CredentialRotationEnvelope | null, busy: boolean) {
  const operation = envelope?.operation ?? null;
  const state = operation?.state ?? null;
  const closed = state === null || CLOSED_STATES.includes(state);
  const unknown = state !== null && UNKNOWN_STATES.includes(state);
  const stage = Boolean(envelope?.allowed_actions.includes("stage")) && closed && !unknown && !busy;
  const finalize = Boolean(operation?.allowed_actions.includes("finalize")) && !unknown && !busy;
  const cancel = Boolean(operation?.allowed_actions.includes("cancel")) && !unknown && !busy;
  return { stage, finalize, cancel, unknown, showStageForm: stage, showStepUp: finalize || cancel };
}

export interface CredentialRotationPanelProps {
  rotation: RotationRead<CredentialRotationEnvelope>;
  reminder: RotationRead<CredentialMaintenance>;
  confirm: (request: ConfirmRequest) => Promise<boolean>;
  onRotated: () => void;
}

export default function CredentialRotationPanel({
  rotation,
  reminder,
  confirm,
  onRotated,
}: CredentialRotationPanelProps) {
  const t = useT();
  const language = useLanguage();
  const [form, setForm] = useState<StageForm>(emptyStageForm);
  const [stepUp, setStepUp] = useState<StepUpForm>(EMPTY_STEP_UP);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  // Open whenever staging is allowed: the card exists to rotate, and submitting still
  // requires a fresh step-up code, so an open form cannot be triggered by accident.
  const [formOpen, setFormOpen] = useState(true);
  const gate = useRef(createRequestGate());
  const requests = useRef(createRotationRequestIds());

  // A fresher server read supersedes whatever a mutation is about to commit.
  useEffect(() => { gate.current.invalidate(); }, [rotation.data, rotation.phase]);

  const envelope = rotation.phase === "ready" ? rotation.data : null;
  const operation = envelope?.operation ?? null;
  const actions = rotationActions(envelope, busy);

  const settle = (outcome: RotationOutcome) => {
    setErrorKey(outcomeErrorKey(outcome));
    if (outcome.kind === "envelope") setFormOpen(false);
    // A client-side validation stop needs no new read; the server stays as it was.
    if (outcome.kind !== "invalid") onRotated();
  };

  const stageSlot = "credential-rotation:stage";
  const operationSlot = (action: string) => `credential-rotation:${action}:${operation?.operation_id ?? "none"}`;

  const runStage = async () => {
    if (busy || !actions.stage) return;
    if (stageFormIncomplete(form)) {
      setForm(current => ({ ...current, new_value: "", code: "" }));
      setErrorKey("health.rotation.validation");
      return;
    }
    if (!await confirm({
      title: t("health.rotation.stage"),
      consequence: t("health.rotation.stage_note"),
      confirmLabel: t("health.rotation.stage"),
    })) return;
    const token = gate.current.begin();
    setBusy(true);
    const outcome = await submitStage({
      form,
      slot: stageSlot,
      requests: requests.current,
      isCurrent: () => gate.current.isCurrent(token),
      clearSecrets: () => setForm(current => ({ ...current, new_value: "", code: "" })),
    });
    setBusy(false);
    settle(outcome);
  };

  const runOperation = async (action: "finalize" | "cancel") => {
    if (!operation || busy) return;
    const allowed = action === "finalize" ? actions.finalize : actions.cancel;
    if (!allowed || stepUpIncomplete(stepUp)) return;
    // The dialog's acknowledgement checkbox gates the confirm button, so a
    // resolve of `true` is the owner's attestation that downstream is done.
    const request: ConfirmRequest = action === "finalize"
      ? {
        title: t("health.rotation.finalize"),
        consequence: t("health.rotation.stage_note"),
        confirmLabel: t("health.rotation.finalize"),
        ackLabel: t("health.rotation.finalize_ack"),
      }
      : {
        title: t("health.rotation.cancel"),
        consequence: t("health.rotation.cancel_note"),
        tone: "danger",
        confirmLabel: t("health.rotation.cancel"),
      };
    if (!await confirm(request)) return;
    const token = gate.current.begin();
    const slot = operationSlot(action);
    setBusy(true);
    const outcome = action === "finalize"
      ? await submitFinalize({
        stepUp,
        operationId: operation.operation_id,
        downstreamVerified: true,
        slot,
        requests: requests.current,
        isCurrent: () => gate.current.isCurrent(token),
        clearSecrets: () => setStepUp(current => ({ ...current, code: "" })),
      })
      : await submitCancel({
        stepUp,
        operationId: operation.operation_id,
        slot,
        requests: requests.current,
        isCurrent: () => gate.current.isCurrent(token),
        clearSecrets: () => setStepUp(current => ({ ...current, code: "" })),
      });
    setBusy(false);
    settle(outcome);
  };

  const reconcile = () => {
    // A fresh read is the only way past an unconfirmed outcome; the previous
    // attempt's identity is dropped rather than resubmitted.
    requests.current.releaseAll();
    setErrorKey(null);
    onRotated();
  };

  const reminderBadge = reminder.phase === "ready"
    ? <Badge tone={REMINDER_TONE[reminder.data.phase]}>{t(`health.credential_phase.${reminder.data.phase}`)}</Badge>
    : reminder.phase === "loading"
      ? <Skeleton height={22} width={90} />
      : <Badge tone="unknown">{t("state.read_failed")}</Badge>;

  const metaValue = (value: string | null, absentKey: string) => {
    if (!value) return <dd data-empty="true">{t(absentKey)}</dd>;
    const { text, zone } = formatDateTime(value, language, true);
    return <dd><span className="rotation-stamp">{zone ? `${text} (${zone})` : text}</span></dd>;
  };

  return (
    <section className="card card-flat credential-rotation">
      <h2 className="card-title">{t("health.rotation.title")}</h2>
      <div className="rotation-reminder">
        {reminderBadge}
        {reminder.phase === "error" && (
          <button type="button" className="button button-secondary" onClick={reminder.reload}>
            {t("common.retry")}
          </button>
        )}
        {actions.stage && (
          <button type="button" className="button button-secondary" onClick={() => setFormOpen(!formOpen)}>
            {formOpen ? t("health.rotation.close") : t("health.rotation.open")}
          </button>
        )}
      </div>

      {rotation.phase === "loading" && <Skeleton height={72} />}
      {rotation.phase === "error" && <ErrorState onRetry={rotation.reload} />}

      {envelope && (
        <>
          <dl className="rotation-meta">
            <div className="rotation-meta-item">
              <dt>{t("health.col.credential")}</dt>
              <dd>{envelope.metadata.name}</dd>
            </div>
            <div className="rotation-meta-item">
              <dt>{t("health.rotation.last_rotated")}</dt>
              {metaValue(envelope.metadata.last_rotated_at, "health.rotation.never_rotated")}
            </div>
            <div className="rotation-meta-item">
              <dt>{t("health.rotation.expires")}</dt>
              {metaValue(envelope.metadata.expires_at, "health.rotation.no_expiry")}
            </div>
          </dl>

          {operation && (
            <div className="rotation-state" data-state={operation.state} data-tone={STATE_TONE[operation.state]}
              aria-live="polite" aria-busy={busy}>
              <Badge tone={STATE_TONE[operation.state]}>{t(`health.rotation.state.${operation.state}`)}</Badge>
              {operation.reason_code !== null && (
                <span className="rotation-state-reason">
                  {t(`reason.${operation.reason_code}`, {}, "reason.unknown")}
                </span>
              )}
            </div>
          )}

          {formOpen && actions.stage && (
            <form className="rotation-form" onSubmit={event => { event.preventDefault(); void runStage(); }}>
              <div className="rotation-fields">
                <label className="field">
                  <span>{t("health.rotation.new_secret")}</span>
                  <input
                    className="input"
                    type="password"
                    value={form.new_value}
                    onChange={event => setForm(current => ({ ...current, new_value: event.target.value }))}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <label className="field">
                  <span>{t("health.rotation.new_expiry")}</span>
                  <input
                    className="input"
                    type="text"
                    value={form.expires_at}
                    onChange={event => setForm(current => ({ ...current, expires_at: event.target.value }))}
                    placeholder="YYYY-MM-DDTHH:MM:SS+08:00"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <label className="field">
                  <span>{t("health.rotation.step_up_method")}</span>
                  <select
                    className="input"
                    value={form.method}
                    onChange={event => setForm(current => ({
                      ...current, method: event.target.value as CredentialRotationStepUpMethod, code: "",
                    }))}
                  >
                    <option value="totp">{t("health.rotation.method_totp")}</option>
                    <option value="recovery">{t("health.rotation.method_recovery")}</option>
                  </select>
                </label>
                <label className="field">
                  <span>{t("health.rotation.one_time_code")}</span>
                  <input
                    className="input"
                    type={form.method === "totp" ? "text" : "password"}
                    value={form.code}
                    onChange={event => setForm(current => ({ ...current, code: event.target.value }))}
                    autoComplete={form.method === "totp" ? "one-time-code" : "off"}
                    spellCheck={false}
                  />
                </label>
              </div>
              {errorKey && <p className="rotation-error" role="alert">{t(errorKey)}</p>}
              <div className="rotation-actions">
                <button type="submit" className="button button-primary" disabled={!actions.stage}>
                  {busy ? t("health.rotation.working") : t("health.rotation.stage")}
                </button>
              </div>
            </form>
          )}

          {actions.showStepUp && (
            <div className="rotation-form">
              <div className="rotation-fields">
                <label className="field">
                  <span>{t("health.rotation.step_up_method")}</span>
                  <select
                    className="input"
                    value={stepUp.method}
                    onChange={event => setStepUp(current => ({
                      ...current, method: event.target.value as CredentialRotationStepUpMethod, code: "",
                    }))}
                  >
                    <option value="totp">{t("health.rotation.method_totp")}</option>
                    <option value="recovery">{t("health.rotation.method_recovery")}</option>
                  </select>
                </label>
                <label className="field">
                  <span>{t("health.rotation.one_time_code")}</span>
                  <input
                    className="input"
                    type={stepUp.method === "totp" ? "text" : "password"}
                    value={stepUp.code}
                    onChange={event => setStepUp(current => ({ ...current, code: event.target.value }))}
                    autoComplete={stepUp.method === "totp" ? "one-time-code" : "off"}
                    spellCheck={false}
                  />
                </label>
              </div>
              {errorKey && <p className="rotation-error" role="alert">{t(errorKey)}</p>}
              <div className="rotation-actions">
                <button type="button" className="button button-primary" disabled={!actions.finalize}
                  onClick={() => void runOperation("finalize")}>
                  {busy ? t("health.rotation.working") : t("health.rotation.finalize")}
                </button>
                <button type="button" className="button button-secondary" disabled={!actions.cancel}
                  onClick={() => void runOperation("cancel")}>
                  {t("health.rotation.cancel")}
                </button>
              </div>
            </div>
          )}

          {(actions.unknown || errorKey !== null) && !actions.showStepUp && (
            <div className="rotation-actions">
              <button type="button" className="button button-secondary" onClick={reconcile}>
                {t("health.rotation.refresh")}
              </button>
            </div>
          )}
        </>
      )}

      {/* Explanatory prose stays outside the metadata and form blocks. */}
      {envelope && actions.unknown && <p className="card-note">{t("health.rotation.unknown_note")}</p>}
      {envelope && (actions.stage || actions.finalize) && <p className="card-note">{t("health.rotation.stage_note")}</p>}
      {envelope && actions.cancel && <p className="card-note">{t("health.rotation.cancel_note")}</p>}
      {envelope && <p className="card-note">{t("health.rotation.write_only_note")}</p>}
    </section>
  );
}
