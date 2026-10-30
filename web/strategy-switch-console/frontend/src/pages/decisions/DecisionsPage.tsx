import { InboxReadFailed } from "../../components/InboxReadFailed";
import { useDisplayNames } from "../../lib/useDisplayNames";
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
  reviewedDecisionMatches,
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
  StatusBadge,
} from "../../components/primitives";
import { Tabs } from "../../components/Tabs";
import { DiffTable } from "../../components/DiffTable";
import { Timeline } from "../../components/Timeline";
import { ConfirmationDialog, useConfirmation } from "../../components/Dialog";
import { useToast } from "../../components/Toast";
import { resolveAccountChoice } from "./helpers";
import { sourceLabelKey } from "./sources";
import { InitialEnrollmentFacts } from "./InitialEnrollmentFacts";
import { ReconciliationMaterials } from "./ReconciliationMaterials";
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

const STALE_HINT_AGE_MS = 30 * 86_400_000;
/** Display-only staleness hint; items are never closed, deleted or reprioritized here. */
function showsStaleHint(item: InboxItem): boolean {
  if (item.evidence_freshness?.status === "stale") return true;
  const created = item.created_at ? Date.parse(item.created_at) : NaN;
  return Number.isFinite(created) && Date.now() - created > STALE_HINT_AGE_MS;
}

/**
 * The hint is visible text, not a hover title: an aged item says so in the list
 * so a touch user can tell why it may no longer be relevant.
 */
function staleHintKey(item: InboxItem): "decisions.stale_hint" | "decisions.stale_visible_hint" | null {
  if (item.evidence_freshness?.status === "stale") return "decisions.stale_hint";
  const created = item.created_at ? Date.parse(item.created_at) : NaN;
  return Number.isFinite(created) && Date.now() - created > STALE_HINT_AGE_MS ? "decisions.stale_visible_hint" : null;
}

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

/** First enrollment shares the recovery transport but has different review copy. */
function isInitialEnrollmentItem(item: InboxItem): boolean {
  return item.category === "reconciliation_recovery"
    && (Boolean(item.initial_enrollment) || item.presentation?.material_kind === "initial_enrollment");
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
  const names = useDisplayNames();
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

  const inbox = useApi(() => loadInbox(epoch > 0), [epoch]);
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
  const degradedSources = useMemo(
    () => (inbox.phase === "ready" && inbox.data.status !== "read_failed"
      ? inbox.data.sources.filter(source => source.status !== "ok")
      : []),
    [inbox],
  );

  const selected = visibleItems.find(item => item.id === selectedId) || null;

  /** A missing account link is an unbound item, never a global "all accounts" scope. */
  const accountLabel = (item: InboxItem) => item.account_alias
    ? names.account(item.account_alias, item.platform)
    : t("decisions.account_unbound");

  useEffect(() => {
    if (inbox.phase === "ready" && selectedId && !visibleItems.some(item => item.id === selectedId)) setSelectedId(null);
  }, [inbox.phase, selectedId, visibleItems]);

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

  /** Read fresh material, verify the displayed binding, then confirm and submit that exact version. */
  const recordIntent = async (item: InboxItem, action: Action, choiceId: string | null) => {
    const subject = subjectIdOf(item);
    const kind: HumanDecisionKind =
      item.category === "owner_decision" ? "owner" : item.category === "reconciliation_recovery" ? "recovery" : "promotion";
    let source: Record<string, any>;
    let body: Record<string, unknown>;
    let path: string;
    let targetAccount: AccountChoice | null = null;
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
          const resolved = options.find(option => option.id === choiceId);
          if (!resolved) {
            notice("error", "decisions.intent_unavailable");
            return;
          }
          account = resolved;
          targetAccount = resolved;
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
    if (body.mode === "initial_enrollment") {
      const displayed = item.initial_enrollment;
      if (!displayed
        || displayed.candidate_sha256 !== body.candidate_sha256
        || displayed.facts_sha256 !== body.facts_sha256) {
        notice("info", "decisions.material_changed");
        refresh();
        return;
      }
    }
    if (!reviewedDecisionMatches(item.decision_binding, expected)) {
      notice("info", "decisions.material_changed");
      refresh();
      return;
    }
    if (!await confirmDecision(item, action, false, targetAccount)) return;
    if (sessionEpoch !== humanDecisions.current.epoch() || isExpired(item)) return;
    const op = humanDecisions.current.start(expected);
    if (!op) return; // same decision already in flight
    const busyKey = `intent:${item.id}`;
    setBusy(current => ({ ...current, [busyKey]: true }));
    try {
      // Initial enrollment accepts only its exact server fields; the displayed
      // candidate/facts binding above is the local stale-review gate.
      const result = await postJson<Record<string, any>>(path, body.mode === "initial_enrollment" ? body : {
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

  const confirmDecision = (item: InboxItem, action: Action, paperAdopt: boolean, account: AccountChoice | null) => confirm({
    title: t(action === "adopt" ? "decisions.confirm_adopt_title" : "decisions.confirm_decline_title"),
    target: account ? `${itemTitle(item, t)} · ${account.label} (${account.platform} / ${account.key} / ${account.mode})` : itemTitle(item, t),
    summary: t(paperAdopt ? "decisions.apply_note" : "decisions.confirm_body"),
    body: <DiffTable rows={item.diff.map(row => ({ ...row, label: t(row.label_key) === row.label_key ? row.field : t(row.label_key), affectsLive: row.affects_live }))} />,
    consequence: t("decisions.intent_note"),
    tone: action === "adopt" ? "normal" : "danger",
    confirmLabel: t(action === "adopt" ? "decisions.confirm_adopt_label" : "decisions.confirm_decline_label"),
  });

  const onDecide = async (item: InboxItem, action: Action) => {
    if (!admin || item.status !== "pending" || isExpired(item)) return;
    const lockKey = `confirm:${item.id}`;
    if (!applyLocks.current.acquire(lockKey)) return;
    const busyKey = `intent:${item.id}`;
    setBusy(current => ({ ...current, [busyKey]: true }));
    try {
      const paperAdopt = item.category === "paper_account_application" && action === "adopt";
      const options = accountOptionsOf(selectedApplication, item.category === "paper_account_application");
      const choice = resolveAccountChoice(options, accountChoice[item.id]);
      if (action === "adopt" && (paperAdopt || item.category === "strategy_promotion") && !choice) {
        notice("error", "decisions.intent_unavailable");
        return;
      }
      if (paperAdopt && choice) {
        if (await confirmDecision(item, action, true, choice)) await applyPaper(item, choice.id);
      } else {
        await recordIntent(item, action, choice?.id ?? null);
      }
    } finally {
      applyLocks.current.release(lockKey);
      setBusy(current => ({ ...current, [busyKey]: false }));
    }
  };

  function itemTitle(item: InboxItem, translate: ReturnType<typeof useT>): string {
    if (isInitialEnrollmentItem(item)) return translate("decisions.initial_enrollment_title");
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
    const enrollment = item.initial_enrollment ?? null;
    const initialEnrollmentMode = isInitialEnrollmentItem(item);
    const enrollmentBlocked = initialEnrollmentMode && (!enrollment
      || enrollment.readiness !== "awaiting_human_confirmation"
      || !Array.isArray(enrollment.blocker_codes) || enrollment.blocker_codes.length > 0
      || !(["positions", "cash", "open_orders", "recent_executions", "local_execution_ledger"] as const)
        .every(name => enrollment.facts?.surfaces?.[name]?.status === "complete"
          && Array.isArray(enrollment.facts?.surfaces?.[name]?.items)));
    const strategyRow = item.diff.find(row => row.field === "strategy");
    const reviewedStrategy = item.presentation?.strategy_profile
      || (strategyRow && typeof strategyRow.after === "string" ? strategyRow.after : null);

    let actions: ReactNode = null;
    if (pending && admin && !(initialEnrollmentMode && enrollmentBlocked)) {
      if (item.category === "credential_maintenance") {
        actions = (
          <button type="button" className="button button-secondary" onClick={() => navigate({ page: "health" })}>
            {t("decisions.open_health")}
          </button>
        );
      } else if (item.category === "paper_account_application") {
        const options = accountOptionsOf(selectedApplication, true);
        const chosen = resolveAccountChoice(options, accountChoice[item.id])?.id ?? "";
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
        const chosen = resolveAccountChoice(options, accountChoice[item.id])?.id ?? "";
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
                disabled={anyBusy || (item.category === "strategy_promotion" && !chosen)}
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
          <button type="button" className="button button-secondary inbox-back" onClick={() => setSelectedId(null)}>
            {t("common.back")}
          </button>
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
          <p className="decision-prompt">
            {t(initialEnrollmentMode ? "decisions.prompt.initial_enrollment" : `decisions.prompt.${item.category}`)}
          </p>
          <div className="decision-meta">
            <span>{accountLabel(item)}</span>
            {item.platform && <span>{names.platform(item.platform)}</span>}
            <span className="decision-ref">{t("decisions.ref", { id: item.short_id })}</span>
            {item.created_at && (
              <span>{t("decisions.created_at", { value: formatDateTime(item.created_at, language).text })}</span>
            )}
            {item.expires_at && (
              <span>{t("decisions.expires_at", { value: formatDateTime(item.expires_at, language).text })}</span>
            )}
            {item.evidence_freshness && (
              <Badge tone={item.evidence_freshness.status === "stale" ? "warn"
                : item.evidence_freshness.status === "ready" || item.evidence_freshness.status === "fresh" ? "ok" : "unknown"}>
                {t(freshnessKey(item.evidence_freshness.status))}
              </Badge>
            )}
            {showsStaleHint(item) && <span className="decision-stale-hint">{t("decisions.stale_hint")}</span>}
          </div>
        </div>
        {diffRows.length > 0 && (
          <>
            <h3 className="decision-section-title">{t("decisions.diff_title")}</h3>
            <DiffTable rows={diffRows} />
          </>
        )}
        {initialEnrollmentMode && (
          <InitialEnrollmentFacts
            account={item.account_alias ? names.account(item.account_alias, item.platform) : null}
            strategy={reviewedStrategy ? names.strategy(reviewedStrategy) : null}
            platform={item.platform ? names.platform(item.platform) : null}
            facts={enrollment?.facts ?? null}
            readiness={enrollment?.readiness ?? null}
            blockerCodes={enrollment?.blocker_codes ?? null}
          />
        )}
        {item.category === "reconciliation_recovery" && !initialEnrollmentMode && (
          <details className="decision-materials reconciliation-detail">
            <summary>{t("reconciliation.materials")}</summary>
            <ReconciliationMaterials
              data={inbox.phase === "ready" ? inbox.data : null}
              language={language}
              t={t}
              itemId={item.id}
            />
          </details>
        )}
        <details className="decision-materials">
          <summary>{t("decisions.more_info")}</summary>
          <p>{t("decisions.ref", { id: item.short_id })}</p>
          {item.evidence_freshness?.as_of && <AsOfStamp value={item.evidence_freshness.as_of} />}
        </details>
        {actions}
      </div>
    );
  };

  const renderPending = () => {
    if (inbox.phase === "loading") {
      return (
        <div className="inbox list-only">
          <div className="inbox-list">
            <Skeleton height={64} />
            <Skeleton height={64} />
            <Skeleton height={64} />
          </div>
        </div>
      );
    }
    if (inbox.phase === "error" || inbox.data.status === "read_failed") {
      return <InboxReadFailed data={inbox.data} error={inbox.error} onRetry={inbox.phase === "error" ? inbox.reload : refresh} />;
    }
    return (
      <>
        {visibleItems.length === 0 ? (
          <EmptyState title={t("decisions.empty_pending")} />
        ) : (
          <div className={`inbox${selected ? " detail-open" : " list-only"}`}>
            <div className="inbox-list" role="list">
              {visibleItems.map(item => {
                const expired = isExpired(item);
                const fresh = relativeFreshness(item.created_at, language);
                const hintKey = staleHintKey(item);
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
                        {item.platform && <span>{names.platform(item.platform)}</span>}
                        <span>{accountLabel(item)}</span>
                      </span>
                      <span className="item-meta item-meta-secondary">
                        <span className="item-ref">{t("decisions.ref", { id: item.short_id })}</span>
                        {fresh && <span>{fresh}</span>}
                        {hintKey && <span className="decision-stale-hint">{t(hintKey)}</span>}
                      </span>
                    </span>
                    <Badge tone={expired ? "unknown" : "warn"}>
                      {t(`decisions.status.${expired ? "expired" : item.status}`)}
                    </Badge>
                  </button>
                );
              })}
            </div>
            {/* No selected todo => list only; never an empty detail pane. */}
            {selected && renderDetail()}
          </div>
        )}
      </>
    );
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">{t("decisions.title")}</h1>
        <div className="page-header-actions">
          <button type="button" className="button button-secondary" onClick={refresh}>
            {t("common.refresh")}
          </button>
        </div>
      </div>
      <div className="decisions-filters">
        {/* Tier one: the main view. Partial-source state is not a view. */}
        <div className="decisions-view-row">
          <div className="segmented" role="group" aria-label={t("decisions.title")}>
            <button
              type="button"
              aria-pressed={view === "pending"}
              className={`segment${view === "pending" ? " active" : ""}`}
              onClick={() => setView("pending")}
            >
              {t("decisions.tab.pending")}
              {pendingCount > 0 && <span className="segment-sub">{pendingCount}</span>}
            </button>
            <button
              type="button"
              aria-pressed={view === "decided"}
              className={`segment${view === "decided" ? " active" : ""}`}
              onClick={() => setView("decided")}
            >
              {t("decisions.tab.decided")}
            </button>
          </div>
        </div>
        {/* Tier two: category. One row, scrolled sideways when it does not fit. */}
        <div className="decisions-category-row">
          <Tabs id="decisions" items={categoryTabs} active={category} onChange={id => setCategory(id as CategoryFilter)} ariaLabel={t("decisions.title")} />
        </div>
      </div>
      {view === "pending" && degradedSources.length > 0 && (
        <div
          className="decision-degraded-note"
          role="status"
          data-state="partial"
          data-degraded-count={degradedSources.length}
        >
          <StatusBadge status="partial" />
          <span>{t("decisions.partial_notice")}</span>
          <details className="decision-degraded-sources">
            <summary>{t("decisions.partial_sources")}</summary>
            <ul>
              {degradedSources.map(source => (
                <li key={source.source} data-source={source.source}>
                  {t(sourceLabelKey(source.source))} · {t(`state.${source.status}`)}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
      <div id="decisions-panel" role="tabpanel" aria-labelledby={`decisions-tab-${category}`} tabIndex={0}>
        {view === "pending" ? renderPending() : <HistoryPanel epoch={epoch} category={category} />}
      </div>
      {confirmRequest && <ConfirmationDialog request={confirmRequest} onResolve={resolveConfirm} />}
    </div>
  );
}
