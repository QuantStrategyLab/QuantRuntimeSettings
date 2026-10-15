import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Category, DecisionHistoryItem, InboxItem } from "../../api/contracts";
import { AccessError, HttpError, getJson, postJson } from "../../api/client";
import { loadDecisionHistory, loadInbox, loadSession } from "../../api/endpoints";
import {
  createHumanDecisionController,
  createRequestLock,
  humanDecisionExpectation,
  ownerDecisionBinding,
  recoveryBinding,
  type HumanDecisionKind,
} from "../../operations";
import { paperApplicationReady } from "../../presentation";
import { createRequestGate, useApi } from "../../lib/hooks";
import { formatDateTime, relativeFreshness } from "../../lib/format";
import { useLanguage, useT } from "../../i18n";
import { useNavigate } from "../../app/context";
import {
  AsOfStamp,
  Badge,
  EmptyState,
  Skeleton,
} from "../../components/primitives";
import { Tabs } from "../../components/Tabs";
import { DiffTable } from "../../components/DiffTable";
import { Timeline } from "../../components/Timeline";
import { ConfirmationDialog, useConfirmation } from "../../components/Dialog";
import { useToast } from "../../components/Toast";
import "./decisions.css";

type View = "pending" | "decided";
type CategoryFilter = "all" | Category;
type Action = "adopt" | "decline";

interface AccountChoice {
  id: string;
  platform: string;
  key: string;
  label: string;
  mode: string;
}

const CATEGORY_TABS: Category[] = [
  "reconciliation_recovery",
  "strategy_promotion",
  "owner_decision",
  "paper_account_application",
  "credential_maintenance",
];

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, normal: 2 };

function subjectIdOf(item: InboxItem): string {
  const binding = item.decision_binding;
  if (binding && typeof binding.subject_id === "string" && binding.subject_id) return binding.subject_id;
  const index = item.id.indexOf(":");
  return index >= 0 ? item.id.slice(index + 1) : item.id;
}

function isExpired(item: InboxItem): boolean {
  if (item.status === "expired") return true;
  const expires = item.expires_at ? Date.parse(item.expires_at) : NaN;
  return Number.isFinite(expires) && expires < Date.now();
}

/** Recovery first, then priority, then newest. */
function sortInbox(items: InboxItem[]): InboxItem[] {
  return [...items].sort((a, b) => {
    const recovery = Number(b.category === "reconciliation_recovery") - Number(a.category === "reconciliation_recovery");
    if (recovery !== 0) return recovery;
    const rank = (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3);
    if (rank !== 0) return rank;
    return (b.created_at || "").localeCompare(a.created_at || "");
  });
}

function accountOptionsOf(application: Record<string, any> | null | undefined, paperOnly: boolean): AccountChoice[] {
  const options = application?.application_preparation?.account_options;
  if (!Array.isArray(options)) return [];
  return options
    .filter(account => {
      if (!account || typeof account.platform !== "string" || typeof account.key !== "string" || !account.key.trim()) return false;
      const mode = account.broker_environment;
      if (paperOnly) return account.platform === "longbridge" && mode === "paper";
      return mode === "live" || (mode === "paper" && account.platform === "longbridge");
    })
    .map(account => ({
      id: `${account.platform}:${account.key}`,
      platform: String(account.platform),
      key: String(account.key),
      label: typeof account.label === "string" && account.label.trim() ? account.label : String(account.key),
      mode: String(account.broker_environment || ""),
    }));
}

function freshnessKey(status: string | null | undefined): string {
  if (status === "fresh") return "state.fresh";
  if (status === "stale") return "state.stale";
  if (status === "ready") return "decisions.freshness.ready";
  if (status === "unavailable") return "state.unavailable";
  return "state.unknown";
}

/* ---------- read-failed block (never an empty inbox) ---------- */

function InboxReadFailed({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <div className="error-state" role="alert">
      <div className="error-title">{t("state.read_failed")}</div>
      <div>{t("decisions.read_failed")}</div>
      <div style={{ marginTop: 12 }}>
        <button type="button" className="button button-secondary" onClick={onRetry}>{t("common.retry")}</button>
      </div>
    </div>
  );
}

/* ---------- decided history (read-only timeline, paginated) ---------- */

function HistoryPanel({ epoch, category }: { epoch: number; category: CategoryFilter }) {
  const t = useT();
  const language = useLanguage();
  const [items, setItems] = useState<DecisionHistoryItem[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const gate = useRef(createRequestGate());

  const loadFirst = useCallback(() => {
    const token = gate.current.begin();
    setItems(null);
    setFailed(false);
    setCursor(null);
    loadDecisionHistory(25)
      .then(page => {
        if (!gate.current.isCurrent(token)) return;
        setItems(page.items);
        setCursor(page.next_cursor);
      })
      .catch(() => {
        if (!gate.current.isCurrent(token)) return;
        setFailed(true);
      });
  }, []);

  useEffect(() => loadFirst(), [loadFirst, epoch]);

  const loadMore = () => {
    if (!cursor || loadingMore) return;
    const token = gate.current.begin();
    setLoadingMore(true);
    loadDecisionHistory(25, cursor)
      .then(page => {
        if (!gate.current.isCurrent(token)) return;
        setItems(current => [...(current || []), ...page.items]);
        setCursor(page.next_cursor);
      })
      .catch(() => {
        if (gate.current.isCurrent(token)) setFailed(true);
      })
      .finally(() => {
        if (gate.current.isCurrent(token)) setLoadingMore(false);
      });
  };

  if (failed && !items?.length) return <InboxReadFailed onRetry={loadFirst} />;
  if (!items) {
    return (
      <div className="card">
        <Skeleton height={56} />
        <div style={{ height: 8 }} />
        <Skeleton height={56} />
      </div>
    );
  }
  const visible = category === "all" ? items : items.filter(item => item.category === category);
  if (visible.length === 0) return <EmptyState title={t("decisions.history.empty")} />;
  return (
    <div className="card">
      <h2 className="card-title">{t("decisions.history_title")}</h2>
      <Timeline
        items={visible.map(item => ({
          id: item.id,
          time: item.time,
          title: (
            <>
              {item.actor_alias || t("common.unknown")} · {t(`decisions.action.${item.action}`)}
            </>
          ),
          detail: (
            <>
              {t(`category.${item.category}`)} · {t("decisions.ref", { id: item.item_short_id })} · {formatDateTime(item.time, language).text}
            </>
          ),
        }))}
      />
      {cursor && (
        <div className="decision-history-more">
          <button type="button" className="button button-secondary" disabled={loadingMore} onClick={loadMore}>
            {loadingMore ? t("common.loading") : t("common.load_more")}
          </button>
        </div>
      )}
      {failed && <p className="decision-note">{t("error.generic")}</p>}
    </div>
  );
}

/* ---------- page ---------- */

export default function DecisionsPage() {
  const t = useT();
  const language = useLanguage();
  const navigate = useNavigate();
  const toast = useToast();
  const { confirmRequest, confirm, resolveConfirm } = useConfirmation();

  const [category, setCategory] = useState<CategoryFilter>("all");
  const [view, setView] = useState<View>("pending");
  const [epoch, setEpoch] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [accountChoice, setAccountChoice] = useState<Record<string, string>>({});

  const inbox = useApi(() => loadInbox(), [epoch]);
  const session = useApi(() => loadSession(), []);
  const admin = session.phase === "ready" && session.data.admin === true;

  const humanDecisions = useRef(createHumanDecisionController());
  const applyLocks = useRef(createRequestLock());

  const refresh = useCallback(() => setEpoch(value => value + 1), []);

  const items = useMemo(() => (inbox.phase === "ready" && inbox.data.status !== "read_failed" ? inbox.data.items : []), [inbox]);
  const pendingItems = useMemo(() => sortInbox(items.filter(item => item.status === "pending" || item.status === "expired")), [items]);
  const pendingCount = useMemo(() => items.filter(item => item.status === "pending").length, [items]);
  const visibleItems = useMemo(
    () => (category === "all" ? pendingItems : pendingItems.filter(item => item.category === category)),
    [pendingItems, category],
  );

  const selected = visibleItems.find(item => item.id === selectedId) || visibleItems[0] || null;

  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
  }, [selected, selectedId]);

  // Account options for promotion categories come from the legacy ticket payload.
  const needsPromotions = Boolean(
    selected && selected.status === "pending" && !isExpired(selected)
      && (selected.category === "strategy_promotion" || selected.category === "paper_account_application"),
  );
  const promotions = useApi(
    () => (needsPromotions ? getJson<Record<string, any>>("/api/research-promotion-tickets") : Promise.resolve(null)),
    [needsPromotions, selected?.id, epoch],
  );
  const selectedApplication = useMemo(() => {
    if (!selected || promotions.phase !== "ready" || !promotions.data) return null;
    const applications = (promotions.data as Record<string, any>).applications;
    if (!Array.isArray(applications)) return null;
    return applications.find(entry => entry?.ticket_id === subjectIdOf(selected)) || null;
  }, [selected, promotions]);

  const notice = (kind: "info" | "success" | "error", key: string) => toast({ kind, text: t(key) });

  const intentError = (error: unknown) => {
    if (error instanceof AccessError) return;
    notice("error", error instanceof HttpError && error.status === 409 ? "error.conflict" : "error.generic");
    // A failed response cannot prove the write did not commit; re-read the inbox.
    refresh();
  };

  /** Shared legacy write path: fresh source read → legacy binding → expectation readback → POST with expected_material_sha256. */
  const recordIntent = async (item: InboxItem, action: Action, choiceId: string | null) => {
    const subject = subjectIdOf(item);
    const kind: HumanDecisionKind =
      item.category === "owner_decision" ? "owner" : item.category === "reconciliation_recovery" ? "recovery" : "promotion";
    let source: Record<string, any>;
    let body: Record<string, unknown>;
    let path: string;
    try {
      if (kind === "owner") {
        const payload = await getJson<Record<string, any>>("/api/owner-decisions");
        const entry = (payload.candidates || []).find((candidate: any) => candidate?.candidate?.candidate_id === subject);
        if (!entry) {
          notice("info", "decisions.intent_not_pending");
          refresh();
          return;
        }
        const binding = ownerDecisionBinding(
          { ...entry.candidate, candidate_evidence_sha256: entry.candidate_evidence_sha256 },
          action === "adopt" ? "approve_limited_live_canary" : "keep_parked",
        );
        if (!binding) {
          notice(entry.intent ? "info" : "error", entry.intent ? "decisions.intent_not_pending" : "decisions.intent_unavailable");
          refresh();
          return;
        }
        source = entry;
        body = binding;
        path = "/api/owner-decisions";
      } else if (kind === "recovery") {
        const payload = await getJson<Record<string, any>>("/api/reconciliation-recovery");
        const entry = (payload.recoveries || []).find((candidate: any) => candidate?.recovery?.recovery_id === subject);
        if (!entry) {
          notice("info", "decisions.intent_not_pending");
          refresh();
          return;
        }
        const binding = recoveryBinding(entry, action === "adopt" ? "approve" : "reject");
        if (!binding) {
          const decided = Boolean(entry.confirmation || entry.rejection);
          notice(decided ? "info" : "error", decided ? "decisions.intent_not_pending" : "decisions.intent_unavailable");
          refresh();
          return;
        }
        source = entry;
        body = binding;
        path = "/api/reconciliation-recovery-confirmations";
      } else {
        const payload = await getJson<Record<string, any>>("/api/research-promotion-tickets");
        const ticket = (payload.tickets || []).find((entry: any) => entry?.ticket_id === subject);
        if (!ticket) {
          notice("info", "decisions.intent_not_pending");
          refresh();
          return;
        }
        let account: AccountChoice | null = null;
        if (action === "adopt") {
          const application = (payload.applications || []).find((entry: any) => entry?.ticket_id === subject);
          const options = accountOptionsOf(application, false);
          const resolved = options.length === 1 ? options[0] : options.find(option => option.id === choiceId);
          if (!resolved) {
            notice("error", "decisions.intent_unavailable");
            return;
          }
          account = resolved;
        }
        source = ticket;
        body = {
          ticket_id: ticket.ticket_id,
          decision: action === "adopt" ? "accept" : "reject",
          confirmation: account ? { target_platform: account.platform, execution_mode: account.mode, risk_profile: "CAPITAL_PRESERVATION" } : null,
          ...(account ? { selected_account: { platform: account.platform, key: account.key } } : {}),
          expected_proposed_params: ticket.proposed_params || {},
          expected_strategy_profile: ticket.strategy_profile,
          expected_domain: ticket.domain,
        };
        path = "/api/research-promotion-decisions";
      }
    } catch (error) {
      intentError(error);
      return;
    }

    const sessionEpoch = humanDecisions.current.epoch();
    const expected = await humanDecisionExpectation(kind, source, body);
    if (sessionEpoch !== humanDecisions.current.epoch()) return;
    if (!expected) {
      notice("error", "decisions.intent_unavailable");
      return;
    }
    const op = humanDecisions.current.start(expected);
    if (!op) return; // same decision already in flight
    const busyKey = `intent:${item.id}`;
    setBusy(current => ({ ...current, [busyKey]: true }));
    try {
      const result = await postJson<Record<string, any>>(path, {
        ...body,
        expected_material_sha256: expected.material_sha256,
        ...(expected.review_sha256 ? { expected_review_sha256: expected.review_sha256 } : {}),
      });
      if (!humanDecisions.current.current(op)) return;
      const recorded = await humanDecisions.current.receive(op, result?.decision_receipt);
      notice(recorded ? "success" : "error", recorded ? "decisions.intent_recorded" : "error.generic");
      refresh();
    } catch (error) {
      intentError(error);
    } finally {
      if (humanDecisions.current.current(op)) setBusy(current => ({ ...current, [busyKey]: false }));
    }
  };

  /** Paper application adopt: POST /api/research-promotion-applications with a fresh revision read. */
  const applyPaper = async (item: InboxItem, choiceId: string) => {
    const subject = subjectIdOf(item);
    const lockKey = `apply:${subject}`;
    if (!applyLocks.current.acquire(lockKey)) return;
    setBusy(current => ({ ...current, [lockKey]: true }));
    let submitted = false;
    try {
      const payload = await getJson<Record<string, any>>("/api/research-promotion-tickets");
      const application = (payload.applications || []).find((entry: any) => entry?.ticket_id === subject);
      const selectedOption = accountOptionsOf(application, true).find(option => option.id === choiceId);
      if (!application || !selectedOption || !paperApplicationReady(application, choiceId)) {
        notice("error", "decisions.intent_unavailable");
        return;
      }
      const instances = await getJson<Record<string, any>>("/api/admin/runtime-instances");
      submitted = true;
      await postJson("/api/research-promotion-applications", {
        ticket_id: subject,
        selected_account: { platform: selectedOption.platform, key: selectedOption.key },
        expected_revision: Number(instances.revision),
      });
      notice("success", "decisions.application_submitted");
      refresh();
    } catch (error) {
      intentError(error);
    } finally {
      setBusy(current => ({ ...current, [lockKey]: false }));
      // Keep the lock once the request may have reached the server; a refresh decides what happens next.
      if (!submitted) applyLocks.current.release(lockKey);
    }
  };

  const onDecide = async (item: InboxItem, action: Action) => {
    const paperAdopt = item.category === "paper_account_application" && action === "adopt";
    const choiceId = accountChoice[item.id] || null;
    if (paperAdopt && !choiceId) return;
    const confirmed = await confirm({
      title: t(action === "adopt" ? "decisions.confirm_adopt_title" : "decisions.confirm_decline_title"),
      target: itemTitle(item, t),
      summary: t(paperAdopt ? "decisions.apply_note" : "decisions.confirm_body"),
      consequence: t("decisions.intent_note"),
      tone: action === "adopt" ? "normal" : "danger",
      confirmLabel: t(action === "adopt" ? "decisions.confirm_adopt_label" : "decisions.confirm_decline_label"),
    });
    if (!confirmed) return;
    if (paperAdopt && choiceId) await applyPaper(item, choiceId);
    else await recordIntent(item, action, choiceId);
  };

  function itemTitle(item: InboxItem, translate: ReturnType<typeof useT>): string {
    const translated = translate(item.title_key);
    return translated === item.title_key ? item.short_id : translated;
  }

  /* ---------- render ---------- */

  const categoryTabs = [
    { id: "all" as const, label: t("decisions.filter.all") },
    ...CATEGORY_TABS.map(id => ({ id, label: t(`category.${id}`) })),
  ];

  const renderDetail = () => {
    if (!selected) return null;
    const item = selected;
    const expired = isExpired(item);
    const pending = item.status === "pending" && !expired;
    const diffRows = item.diff.map(row => {
      const label = t(row.label_key);
      return { field: row.field, label: label === row.label_key ? row.field : label, before: row.before, after: row.after, affectsLive: row.affects_live };
    });
    const busyIntent = Boolean(busy[`intent:${item.id}`]);
    const busyApply = Boolean(busy[`apply:${subjectIdOf(item)}`]);
    const anyBusy = busyIntent || busyApply;

    let actions: ReactNode = null;
    if (pending && admin) {
      if (item.category === "credential_maintenance") {
        actions = (
          <button type="button" className="button button-secondary" onClick={() => navigate({ page: "health" })}>
            {t("decisions.open_health")}
          </button>
        );
      } else if (item.category === "paper_account_application") {
        const options = accountOptionsOf(selectedApplication, true);
        const chosen = options.some(option => option.id === accountChoice[item.id])
          ? accountChoice[item.id]
          : options.length === 1
            ? options[0].id
            : "";
        const uncertain = item.application_status === "uncertain";
        const ready = Boolean(chosen && selectedApplication && paperApplicationReady(selectedApplication, chosen));
        actions = (
          <>
            {options.length > 1 && (
              <label className="decision-account-picker">
                <span>{t("decisions.select_account")}</span>
                <select
                  value={chosen}
                  onChange={event => setAccountChoice(current => ({ ...current, [item.id]: event.target.value }))}
                >
                  <option value="">{t("decisions.select_account")}…</option>
                  {options.map(option => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </label>
            )}
            <div className="inbox-actions">
              {uncertain ? (
                <p className="decision-note">{t("decisions.application_uncertain")}</p>
              ) : (
                <>
                  {options.length === 0 ? (
                    <p className="decision-note">{t("decisions.no_account_options")}</p>
                  ) : (
                    <button
                      type="button"
                      className="button button-primary"
                      disabled={anyBusy || !ready || applyLocks.current.isLocked(`apply:${subjectIdOf(item)}`)}
                      onClick={() => void onDecide(item, "adopt")}
                    >
                      {busyApply ? t("decisions.submitting") : t("decisions.adopt_intent")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={anyBusy}
                    onClick={() => void onDecide(item, "decline")}
                  >
                    {busyIntent ? t("decisions.submitting") : t("decisions.decline_intent")}
                  </button>
                </>
              )}
              <p className="decision-note">{t(options.length === 0 || uncertain ? "decisions.intent_note" : "decisions.apply_note")}</p>
            </div>
          </>
        );
      } else {
        const options = item.category === "strategy_promotion" ? accountOptionsOf(selectedApplication, false) : [];
        const chosen = options.some(option => option.id === accountChoice[item.id])
          ? accountChoice[item.id]
          : options.length === 1
            ? options[0].id
            : "";
        actions = (
          <>
            {options.length > 1 && (
              <label className="decision-account-picker">
                <span>{t("decisions.select_account")}</span>
                <select
                  value={chosen}
                  onChange={event => setAccountChoice(current => ({ ...current, [item.id]: event.target.value }))}
                >
                  <option value="">{t("decisions.select_account")}…</option>
                  {options.map(option => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </label>
            )}
            <div className="inbox-actions">
              <button
                type="button"
                className="button button-primary"
                disabled={anyBusy || (item.category === "strategy_promotion" && options.length > 1 && !chosen)}
                onClick={() => void onDecide(item, "adopt")}
              >
                {busyIntent ? t("decisions.submitting") : t("decisions.adopt_intent")}
              </button>
              <button
                type="button"
                className="button button-secondary"
                disabled={anyBusy}
                onClick={() => void onDecide(item, "decline")}
              >
                {busyIntent ? t("decisions.submitting") : t("decisions.decline_intent")}
              </button>
              <p className="decision-note">{t("decisions.intent_note")}</p>
            </div>
          </>
        );
      }
    }

    return (
      <div className="card inbox-detail">
        <div className="decision-detail-head">
          <div className="decision-badges">
            <Badge tone={item.category === "reconciliation_recovery" ? "warn" : "accent"}>
              {t(`category.${item.category}`)}
            </Badge>
            <Badge tone={item.status === "decided" ? "ok" : expired ? "unknown" : "warn"}>
              {t(`decisions.status.${expired ? "expired" : item.status}`)}
            </Badge>
            {item.affects_live && <Badge tone="warn">{t("decisions.col.affects_live")}</Badge>}
          </div>
          <h2 className="card-title" style={{ margin: 0 }}>{itemTitle(item, t)}</h2>
          <p className="decision-prompt">{t(`decisions.prompt.${item.category}`)}</p>
          <div className="decision-meta">
            <span>{item.account_alias || t("decisions.account_global")}</span>
            {item.platform && <span>{item.platform}</span>}
            {item.created_at && (
              <span>{t("decisions.created_at", { value: formatDateTime(item.created_at, language).text })}</span>
            )}
            {item.expires_at && (
              <span>{t("decisions.expires_at", { value: formatDateTime(item.expires_at, language).text })}</span>
            )}
          </div>
        </div>
        {diffRows.length > 0 && (
          <>
            <h3 className="decision-section-title">{t("decisions.diff_title")}</h3>
            <DiffTable rows={diffRows} />
          </>
        )}
        <details className="decision-materials">
          <summary>{t("decisions.materials")}</summary>
          <p>{t("decisions.ref", { id: item.short_id })}</p>
          <p>{t("decisions.material_freshness", { value: t(freshnessKey(item.evidence_freshness?.status)) })}</p>
          {item.evidence_freshness?.as_of && <AsOfStamp value={item.evidence_freshness.as_of} />}
        </details>
        {actions}
      </div>
    );
  };

  const renderPending = () => {
    if (inbox.phase === "loading") {
      return (
        <div className="inbox">
          <div className="inbox-list">
            <Skeleton height={64} />
            <Skeleton height={64} />
            <Skeleton height={64} />
          </div>
          <Skeleton height={280} />
        </div>
      );
    }
    if (inbox.phase === "error" || inbox.data.status === "read_failed") {
      return <InboxReadFailed onRetry={inbox.phase === "error" ? inbox.reload : refresh} />;
    }
    const degraded = inbox.data.sources.filter(source => source.status !== "ok");
    return (
      <>
        {degraded.length > 0 && (
          <p className="decision-note" role="status">
            {t("decisions.partial_sources", {
              value: degraded.map(source => t(`decisions.source.${source.source}`)).join(language === "zh" ? "、" : ", "),
            })}
          </p>
        )}
        {visibleItems.length === 0 ? (
          <EmptyState title={t("decisions.empty_pending")} />
        ) : (
          <div className="inbox">
            <div className="inbox-list" role="list">
              {visibleItems.map(item => {
                const expired = isExpired(item);
                const fresh = relativeFreshness(item.created_at, language);
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="listitem"
                    className={`inbox-item${selected?.id === item.id ? " active" : ""}${expired ? " is-expired" : ""}`}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <span className={`priority-dot priority-${item.priority}`} aria-hidden="true" />
                    <span className="item-main">
                      <span className="item-title">{itemTitle(item, t)}</span>
                      <span className="item-meta">
                        {item.category === "reconciliation_recovery" && (
                          <Badge tone="warn">{t("category.reconciliation_recovery")}</Badge>
                        )}
                        <span>{item.account_alias || t("decisions.account_global")}</span>
                        {fresh && <span>{fresh}</span>}
                      </span>
                    </span>
                    <Badge tone={expired ? "unknown" : "warn"}>
                      {t(`decisions.status.${expired ? "expired" : item.status}`)}
                    </Badge>
                  </button>
                );
              })}
            </div>
            {renderDetail() || (
              <div className="card inbox-detail">
                <EmptyState title={t("decisions.select_prompt")} />
              </div>
            )}
          </div>
        )}
      </>
    );
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">{t("decisions.title")}</h1>
        <button type="button" className="button button-secondary decision-refresh" onClick={refresh}>
          {t("common.refresh")}
        </button>
      </div>
      <div className="decisions-filters">
        <Tabs items={categoryTabs} active={category} onChange={id => setCategory(id as CategoryFilter)} ariaLabel={t("decisions.title")} />
        <div className="segmented" role="tablist" aria-label={t("decisions.title")}>
          <button
            type="button"
            role="tab"
            aria-selected={view === "pending"}
            className={`segment${view === "pending" ? " active" : ""}`}
            onClick={() => setView("pending")}
          >
            {t("decisions.tab.pending")}
            {pendingCount > 0 && <span className="segment-sub">{pendingCount}</span>}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "decided"}
            className={`segment${view === "decided" ? " active" : ""}`}
            onClick={() => setView("decided")}
          >
            {t("decisions.tab.decided")}
          </button>
        </div>
      </div>
      {view === "pending" ? renderPending() : <HistoryPanel epoch={epoch} category={category} />}
      {confirmRequest && <ConfirmationDialog request={confirmRequest} onResolve={resolveConfirm} />}
    </div>
  );
}
