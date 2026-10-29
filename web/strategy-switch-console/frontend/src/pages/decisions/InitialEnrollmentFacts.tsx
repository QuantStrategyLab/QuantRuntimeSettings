import { useLanguage, useT, type Translate } from "../../i18n";
import { Badge } from "../../components/primitives";
import { formatDateTime } from "../../lib/format";
import type {
  InitialEnrollmentFactValue as ContractFactValue,
  InitialEnrollmentFactsData as ContractFactsData,
  InitialEnrollmentScope as ContractScope,
  InitialEnrollmentSurface as ContractSurface,
  InitialEnrollmentSurfaceName as ContractSurfaceName,
  InitialEnrollmentSurfaceStatus as ContractSurfaceStatus,
} from "../../api/contracts";

/**
 * Display-only first-enrollment facts for the existing decision card. The
 * caller passes verified account/strategy display labels and binds the exact
 * reviewed v3 candidate/facts; the existing confirmation flow stays outside
 * this component. It performs no reads, writes or checks.
 */

export type InitialEnrollmentSurfaceName = ContractSurfaceName;
export type InitialEnrollmentSurfaceStatus = ContractSurfaceStatus;
/** Synthetic facts arrive as strings, nulls and nested objects; numbers and
 * currency values stay strings and are rendered verbatim. */
export type InitialEnrollmentFactValue = ContractFactValue;
export type InitialEnrollmentSurface = ContractSurface;
export type InitialEnrollmentFactsData = ContractFactsData;
export type InitialEnrollmentScope = ContractScope;

const SURFACE_NAMES: InitialEnrollmentSurfaceName[] = [
  "positions",
  "cash",
  "open_orders",
  "recent_executions",
  "local_execution_ledger",
];

const STATUS_TONE: Record<InitialEnrollmentSurfaceStatus, "ok" | "warn" | "unknown"> = {
  complete: "ok",
  partial: "warn",
  unknown: "unknown",
};

const SCOPE_FIELDS = [
  "kind",
  "currency",
  "window_start",
  "window_end",
  "limit_per_namespace",
  "gateway_availability",
  "truncated",
] as const;
type ScopeField = (typeof SCOPE_FIELDS)[number];

interface DisplayScope extends InitialEnrollmentScope {
  provided: boolean;
}

interface DisplaySurface {
  status: InitialEnrollmentSurfaceStatus;
  items: readonly InitialEnrollmentFactValue[] | null;
  scope: DisplayScope;
}

const recordValue = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

/** Read a scope as text or null; malformed and missing values are never invented. */
function displayScope(scope: unknown): DisplayScope {
  const record = recordValue(scope) ? scope : null;
  const text = (field: ScopeField): string | null => {
    const value = record?.[field];
    return typeof value === "string" ? value : null;
  };
  return {
    provided: record !== null,
    kind: text("kind"),
    currency: text("currency"),
    window_start: text("window_start"),
    window_end: text("window_end"),
    limit_per_namespace: text("limit_per_namespace"),
    gateway_availability: text("gateway_availability"),
    truncated: text("truncated"),
  };
}

/** A missing, unknown or malformed surface never becomes known-empty. */
function displaySurface(raw: unknown): DisplaySurface {
  const surface: InitialEnrollmentSurface | null = recordValue(raw) ? raw as unknown as InitialEnrollmentSurface : null;
  const scope = displayScope(surface ? surface.scope : null);
  if (!surface) return { status: "unknown", items: null, scope };
  if (surface.status === "complete" && Array.isArray(surface.items)) {
    return { status: "complete", items: surface.items, scope };
  }
  if (surface.status === "partial") {
    return { status: "partial", items: Array.isArray(surface.items) ? surface.items : null, scope };
  }
  return { status: "unknown", items: null, scope };
}

function humanizeKey(key: string): string {
  const text = key.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  return text || key;
}

/** Known source fields have locale copy; an unknown source field is only
 * humanized, never rendered as a JSON fragment. */
function factLabel(key: string, t: Translate): string {
  const messageKey = `initial_enrollment.fact.${key}`;
  const translated = t(messageKey);
  return translated === messageKey ? humanizeKey(key) : translated;
}

function scopeValue(field: ScopeField, value: string | null, t: Translate): string {
  if (value === null || value === "") return t("common.unknown");
  if (field === "truncated") {
    if (value === "true") return t("initial_enrollment.value.true");
    if (value === "false") return t("initial_enrollment.value.false");
  }
  if (field === "gateway_availability" && value === "current_broker_day") return t("initial_enrollment.current_broker_day");
  if (field === "kind") {
    const messageKey = `initial_enrollment.scope_kind.${value}`;
    const translated = t(messageKey);
    if (translated !== messageKey) return translated;
  }
  return value;
}

function FactValue({ value, t }: { value: InitialEnrollmentFactValue; t: Translate }) {
  if (value === null) return <>{t("common.unknown")}</>;
  if (typeof value === "string") return <>{value || t("common.na")}</>;
  if (typeof value === "number") {
    return <>{Number.isFinite(value) ? String(value) : t("common.unknown")}</>;
  }
  if (typeof value === "boolean") {
    return <>{t(value ? "initial_enrollment.value.true" : "initial_enrollment.value.false")}</>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <>{t("common.na")}</>;
    return (
      <ul className="initial-enrollment-list">
        {value.map((nested, index) => (
          <li key={index}><FactValue value={nested} t={t} /></li>
        ))}
      </ul>
    );
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return <>{t("common.na")}</>;
  return (
    <dl className="initial-enrollment-fields">
      {entries.map(([key, nested]) => (
        <div key={key}>
          <dt>{factLabel(key, t)}</dt>
          <dd><FactValue value={nested} t={t} /></dd>
        </div>
      ))}
    </dl>
  );
}

function Scope({ scope, t }: { scope: DisplayScope; t: Translate }) {
  const fields = SCOPE_FIELDS.filter(field => scope[field] !== null && scope[field] !== "");
  if (!scope.provided || !fields.length) return null;
  return (
    <details className="initial-enrollment-scope-block">
      <summary>{t("initial_enrollment.scope")}</summary>
      <dl className="initial-enrollment-scope">
        {fields.map(field => (
          <div key={field} data-scope-field={field}>
            <dt>{t(`initial_enrollment.scope_field.${field}`)}</dt>
            <dd>{scopeValue(field, scope[field], t)}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function SurfaceBody({ surface, t }: { surface: DisplaySurface; t: Translate }) {
  if (surface.status === "unknown") {
    return <p className="decision-note" data-state="unknown">{t("common.unknown")}</p>;
  }
  const items = surface.items;
  if (items === null) {
    return <p className="decision-note" data-state="unavailable">{t("initial_enrollment.partial_unavailable")}</p>;
  }
  if (items.length === 0) {
    return (
      <p
        className="decision-note"
        data-state={surface.status === "complete" ? "known_empty" : "partial_unavailable"}
      >
        {surface.status === "complete" ? t("initial_enrollment.known_empty") : t("initial_enrollment.partial_unavailable")}
      </p>
    );
  }
  return (
    <>
      {surface.status === "partial" && (
        <p className="decision-note">{t("initial_enrollment.partial_notice")}</p>
      )}
      <div className="initial-enrollment-items" data-item-count={items.length}>
        {items.map((item, index) => (
          <div key={index} className="initial-enrollment-item">
            <FactValue value={item} t={t} />
          </div>
        ))}
      </div>
    </>
  );
}

export function InitialEnrollmentFacts({
  account,
  strategy,
  platform,
  facts,
  readiness,
  blockerCodes,
}: {
  account?: string | null;
  strategy?: string | null;
  platform?: string | null;
  facts: InitialEnrollmentFactsData | null;
  readiness?: string | null;
  blockerCodes?: readonly string[] | null;
}) {
  const t = useT();
  const language = useLanguage();
  const data: ContractFactsData | null = recordValue(facts) ? facts : null;
  const rawObservedAt = data?.observed_at;
  const observedAt = typeof rawObservedAt === "string" && Number.isFinite(Date.parse(rawObservedAt))
    ? rawObservedAt
    : null;
  const observed = observedAt ? formatDateTime(observedAt, language) : null;
  const surfaces: Partial<Record<InitialEnrollmentSurfaceName, InitialEnrollmentSurface>> | null =
    data && recordValue(data.surfaces) ? data.surfaces : null;
  const blocked = readiness === "blocked" || Boolean(blockerCodes?.length);
  const blockedSurfaces = (blockerCodes || [])
    .map(code => /^initial_enrollment_(.+)_incomplete$/.exec(code)?.[1])
    .filter((name): name is InitialEnrollmentSurfaceName =>
      Boolean(name && (SURFACE_NAMES as readonly string[]).includes(name)));
  return (
    <section
      className="initial-enrollment-facts"
      aria-label={t("initial_enrollment.title")}
      data-material="initial_enrollment"
      data-readiness={readiness ?? undefined}
    >
      <h2 className="card-title">{t("initial_enrollment.title")}</h2>
      <div className="decision-meta">
        <span>{t("common.account")}: {account || t("common.unknown")}</span>
        <span>{t("common.strategy")}: {strategy || t("common.unknown")}</span>
        {platform && <span>{t("common.platform")}: {platform}</span>}
        <span>
          {t("initial_enrollment.source_time")}:{" "}
          {observedAt && observed ? (
            <time dateTime={observedAt}>{observed.zone ? `${observed.text} (${observed.zone})` : observed.text}</time>
          ) : (
            t("common.unknown")
          )}
        </span>
      </div>
      <p className="decision-note">{t("initial_enrollment.notice")}</p>
      {blocked && (
        <p className="decision-note initial-enrollment-blocked" role="status" data-state="blocked">
          {t("initial_enrollment.blocked")}
          {blockedSurfaces.length > 0
            ? ` ${blockedSurfaces.map(name => t(`initial_enrollment.surface.${name}`)).join(" / ")}`
            : ""}
        </p>
      )}
      <div className="initial-enrollment-surfaces">
        {SURFACE_NAMES.map(name => {
          const surface = displaySurface(surfaces?.[name]);
          return (
            <section
              key={name}
              className="initial-enrollment-surface"
              data-surface={name}
              data-status={surface.status}
            >
              <h3 className="initial-enrollment-surface-title">
                {t(`initial_enrollment.surface.${name}`)}{" "}
                <Badge tone={STATUS_TONE[surface.status]}>{t(`initial_enrollment.status.${surface.status}`)}</Badge>
              </h3>
              <SurfaceBody surface={surface} t={t} />
              <Scope scope={surface.scope} t={t} />
            </section>
          );
        })}
      </div>
    </section>
  );
}
