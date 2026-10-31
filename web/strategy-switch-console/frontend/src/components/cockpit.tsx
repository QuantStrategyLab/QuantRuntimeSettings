import { useEffect, useId, useRef, useState } from "react";
import type {
  AuditEvent,
  DecisionDetail,
  DigestStatus as DigestStatusData,
  EvidenceSummary as EvidenceSummaryData,
  LifecycleBinding,
  OperationRecord,
  PolicyBinding,
  PolicyValue,
  ProductStage,
  RiskTier,
} from "../api/cockpit";
import { expiryState, isRiskTier } from "../api/cockpit";
import { formatDateTime } from "../lib/format";
import { useLanguage, useT } from "../i18n";
import { Badge, Skeleton } from "./primitives";
import "./cockpit.css";

const TIERS: RiskTier[] = ["CAPITAL_PRESERVATION", "BALANCED_COMPOUNDING", "GROWTH_COMPOUNDING"];
const STAGES: ProductStage[] = ["research", "paper", "small_live", "full_live"];

export function tierLabel(value: string | null | undefined, t: ReturnType<typeof useT>): string {
  if (value === "CAPITAL_PRESERVATION") return t("cockpit.tier.capital");
  if (value === "BALANCED_COMPOUNDING") return t("cockpit.tier.balanced");
  if (value === "GROWTH_COMPOUNDING") return t("cockpit.tier.growth");
  return t("cockpit.not_set");
}

export function blockerLabel(reason: string, t: ReturnType<typeof useT>): string {
  if (reason === "decision_expired") return t("cockpit.blocker.expired");
  if (reason === "expiry_unverified") return t("cockpit.blocker.expiry");
  if (reason === "approval_not_allowed") return t("cockpit.blocker.not_allowed");
  if (reason === "evidence_missing") return t("cockpit.blocker.support_missing");
  if (reason === "evidence_unqualified") return t("cockpit.blocker.unqualified");
  if (reason.startsWith("evidence_")) return t("cockpit.blocker.support");
  if (reason === "policy_unavailable") return t("cockpit.blocker.policy");
  if (reason === "policy_binding_missing") return t("cockpit.blocker.binding");
  if (reason === "revision_invalid") return t("cockpit.blocker.revision");
  if (reason.startsWith("state_")) return t("cockpit.blocker.state");
  return t("cockpit.blocker.other");
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

function remainingText(ms: number, language: "zh" | "en"): string {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return language === "zh" ? `${minutes} 分钟` : `${minutes}m`;
  return language === "zh"
    ? `${hours} 小时 ${String(minutes).padStart(2, "0")} 分`
    : `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

/* ---------- freshness ---------- */

export function FreshnessBadge({
  state,
  observedAt,
}: {
  state: string | null | undefined;
  observedAt?: string | null;
}) {
  const t = useT();
  const language = useLanguage();
  const known = state === "current" || state === "stale" || state === "missing" || state === "unknown"
    || state === "partial" || state === "unavailable" || state === "read_failed" || state === "fresh" || state === "ready";
  const normalized = state === "fresh" || state === "ready" ? "current" : known ? state : "unknown";
  const tone = normalized === "current" ? "ok"
    : normalized === "read_failed" ? "error"
      : normalized === "stale" || normalized === "partial" ? "warn" : "unknown";
  const observed = observedAt ? formatDateTime(observedAt, language) : null;
  return (
    <span className="cockpit-freshness" data-state={normalized}>
      <Badge tone={tone}>{t(`cockpit.freshness.${normalized}`)}</Badge>
      {observed && <span className="cockpit-meta">{t("cockpit.as_of", { value: observed.zone ? `${observed.text} (${observed.zone})` : observed.text })}</span>}
    </span>
  );
}

/* ---------- expiry ---------- */

export function ExpiryIndicator({
  expiresAt,
  serverTime,
  receivedAt,
  onBoundary,
  showConsequence = true,
}: {
  expiresAt: string | null;
  serverTime: string | null;
  receivedAt: string;
  onBoundary?: () => void;
  showConsequence?: boolean;
}) {
  const t = useT();
  const language = useLanguage();
  const now = useNow(Boolean(expiresAt));
  const expiry = expiryState(expiresAt, serverTime, receivedAt, now);
  const firedFor = useRef<string | null>(null);
  useEffect(() => {
    if (expiry.state === "expired" && firedFor.current !== expiresAt) {
      firedFor.current = expiresAt;
      onBoundary?.();
    }
  }, [expiry.state, expiresAt, onBoundary]);

  if (expiry.state === "none") {
    return <p className="cockpit-expiry" data-state="none">{t("cockpit.expiry.none")}</p>;
  }
  if (expiry.state === "unknown") {
    return <p className="cockpit-expiry" data-state="unknown">{t("cockpit.expiry.unknown")}</p>;
  }
  const formatted = formatDateTime(expiry.expiresAt, language);
  const exact = formatted.text === "—" ? expiry.expiresAt : formatted.zone ? `${formatted.text} (${formatted.zone})` : formatted.text;
  const expired = expiry.state === "expired";
  const remaining = expiry.state === "expired" ? 0 : expiry.remainingMs;
  const urgency = expired ? "expired" : remaining < 5 * 60_000 ? "under_five" : remaining < 60 * 60_000 ? "under_hour" : "open";
  const label = expired ? t("cockpit.expiry.expired")
    : t(`cockpit.expiry.${urgency}`, { value: remainingText(remaining, language) });
  return (
    <div className="cockpit-expiry" data-state={urgency}>
      <p className="cockpit-expiry-line">
        <span>{t("cockpit.expiry.at", { value: exact })}</span>
        <span className="cockpit-expiry-remaining">{label}</span>
      </p>
      <span className="cockpit-expiry-utc"><time dateTime={expiry.expiresAt}>{expiry.expiresAt}</time></span>
      {showConsequence && (
        <p className="cockpit-note">
          {t("cockpit.expiry.inaction")} {!expired && t("cockpit.expiry.boundary")}
        </p>
      )}
    </div>
  );
}

/* ---------- supporting data ---------- */

export function EvidenceSummary({
  evidence,
  status = "ready",
}: {
  evidence: EvidenceSummaryData | null;
  status?: "loading" | "ready" | "unavailable";
}) {
  const t = useT();
  const language = useLanguage();
  if (status === "loading") return <Skeleton height={72} />;
  if (status === "unavailable" || !evidence) {
    return (
      <section className="cockpit-section" aria-label={t("cockpit.support.title")}>
        <h3 className="cockpit-section-title">{t("cockpit.support.title")}</h3>
        <p className="cockpit-note error" role="status">{t("cockpit.support.missing")}</p>
      </section>
    );
  }
  const limitations = evidence.limitations;
  const qualification = evidence.qualification === "qualified"
    ? limitations.length > 0 ? t("cockpit.support.qualified_limited") : t("cockpit.support.qualified")
    : evidence.qualification === "unqualified" ? t("cockpit.support.unqualified") : t("cockpit.support.unknown");
  const tone = evidence.qualification === "qualified" ? limitations.length > 0 ? "warn" : "ok"
    : evidence.qualification === "unqualified" ? "error" : "unknown";
  const stateNotice = evidence.state === "stale" ? t("cockpit.support.stale")
    : evidence.state === "expired" ? t("cockpit.support.expired")
      : evidence.state === "unavailable" ? t("cockpit.support.unavailable")
        : evidence.state === "missing" ? t("cockpit.support.missing") : null;
  const observed = evidence.observed_at ? formatDateTime(evidence.observed_at, language) : null;
  const valid = evidence.valid_until ? formatDateTime(evidence.valid_until, language) : null;
  return (
    <section className="cockpit-section" aria-label={t("cockpit.support.title")}>
      <h3 className="cockpit-section-title">{t("cockpit.support.title")}</h3>
      <div className="cockpit-badges">
        <Badge tone={tone}>{qualification}</Badge>
        <FreshnessBadge state={evidence.state} />
      </div>
      {stateNotice && <p className="cockpit-note error" role="status">{stateNotice}</p>}
      <dl className="cockpit-kv">
        {observed && (
          <>
            <dt>{t("cockpit.support.observed_label")}</dt>
            <dd>{observed.zone ? `${observed.text} (${observed.zone})` : observed.text}</dd>
          </>
        )}
        {valid && (
          <>
            <dt>{t("cockpit.support.valid_until_label")}</dt>
            <dd>{valid.zone ? `${valid.text} (${valid.zone})` : valid.text}</dd>
          </>
        )}
        <dt>{t("cockpit.support.limitations")}</dt>
        <dd>{limitations.length > 0 ? limitations.join(" · ") : t("cockpit.support.no_limitations")}</dd>
      </dl>
      {evidence.evidence_id && (
        <details className="cockpit-details">
          <summary>{t("cockpit.support.provenance")}</summary>
          <code>{evidence.evidence_id}</code>
        </details>
      )}
    </section>
  );
}

/* ---------- risk tier selector ---------- */

export function RiskTierSelector({
  scope,
  value,
  savedValue,
  selectionRevision,
  mappingAvailable,
  disabled,
  saving,
  dirty,
  onChange,
  onSave,
}: {
  scope: string;
  value: string;
  savedValue: string;
  selectionRevision: number | null;
  mappingAvailable: boolean;
  disabled: boolean;
  saving: boolean;
  dirty: boolean;
  onChange: (tier: RiskTier | "") => void;
  onSave: () => void;
}) {
  const t = useT();
  const id = useId();
  const unrecognized = value !== "" && !isRiskTier(value);
  return (
    <section className="cockpit-section" aria-label={t("cockpit.tier.title")}>
      <h3 className="cockpit-section-title">{t("cockpit.tier.title")}</h3>
      <p className="cockpit-meta">{t("cockpit.tier.scope", { value: scope })}</p>
      <fieldset className="cockpit-tier-group" disabled={disabled || saving}>
        <legend className="cockpit-sr-only">{t("cockpit.tier.title")}</legend>
        {TIERS.map(tier => {
          const noteKey = tier === "CAPITAL_PRESERVATION" ? "cockpit.tier.capital_note"
            : tier === "BALANCED_COMPOUNDING" ? "cockpit.tier.balanced_note" : "cockpit.tier.growth_note";
          return (
            <label className="cockpit-tier-option" key={tier}>
              <input
                type="radio"
                name={`${id}-tier`}
                value={tier}
                checked={value === tier}
                aria-describedby={`${id}-${tier}`}
                onChange={() => onChange(tier)}
              />
              <span>
                <span className="cockpit-tier-name">{t(`cockpit.tier.${tier === "CAPITAL_PRESERVATION" ? "capital" : tier === "BALANCED_COMPOUNDING" ? "balanced" : "growth"}`)}</span>
                <span className="cockpit-tier-note" id={`${id}-${tier}`}>{t(noteKey)}</span>
              </span>
            </label>
          );
        })}
        <label className="cockpit-tier-option">
          <input
            type="radio"
            name={`${id}-tier`}
            value=""
            checked={value === ""}
            aria-describedby={`${id}-unset`}
            onChange={() => onChange("")}
          />
          <span>
            <span className="cockpit-tier-name">{t("cockpit.tier.unset")}</span>
            <span className="cockpit-tier-note" id={`${id}-unset`}>{t("cockpit.tier.unset_note")}</span>
          </span>
        </label>
      </fieldset>
      {unrecognized && <p className="cockpit-note" role="status">{t("cockpit.unknown")}: {value}</p>}
      {!mappingAvailable && <p className="cockpit-note error" role="status">{t("cockpit.policy.mapping_unavailable")}</p>}
      <div className="cockpit-toolbar">
        <button
          type="button"
          className="button button-primary button-sm"
          disabled={disabled || saving || !dirty || !mappingAvailable}
          onClick={onSave}
        >
          {t("cockpit.tier.save")}
        </button>
        <span className="cockpit-meta">{dirty ? t("cockpit.tier.dirty") : t("cockpit.tier.unchanged")}</span>
        {selectionRevision !== null && (
          <span className="cockpit-meta">{t("cockpit.tier.selection_revision", { value: selectionRevision })}</span>
        )}
      </div>
      <p className="cockpit-meta">
        {t("cockpit.decision.selected")}: {savedValue === "" ? t("cockpit.tier.unset") : tierLabel(savedValue, t)}
      </p>
      {!mappingAvailable && <p className="cockpit-note">{t("cockpit.policy.effective_note")}</p>}
    </section>
  );
}

/* ---------- effective policy ---------- */

function PolicyValueCell({ value }: { value: PolicyValue }) {
  const t = useT();
  if (value.status !== "known" || value.value === null) {
    return <span className="cockpit-unknown">{t("cockpit.policy.unknown_value")}</span>;
  }
  return <span>{String(value.value)}{value.unit ? ` ${value.unit}` : ""}</span>;
}

export function EffectivePolicyPanel({
  binding,
  status = "ready",
  onRetry,
}: {
  binding: PolicyBinding | null;
  status?: "loading" | "ready" | "not_ready" | "error";
  onRetry?: () => void;
}) {
  const t = useT();
  const language = useLanguage();
  if (status === "loading") return <Skeleton height={96} />;
  if (status === "error") {
    return (
      <section className="cockpit-section" aria-label={t("cockpit.policy.title")}>
        <h3 className="cockpit-section-title">{t("cockpit.policy.title")}</h3>
        <p className="cockpit-note error" role="alert">{t("cockpit.policy.read_failed")}</p>
        {onRetry && <button type="button" className="button button-secondary button-sm" onClick={onRetry}>{t("common.retry")}</button>}
      </section>
    );
  }
  if (status === "not_ready" || !binding) {
    return (
      <section className="cockpit-section" aria-label={t("cockpit.policy.title")}>
        <h3 className="cockpit-section-title">{t("cockpit.policy.title")}</h3>
        <p className="cockpit-note error" role="status">{t("cockpit.policy.mapping_unavailable")}</p>
      </section>
    );
  }
  const restriction = binding.temporary_restriction;
  const effectiveObserved = binding.effective_observed_at ? formatDateTime(binding.effective_observed_at, language) : null;
  const since = restriction?.until ? formatDateTime(restriction.until, language) : null;
  return (
    <section className="cockpit-section" aria-label={t("cockpit.policy.title")}>
      <h3 className="cockpit-section-title">{t("cockpit.policy.title")}</h3>
      <dl className="cockpit-kv">
        <dt>{t("cockpit.policy.selected")}</dt>
        <dd>
          {binding.selected_tier ? tierLabel(binding.selected_tier, t) : t("cockpit.unknown")}
          {binding.selection_revision !== null && <span className="cockpit-meta"> · {t("cockpit.policy.revision", { value: binding.selection_revision })}</span>}
        </dd>
        <dt>{t("cockpit.policy.approved")}</dt>
        <dd>
          {binding.approved_policy_id || binding.approved_tier ? (
            <>
              {binding.approved_tier && <>{tierLabel(binding.approved_tier, t)} · </>}
              {binding.approved_policy_id || t("cockpit.unknown")}
              {binding.approved_policy_revision && <span className="cockpit-meta"> · {t("cockpit.policy.revision", { value: binding.approved_policy_revision })}</span>}
            </>
          ) : t("cockpit.policy.mapping_unavailable")}
        </dd>
        <dt>{t("cockpit.policy.effective")}</dt>
        <dd>
          {binding.effective_policy_id || binding.effective_tier ? (
            <>
              {binding.effective_tier && <>{tierLabel(binding.effective_tier, t)} · </>}
              {binding.effective_policy_id || t("cockpit.unknown")}
              {binding.effective_policy_revision && <span className="cockpit-meta"> · {t("cockpit.policy.revision", { value: binding.effective_policy_revision })}</span>}
              {effectiveObserved && <span className="cockpit-meta"> · {t("cockpit.as_of", { value: effectiveObserved.text })}</span>}
            </>
          ) : t("cockpit.policy.not_observed")}
        </dd>
        <dt>{t("cockpit.policy.restriction")}</dt>
        <dd>
          {restriction?.active ? (
            <>
              {restriction.reason || t("cockpit.unknown")}
              {since && <span className="cockpit-meta"> · {t("cockpit.policy.since", { value: since.text })}</span>}
            </>
          ) : t("cockpit.policy.restriction_none")}
        </dd>
      </dl>
      <h4 className="cockpit-subtitle">{t("cockpit.policy.values")}</h4>
      {binding.values.length === 0 ? (
        <p className="cockpit-meta">{t("cockpit.policy.no_values")}</p>
      ) : (
        <table className="cockpit-table">
          <thead>
            <tr>
              <th scope="col">{t("cockpit.policy.values")}</th>
              <th scope="col">{t("cockpit.policy.source_label")}</th>
            </tr>
          </thead>
          <tbody>
            {binding.values.map(value => (
              <tr key={value.key}>
                <th scope="row">{value.label_key ? t(value.label_key) : value.key}</th>
                <td>
                  <PolicyValueCell value={value} />
                  {value.source && <span className="cockpit-meta"> · {t("cockpit.policy.source", { value: value.source })}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="cockpit-note">{t("cockpit.policy.effective_note")}</p>
    </section>
  );
}

/* ---------- lifecycle ---------- */

export function LifecycleStepper({ binding }: { binding: LifecycleBinding }) {
  const t = useT();
  const highlight = STAGES.includes(binding.authorized_stage as ProductStage)
    ? binding.authorized_stage as ProductStage
    : STAGES.includes(binding.effective_stage as ProductStage)
      ? binding.effective_stage as ProductStage
      : null;
  const highlightIndex = highlight ? STAGES.indexOf(highlight) : -1;
  const axes: { key: string; value: string }[] = [
    { key: "cockpit.lifecycle.axis.research", value: t(`cockpit.lifecycle.stage.${binding.research_stage}`) },
    { key: "cockpit.lifecycle.axis.authorized", value: t(`cockpit.lifecycle.stage.${binding.authorized_stage}`) },
    { key: "cockpit.lifecycle.axis.effective", value: t(`cockpit.lifecycle.stage.${binding.effective_stage}`) },
    { key: "cockpit.lifecycle.axis.operating", value: t(`cockpit.lifecycle.operating.${binding.operating_state}`) },
    { key: "cockpit.lifecycle.axis.application", value: t(`cockpit.lifecycle.application.${binding.application_state}`) },
  ];
  return (
    <section className="cockpit-section" aria-label={t("cockpit.lifecycle.title")}>
      <h3 className="cockpit-section-title">{t("cockpit.lifecycle.title")}</h3>
      <p className="cockpit-meta">{t("cockpit.lifecycle.step")}</p>
      <ol className="cockpit-stepper">
        {STAGES.map((stage, index) => {
          const active = highlightIndex >= 0 && index === highlightIndex;
          const complete = highlightIndex >= 0 && index < highlightIndex;
          return (
            <li
              key={stage}
              className={`cockpit-step${active ? " active" : ""}${complete ? " complete" : ""}`}
              aria-current={active ? "step" : undefined}
            >
              <span className="cockpit-step-dot" aria-hidden="true" />
              <span>{t(`cockpit.lifecycle.stage.${stage}`)}</span>
            </li>
          );
        })}
      </ol>
      {highlight === null && (
        <p className="cockpit-note" role="status">{t("cockpit.lifecycle.stage.unclassified")}</p>
      )}
      <dl className="cockpit-kv">
        {axes.map(axis => (
          <div className="cockpit-kv-pair" key={axis.key}>
            <dt>{t(axis.key)}</dt>
            <dd>{axis.value}</dd>
          </div>
        ))}
      </dl>
      <p className="cockpit-note">{t("cockpit.lifecycle.note")}</p>
    </section>
  );
}

/* ---------- application / operation status ---------- */

function operationLabel(operation: OperationRecord, t: ReturnType<typeof useT>): string {
  if (operation.runtime_confirmed_at) return t("cockpit.operation.confirmed");
  if (operation.state === "pending") return operation.dispatched_at ? t("cockpit.operation.applying") : t("cockpit.operation.accepted");
  if (operation.state === "applying") return t("cockpit.operation.applying");
  if (operation.state === "applied") return t("cockpit.operation.applied_unobserved");
  if (operation.state === "rejected") return t("cockpit.operation.rejected");
  if (operation.state === "failed") return t("cockpit.operation.failed");
  return t("cockpit.operation.unknown");
}

function operationTone(operation: OperationRecord): "ok" | "warn" | "error" | "unknown" {
  if (operation.runtime_confirmed_at) return "ok";
  if (operation.state === "rejected" || operation.state === "failed") return "error";
  if (operation.state === "applied" || operation.state === "applying" || operation.state === "pending") return "warn";
  return "unknown";
}

export function ApplicationStatus({
  operation,
  status,
  onRefresh,
}: {
  operation: OperationRecord | null;
  status: "loading" | "ready" | "not_ready" | "error";
  onRefresh?: () => void;
}) {
  const t = useT();
  const language = useLanguage();
  if (status === "loading") return <Skeleton height={72} />;
  if (status === "not_ready") {
    return (
      <section className="cockpit-section" aria-label={t("cockpit.operation.title")}>
        <h3 className="cockpit-section-title">{t("cockpit.operation.title")}</h3>
        <p className="cockpit-note" role="status">{t("cockpit.operation.not_ready")}</p>
      </section>
    );
  }
  if (status === "error") {
    return (
      <section className="cockpit-section" aria-label={t("cockpit.operation.title")}>
        <h3 className="cockpit-section-title">{t("cockpit.operation.title")}</h3>
        <p className="cockpit-note error" role="alert">{t("cockpit.operation.read_failed")}</p>
        {onRefresh && <button type="button" className="button button-secondary button-sm" onClick={onRefresh}>{t("cockpit.operation.refresh")}</button>}
      </section>
    );
  }
  if (!operation) {
    return (
      <section className="cockpit-section" aria-label={t("cockpit.operation.title")}>
        <h3 className="cockpit-section-title">{t("cockpit.operation.title")}</h3>
        <p className="cockpit-meta">{t("cockpit.operation.none")}</p>
      </section>
    );
  }
  const applied = operation.state === "applied" || Boolean(operation.runtime_confirmed_at);
  const observed = Boolean(operation.runtime_confirmed_at);
  const failed = operation.state === "rejected" || operation.state === "failed";
  const stages = [
    { label: t("cockpit.operation.decision"), state: "complete" },
    { label: t("cockpit.operation.application"), state: failed ? "failed" : observed ? "complete" : applied ? "complete" : "active" },
    { label: t("cockpit.operation.observation"), state: observed ? "complete" : applied ? "active" : "idle" },
  ];
  const lastUpdate = operation.applied_at ?? operation.runtime_confirmed_at ?? operation.dispatched_at ?? operation.recorded_at;
  const lastUpdateText = lastUpdate ? formatDateTime(lastUpdate, language) : null;
  return (
    <section className="cockpit-section" aria-label={t("cockpit.operation.title")}>
      <h3 className="cockpit-section-title">{t("cockpit.operation.title")}</h3>
      <div className="cockpit-badges">
        <Badge tone={operationTone(operation)}>{operationLabel(operation, t)}</Badge>
        {lastUpdateText && <span className="cockpit-meta">{t("cockpit.as_of", { value: lastUpdateText.zone ? `${lastUpdateText.text} (${lastUpdateText.zone})` : lastUpdateText.text })}</span>}
      </div>
      <ol className="cockpit-stages">
        {stages.map(stage => (
          <li key={stage.label} className="cockpit-stage" data-state={stage.state}>{stage.label}</li>
        ))}
      </ol>
      {(operation.failure_reason || operation.unknown_reason) && (
        <p className={`cockpit-note ${failed ? "error" : ""}`} role="status">{operation.failure_reason || operation.unknown_reason}</p>
      )}
      {operation.state === "unknown" && <p className="cockpit-note" role="status">{t("cockpit.operation.no_retry")}</p>}
      <details className="cockpit-details">
        <summary>{t("cockpit.operation.id", { value: operation.operation_id || t("cockpit.unknown") })}</summary>
        <p className="cockpit-meta">{t("cockpit.operation.request", { value: operation.request_id || t("cockpit.unknown") })}</p>
        {operation.decision_revision !== null && (
          <p className="cockpit-meta">{t("cockpit.operation.revision", { value: operation.decision_revision })}</p>
        )}
      </details>
      {onRefresh && (
        <button type="button" className="button button-secondary button-sm" onClick={onRefresh}>
          {t("cockpit.operation.refresh")}
        </button>
      )}
    </section>
  );
}

/* ---------- pause / recovery ---------- */

export function PauseControl({
  operatingState,
  canPause,
  canResume,
  pending,
  reason,
  onPause,
  onResume,
}: {
  operatingState: string;
  canPause: boolean;
  canResume: boolean;
  pending: boolean;
  reason?: string | null;
  onPause?: () => void;
  onResume?: () => void;
}) {
  const t = useT();
  const stateKey = operatingState === "running" ? "cockpit.pause.running"
    : operatingState === "paused" ? "cockpit.pause.paused" : "cockpit.pause.unknown";
  const blocked = !canPause && !canResume;
  return (
    <section className="cockpit-section" aria-label={t("cockpit.pause.title")}>
      <h3 className="cockpit-section-title">{t("cockpit.pause.title")}</h3>
      <div className="cockpit-badges">
        <Badge tone={operatingState === "running" ? "ok" : operatingState === "paused" ? "warn" : "unknown"}>
          {t(stateKey)}
        </Badge>
      </div>
      <div className="cockpit-toolbar">
        <button
          type="button"
          className="button button-secondary button-sm"
          disabled={pending || !canPause}
          onClick={onPause}
        >
          {t("cockpit.pause.pause")}
        </button>
        <button
          type="button"
          className="button button-secondary button-sm"
          disabled={pending || !canResume}
          onClick={onResume}
        >
          {t("cockpit.pause.resume")}
        </button>
        {pending && <span className="cockpit-meta" role="status">{t("cockpit.pause.pending")}</span>}
      </div>
      {blocked && <p className="cockpit-note">{reason || t("cockpit.pause.unavailable")}</p>}
      <p className="cockpit-note">{t("cockpit.pause.note")}</p>
    </section>
  );
}

/* ---------- activity history ---------- */

export function AuditTimeline({
  events,
  status,
  hasMore = false,
  loadingMore = false,
  onMore,
}: {
  events: AuditEvent[] | null;
  status: "loading" | "ready" | "not_ready" | "error";
  hasMore?: boolean;
  loadingMore?: boolean;
  onMore?: () => void;
}) {
  const t = useT();
  const language = useLanguage();
  if (status === "loading") return <Skeleton height={96} />;
  if (status === "not_ready") return <p className="cockpit-note">{t("cockpit.change_log.unavailable")}</p>;
  if (status === "error") return <p className="cockpit-note error" role="alert">{t("cockpit.change_log.load_failed")}</p>;
  if (!events || events.length === 0) return <p className="cockpit-meta">{t("cockpit.change_log.empty")}</p>;
  return (
    <div className="cockpit-change-log">
      <ol className="cockpit-timeline">
        {events.map(event => {
          const time = formatDateTime(event.occurred_at, language);
          return (
            <li key={event.event_id} className="cockpit-event">
              <time dateTime={event.occurred_at}>{time.zone ? `${time.text} (${time.zone})` : time.text}</time>
              <div className="cockpit-event-body">
                <span className="cockpit-event-action">{event.action.replace(/_/g, " ")}</span>
                <span className="cockpit-meta">
                  {event.actor ? t("cockpit.change_log.actor", { value: event.actor }) : t("cockpit.unknown")}
                  {event.outcome && ` · ${t("cockpit.change_log.outcome", { value: event.outcome })}`}
                </span>
                {event.subject && <span className="cockpit-meta">{t("cockpit.change_log.subject", { value: event.subject })}</span>}
                {event.revision !== null && <span className="cockpit-meta">{t("cockpit.change_log.revision", { value: event.revision })}</span>}
              </div>
            </li>
          );
        })}
      </ol>
      {hasMore && onMore && (
        <button type="button" className="button button-secondary button-sm" disabled={loadingMore} onClick={onMore}>
          {t("cockpit.change_log.more")}
        </button>
      )}
    </div>
  );
}

/* ---------- digest ---------- */

export function DigestStatus({
  digest,
  status = "ready",
  onRetry,
}: {
  digest: DigestStatusData | null;
  status?: "loading" | "ready" | "not_ready" | "error";
  onRetry?: () => void;
}) {
  const t = useT();
  const language = useLanguage();
  if (status === "loading") return <Skeleton height={96} />;
  if (status === "error") {
    return (
      <section className="cockpit-section" aria-label={t("cockpit.digest.title")}>
        <h3 className="cockpit-section-title">{t("cockpit.digest.title")}</h3>
        <p className="cockpit-note error" role="alert">{t("cockpit.digest.read_failed")}</p>
        {onRetry && <button type="button" className="button button-secondary button-sm" onClick={onRetry}>{t("common.retry")}</button>}
      </section>
    );
  }
  if (status === "not_ready" || !digest) {
    return (
      <section className="cockpit-section" aria-label={t("cockpit.digest.title")}>
        <h3 className="cockpit-section-title">{t("cockpit.digest.title")}</h3>
        <p className="cockpit-meta">{t("cockpit.digest.no_data")}</p>
      </section>
    );
  }
  const tone = digest.delivery_state === "delivered" ? "ok"
    : digest.delivery_state === "failed" ? "error"
      : digest.delivery_state === "accepted" ? "warn" : "unknown";
  const accepted = digest.accepted_at ? formatDateTime(digest.accepted_at, language) : null;
  const acknowledged = digest.acknowledged_at ? formatDateTime(digest.acknowledged_at, language) : null;
  const count = (value: number | null) => value === null ? t("cockpit.unknown") : String(value);
  return (
    <section className="cockpit-section" aria-label={t("cockpit.digest.title")}>
      <h3 className="cockpit-section-title">{t("cockpit.digest.title")}</h3>
      <div className="cockpit-badges">
        <Badge tone={tone}>{t(`cockpit.digest.${digest.delivery_state}`)}</Badge>
        {digest.legacy_receipts && <Badge tone="unknown">{t("cockpit.digest.legacy")}</Badge>}
      </div>
      {(digest.business_day || digest.timezone) && (
        <p className="cockpit-meta">
          {t("cockpit.digest.window", {
            day: digest.business_day || t("cockpit.unknown"),
            zone: digest.timezone || t("cockpit.unknown"),
          })}
        </p>
      )}
      <p className="cockpit-meta">
        {t("cockpit.digest.targets", {
          expected: count(digest.expected_targets),
          covered: count(digest.covered_targets),
          unavailable: count(digest.unavailable_targets),
        })}
      </p>
      {accepted && (
        <p className="cockpit-meta">{t("cockpit.digest.accepted_at", { value: accepted.zone ? `${accepted.text} (${accepted.zone})` : accepted.text })}</p>
      )}
      <p className="cockpit-meta">
        {t("cockpit.digest.ack")}: {acknowledged
          ? t("cockpit.digest.ack_at", { value: acknowledged.zone ? `${acknowledged.text} (${acknowledged.zone})` : acknowledged.text })
          : t("cockpit.digest.ack_unknown")}
      </p>
      {digest.targets.length > 0 && (
        <ul className="cockpit-targets">
          {digest.targets.map(target => (
            <li key={target.label}>
              <span>{target.label}</span>
              <span className="cockpit-meta">{target.known ? "✓" : t("cockpit.unknown")}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="cockpit-note">{t("cockpit.digest.note")}</p>
    </section>
  );
}

/* ---------- persistent operation strip ---------- */

export function operationNeedsAttention(operation: OperationRecord | null): boolean {
  if (!operation) return false;
  return operation.state === "pending" || operation.state === "applying" || operation.state === "unknown";
}

export function PersistentOperationStrip({
  operation,
  lastReadAt,
  onView,
  onAcknowledge,
}: {
  operation: OperationRecord;
  lastReadAt: string | null;
  onView: () => void;
  onAcknowledge?: () => void;
}) {
  const t = useT();
  const language = useLanguage();
  const unknown = operation.state === "unknown";
  const readAt = lastReadAt ? formatDateTime(lastReadAt, language) : null;
  return (
    <div className="cockpit-strip" data-state={operation.state} role={unknown ? "alert" : "status"}>
      <span className="cockpit-strip-title">{t("cockpit.strip.title")}</span>
      <span className="cockpit-strip-subject">
        {operation.account_alias || operation.release_id || operation.operation_id}
      </span>
      <Badge tone={unknown ? "error" : "warn"}>{unknown ? t("cockpit.strip.unknown") : operationLabel(operation, t)}</Badge>
      {readAt && <span className="cockpit-meta">{t("cockpit.strip.last_read", { value: readAt.text })}</span>}
      <span className="cockpit-strip-actions">
        <button type="button" className="button button-secondary button-sm" onClick={onView}>{t("cockpit.strip.view")}</button>
        {unknown && onAcknowledge && (
          <button type="button" className="button button-secondary button-sm" onClick={onAcknowledge}>{t("cockpit.strip.ack")}</button>
        )}
      </span>
      <span className="cockpit-meta">{t("cockpit.strip.note")}</span>
    </div>
  );
}

/* ---------- decision card ---------- */

export function DecisionCard({
  decision,
  operation,
  receivedAt,
  blockedReasons = [],
  selected = false,
  onSelect,
}: {
  decision: DecisionDetail;
  operation?: OperationRecord | null;
  receivedAt: string;
  blockedReasons?: string[];
  selected?: boolean;
  onSelect: () => void;
}) {
  const t = useT();
  const title = t(decision.title_key);
  const blocked = blockedReasons.length > 0;
  return (
    <article className={`cockpit-decision${selected ? " selected" : ""}`} data-state={decision.state}>
      <div className="cockpit-badges">
        <Badge tone={decision.category === "reconciliation_recovery" ? "warn" : "accent"}>
          {t(`category.${decision.category}`)}
        </Badge>
        <Badge tone={decision.state === "pending" ? "warn" : decision.state === "approved" ? "ok" : "unknown"}>
          {t(`cockpit.decision.state.${decision.state}`)}
        </Badge>
        {blocked && <Badge tone="error">{t("cockpit.decision.blocked")}</Badge>}
      </div>
      <h3 className="cockpit-decision-title">{title === decision.title_key ? decision.short_id : title}</h3>
      <dl className="cockpit-kv">
        {decision.account_alias && (
          <div className="cockpit-kv-pair">
            <dt>{t("cockpit.decision.target")}</dt>
            <dd>{decision.account_alias}{decision.platform ? ` · ${decision.platform}` : ""}</dd>
          </div>
        )}
        {decision.release_id && (
          <div className="cockpit-kv-pair">
            <dt>{t("cockpit.decision.release")}</dt>
            <dd>{decision.release_id}</dd>
          </div>
        )}
        {decision.policy && (
          <div className="cockpit-kv-pair">
            <dt>{t("cockpit.decision.tier")}</dt>
            <dd>
              {tierLabel(decision.policy.selected_tier, t)}
              {decision.policy.policy_revision && <span className="cockpit-meta"> · {t("cockpit.policy.revision", { value: decision.policy.policy_revision })}</span>}
            </dd>
          </div>
        )}
        {operation && (
          <div className="cockpit-kv-pair">
            <dt>{t("cockpit.decision.operation")}</dt>
            <dd>{operationLabel(operation, t)}</dd>
          </div>
        )}
      </dl>
      {decision.evidence && (
        <div className="cockpit-decision-support">
          <span className="cockpit-meta">{t("cockpit.decision.qualification")}:</span>
          <FreshnessBadge state={decision.evidence.state} />
          <Badge tone={decision.evidence.qualification === "qualified" ? "ok" : decision.evidence.qualification === "unqualified" ? "error" : "unknown"}>
            {decision.evidence.qualification === "qualified"
              ? decision.evidence.limitations.length > 0 ? t("cockpit.support.qualified_limited") : t("cockpit.support.qualified")
              : decision.evidence.qualification === "unqualified" ? t("cockpit.support.unqualified") : t("cockpit.support.unknown")}
          </Badge>
        </div>
      )}
      {blocked && (
        <ul className="cockpit-blockers" aria-label={t("cockpit.decision.blocked")}>
          {blockedReasons.map(reason => <li key={reason}>{blockerLabel(reason, t)}</li>)}
        </ul>
      )}
      <ExpiryIndicator expiresAt={decision.expires_at} serverTime={decision.server_time} receivedAt={receivedAt} showConsequence={false} />
      <p className="cockpit-note">{t("cockpit.decision.no_action")}</p>
      <button type="button" className="button button-primary button-sm" onClick={onSelect}>
        {t("cockpit.decision.review")}
      </button>
    </article>
  );
}
