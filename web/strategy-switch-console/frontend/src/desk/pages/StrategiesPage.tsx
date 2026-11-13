import { useEffect, useReducer, useRef, useState } from "react";
import type { Language } from "../../lib/prefs";
import type { DeskApi, DeskResult } from "../api/endpoints.ts";
import type { Mode, Read, StrategyOption, StrategyRef, SwitchTargets } from "../contract/types";
import type { N1StrategyRow, N1SwitchStrategies } from "../contract/n1";
import { coverageText, n1ReasonKey, readValue } from "../api/n1.ts";
import { formatAge } from "../format.ts";
import type { DeskKey, DeskTranslate } from "../i18n/index.ts";
import { EmptyState, LoadingState, RecoverableErrorState } from "../components/StateBlocks.tsx";
import { useDeskLoad } from "../components/useDeskLoad.ts";
import { useNarrow } from "../components/useNarrow.ts";
import { P } from "../components/deskStyles.ts";
import { InlineForbidden } from "./AuthPage.tsx";
import {
  INITIAL_STRATEGY_FLOW, SWITCH_STEPS, STRATEGY_FILTERS, catalogCounts, filterCatalog, strategyFlowReducer,
} from "../strategies/model.ts";
import type { StrategyFilter } from "../strategies/model.ts";

function reasonText(reason: string, t: DeskTranslate): string {
  return t(n1ReasonKey(reason));
}

/** Rows whose eligibility the configuration/catalog proves, in the model's shape. */
function provenOption(row: N1StrategyRow): StrategyOption | null {
  if (row.eligibility.status !== "known" && row.eligibility.status !== "stale") return null;
  return {
    profile: row.profile, label: row.label, domain: row.domain, eligibility: row.eligibility.value,
    reason: row.reason, allowed_execution_modes: row.allowed_execution_modes, lifecycle_stage: row.lifecycle_stage,
  };
}

/** A catalog row whose eligibility is not proven: shown, counted in "all", never selectable. */
function UnprovenStrategyCard({ row, t }: { row: N1StrategyRow; t: DeskTranslate }) {
  const modes = row.allowed_execution_modes.map(mode => t(`mode.${mode}` as DeskKey)).join(", ");
  return (
    <article style={P.card} data-profile={row.profile} data-eligibility="unknown" data-selected="false">
      <div style={P.cardHead}>
        <b style={{ fontSize: 13.5 }}>{row.label}</b>
        <span style={P.badge("unknown")}>{t("strategies.card.eligibility_unknown")}</span>
      </div>
      <span style={P.mono}>{t("strategies.card.profile")}: {row.profile}</span>
      <span style={P.muted}>{t("strategies.card.domain", { domain: row.domain })}</span>
      <span style={P.muted}>{t("strategies.card.modes", { modes })}</span>
      <span style={P.muted}>{t("strategies.card.lifecycle", { stage: row.lifecycle_stage })}</span>
      <div style={P.actionRow}>
        <button type="button" className="mrd-chip" aria-pressed={false} disabled title="eligibility.status=unknown">{t("strategies.card.select")}</button>
      </div>
    </article>
  );
}

function strategyText(read: Read<StrategyRef>, t: DeskTranslate, language: Language): string {
  if (read.status === "unknown") return `${t("read.unknown")} · ${reasonText(read.reason, t)}`;
  if (read.status === "stale") return `${read.value.label} · ${t("read.stale", { age: formatAge(read.age_seconds, language) ?? "—" })}`;
  return read.value.label;
}

function modeText(read: Read<Mode>, t: DeskTranslate, language: Language): string {
  if (read.status === "unknown") return `${t("read.unknown")} · ${reasonText(read.reason, t)}`;
  if (read.status === "stale") return `${t(`mode.${read.value}` as DeskKey)} · ${t("read.stale", { age: formatAge(read.age_seconds, language) ?? "—" })}`;
  return t(`mode.${read.value}` as DeskKey);
}

function eligibilityView(option: StrategyOption, t: DeskTranslate): { text: string; tone: "ok" | "warn" | "risk" } {
  if (option.eligibility === "blocked") return { text: t("strategies.card.blocked"), tone: "risk" };
  if (option.eligibility === "no_live") return { text: t("strategies.card.no_live"), tone: "warn" };
  return { text: t("strategies.filter.eligible"), tone: "ok" };
}

function switchReasonText(reason: string | null, t: DeskTranslate): string {
  if (!reason) return "";
  const key = `strategies.reason.${reason}` as DeskKey;
  const text = t(key);
  return text === key ? reason : text;
}

export function TargetRow({ target, selected, onSelect, t, language }: {
  target: SwitchTargets["targets"][number];
  selected: boolean;
  onSelect: () => void;
  t: DeskTranslate;
  language: Language;
}) {
  const reason = target.switchable.reason_code ?? null;
  const switchable = target.switchable.allowed === true;
  return (
    <div style={P.targetRow(selected)} data-target-id={target.target_id} data-selected={selected ? "true" : "false"} data-switchable={switchable ? "true" : "false"}>
      <div style={P.column}>
        <b style={{ fontSize: 13.5 }}>{target.target_id}</b>
        <span style={P.mono}>{target.platform_label} · {target.account_ref}</span>
        <span style={P.muted}>{t("strategies.running.current")}: {strategyText(target.current_strategy, t, language)}</span>
        <span style={P.muted}>{t("strategies.running.mode")}: {modeText(target.mode, t, language)}</span>
      </div>
      <div style={P.row}>
        <span style={P.badge(switchable ? "ok" : "unknown")}>
          {switchable ? t("strategies.target.switchable") : switchReasonText(reason, t)}
        </span>
        {switchable ? (
          <a className="mrd-button" href={`#/desk/switch?target=${encodeURIComponent(target.target_id)}`} data-action="open-switch">{t("strategies.target.switch")}</a>
        ) : (
          /* S2: a target that cannot switch offers no live entry, only the reason. */
          <button type="button" className="mrd-chip" disabled title={reason ?? undefined} data-action="switch-disabled">{t("strategies.target.switch")}</button>
        )}
        {/* Browsing and previewing stays available for every target; only the write is gated. */}
        <button type="button" className="mrd-chip" aria-pressed={selected} onClick={onSelect}>
          {selected ? t("strategies.running.selected") : t("strategies.running.select")}
        </button>
      </div>
    </div>
  );
}

function StrategyCard({ option, selected, onSelect, t }: {
  option: StrategyOption;
  selected: boolean;
  onSelect: () => void;
  t: DeskTranslate;
}) {
  const eligibility = eligibilityView(option, t);
  const modes = option.allowed_execution_modes.map(mode => t(`mode.${mode}` as DeskKey)).join(", ");
  return (
    <article style={P.card} data-profile={option.profile} data-eligibility={option.eligibility} data-selected={selected ? "true" : "false"}>
      <div style={P.cardHead}>
        <b style={{ fontSize: 13.5 }}>{option.label}</b>
        <span style={P.badge(eligibility.tone)}>{eligibility.text}</span>
      </div>
      <span style={P.mono}>{t("strategies.card.profile")}: {option.profile}</span>
      <span style={P.muted}>{t("strategies.card.domain", { domain: option.domain })}</span>
      <span style={P.muted}>{t("strategies.card.modes", { modes })}</span>
      <span style={P.muted}>{t("strategies.card.lifecycle", { stage: option.lifecycle_stage })}</span>
      {option.reason ? <span style={P.muted}>{t("strategies.card.reason", { reason: switchReasonText(option.reason, t) })}</span> : null}
      <div style={P.actionRow}>
        <button type="button" className="mrd-chip" aria-pressed={selected} disabled={option.eligibility === "blocked"} onClick={onSelect}>
          {selected ? t("strategies.card.selected") : t("strategies.card.select")}
        </button>
      </div>
    </article>
  );
}

export function StrategiesPage({ api, t, language, admin, initialTarget, initialProfile }: {
  api: DeskApi;
  t: DeskTranslate;
  language: Language;
  admin: boolean;
  initialTarget?: string | null;
  initialProfile?: string | null;
}) {
  const [flow, dispatch] = useReducer(strategyFlowReducer, INITIAL_STRATEGY_FLOW);
  const [filter, setFilter] = useState<StrategyFilter>("all");
  const [targetId, setTargetId] = useState<string | null>(initialTarget ?? null);
  const autoSelected = useRef(false);
  const flowRef = useRef<HTMLElement | null>(null);
  const narrow = useNarrow();

  const targets = useDeskLoad<DeskResult<SwitchTargets>>(() => api.switchTargets(), [api]);
  const strategies = useDeskLoad<DeskResult<N1SwitchStrategies> | null>(
    () => (targetId ? api.switchStrategies(targetId) : Promise.resolve(null)),
    [api, targetId],
  );
  const targetsMock = targets.load.state === "ready" && targets.load.result.source === "mock";
  const catalogMock = strategies.load.state === "ready" && strategies.load.result?.source === "mock";

  useEffect(() => {
    if (initialTarget) {
      autoSelected.current = true;
      setTargetId(initialTarget);
      dispatch({ type: "select_target", targetId: initialTarget });
    }
  }, [initialTarget]);

  useEffect(() => {
    if (autoSelected.current || targetId || targets.load.state !== "ready") return;
    const first = targets.load.result.data.targets[0];
    if (!first) return;
    autoSelected.current = true;
    setTargetId(first.target_id);
    dispatch({ type: "select_target", targetId: first.target_id });
  }, [targetId, targets.load]);

  const catalogMatchesTarget = strategies.load.state === "ready" && strategies.load.result?.data.target_id === targetId;
  const catalogRead = catalogMatchesTarget && strategies.load.state === "ready" && strategies.load.result
    ? strategies.load.result.data.strategies
    : null;
  const rows = catalogRead ? readValue(catalogRead) ?? [] : [];
  const catalog: StrategyOption[] = rows.map(provenOption).filter((option): option is StrategyOption => option !== null);
  const unproven = rows.filter(row => provenOption(row) === null);

  useEffect(() => {
    if (!initialProfile || flow.profile) return;
    const option = catalog.find(entry => entry.profile === initialProfile);
    if (!option) return;
    dispatch({ type: "select_strategy", profile: option.profile, eligibility: option.eligibility, reason: option.reason });
  }, [initialProfile, flow.profile, catalog, targetId]);

  const selectedTarget = targets.load.state === "ready" && targetId
    ? targets.load.result.data.targets.find(entry => entry.target_id === targetId) ?? null
    : null;
  const selectedOption = catalog.find(entry => entry.profile === flow.profile) ?? null;
  // "All" counts every catalog row; the other filters count only proven eligibility.
  const counts = { ...catalogCounts(catalog), all: catalog.length + unproven.length };
  const filtered = filterCatalog(catalog, filter);
  const shownUnproven = filter === "all" ? unproven : [];
  const switchable = selectedTarget?.switchable ?? null;
  const currentStepIndex = SWITCH_STEPS.indexOf(flow.step);

  const selectTarget = (nextId: string) => {
    setTargetId(nextId);
    setFilter("all");
    dispatch({ type: "select_target", targetId: nextId });
  };

  const selectStrategy = (option: StrategyOption) => {
    dispatch({ type: "select_strategy", profile: option.profile, eligibility: option.eligibility, reason: option.reason });
  };

  const buildPreview = () => {
    if (!selectedTarget || !selectedOption || !targetId) return;
    dispatch({
      type: "preview_ready",
      preview: {
        targetId,
        profile: selectedOption.profile,
        current: selectedTarget.current_strategy,
        after: selectedOption,
        mode: selectedOption.allowed_execution_modes[0] ?? null,
      },
    });
  };

  const confirm = () => {
    if (!admin) {
      dispatch({ type: "forbidden" });
      return;
    }
    dispatch({
      type: "request_confirm",
      allowed: switchable?.allowed === true,
      reason: switchable?.allowed === true ? null : switchable?.reason_code ?? "switch_not_connected",
    });
  };

  // S4: the design's entry jumps into the five-step card on this page; no new route, no write.
  const openFlow = () => {
    flowRef.current?.scrollIntoView({ block: "start" });
    flowRef.current?.focus();
  };

  let targetsBody;
  if (targets.load.state === "loading") {
    targetsBody = <LoadingState t={t} label={t("strategies.running.title")} startedAt={targets.load.startedAt} onRetry={targets.reload} />;
  } else if (targets.load.state === "failed") {
    targetsBody = <RecoverableErrorState t={t} onRetry={targets.reload} />;
  } else if (targets.load.result.data.targets.length === 0) {
    targetsBody = <EmptyState t={t} title={t("strategies.running.empty")} />;
  } else {
    const rows = targets.load.result.data.targets;
    targetsBody = (
      <div style={P.page}>
        <div style={P.grid}>
          {rows.map(target => (
            <TargetRow key={target.target_id} target={target} selected={target.target_id === targetId} onSelect={() => selectTarget(target.target_id)} t={t} language={language} />
          ))}
        </div>
      </div>
    );
  }

  let catalogBody;
  if (!targetId) {
    // F6: targets exist and are simply not picked yet, so the catalog asks for a target.
    catalogBody = targets.load.state === "loading"
      ? <LoadingState t={t} label={t("strategies.catalog.title")} startedAt={targets.load.startedAt} onRetry={targets.reload} />
      : targets.load.state === "failed"
        ? <RecoverableErrorState t={t} onRetry={targets.reload} />
        : <EmptyState t={t} title={t("strategies.catalog.pick_target")} body={t("strategies.catalog.pick_target_note")} />;
  } else if (strategies.load.state === "loading" || (strategies.load.state === "ready" && !catalogMatchesTarget)) {
    catalogBody = <LoadingState t={t} label={t("strategies.catalog.title")} startedAt={strategies.load.state === "loading" ? strategies.load.startedAt : undefined} onRetry={strategies.reload} />;
  } else if (strategies.load.state === "failed") {
    catalogBody = <RecoverableErrorState t={t} onRetry={strategies.reload} />;
  } else if (catalogRead?.status === "unknown") {
    // An unreadable catalog is not an empty one.
    catalogBody = <p style={P.muted} role="status" data-read="unknown">{t("strategies.catalog.unknown", { reason: reasonText(catalogRead.reason, t) })}</p>;
  } else if (filtered.length === 0 && shownUnproven.length === 0) {
    catalogBody = <EmptyState t={t} title={t("strategies.catalog.empty")} />;
  } else {
    catalogBody = (
      <>
        {catalogRead?.status === "partial" ? (
          <p style={P.muted} role="status">{t("strategies.catalog.partial", { coverage: coverageText(catalogRead.coverage) })}</p>
        ) : null}
        <div style={P.grid}>
          {filtered.map(option => (
            <StrategyCard key={option.profile} option={option} selected={option.profile === flow.profile} onSelect={() => selectStrategy(option)} t={t} />
          ))}
          {shownUnproven.map(row => <UnprovenStrategyCard key={row.profile} row={row} t={t} />)}
        </div>
      </>
    );
  }

  const confirmReason = flow.blockedReason === "forbidden" ? null : switchReasonText(flow.blockedReason, t);

  const readyTargets = targets.load.state === "ready" ? targets.load.result.data.targets : null;
  const eligible = readyTargets ? readyTargets.filter(target => target.switchable.allowed === true).length : 0;
  // A projection fingerprint (not a Git commit); unknown reads "?".
  const revisionRead = catalogMatchesTarget && strategies.load.state === "ready" && strategies.load.result
    ? strategies.load.result.data.catalog_revision
    : null;
  const catalogRevision = revisionRead && revisionRead.status !== "unknown" ? revisionRead.value.value.slice(0, 12) : t("read.unknown_mark");

  return (
    <section style={P.page} aria-labelledby="mrd-page-title" data-flow-step={flow.step}>
      <div className="mrd-card" style={P.hero}>
        <span className="mrd-label">
          {readyTargets
            ? t("strategies.summary.meta", { running: readyTargets.length, revision: catalogRevision })
            : t("strategies.eyebrow")}
        </span>
        <h1 id="mrd-page-title" className="mrd-serif" style={P.title(narrow, language === "zh")}>
          {readyTargets === null ? t("strategies.title") : eligible > 0 ? (
            <>
              {t("strategies.headline.pre", { total: readyTargets.length })}
              <em>{t("strategies.headline.due", { eligible })}</em>
              {t("strategies.headline.post")}
            </>
          ) : t("strategies.headline.none", { total: readyTargets.length })}
        </h1>
        <p style={P.lead}>{t("strategies.body")}</p>
      </div>

      {/* S1: the banner states the policy where the flow is offered, not in a footnote. */}
      <div style={P.banner} role="note" data-banner="switch-not-connected">
        <b>{t("strategies.banner.title")}</b>
        <code>switch_not_connected</code>
        <span style={P.muted}>{t("strategies.banner.body")}</span>
      </div>

      <section className="mrd-card" style={P.column} aria-labelledby="mrd-running-title">
        <span className="mrd-label" id="mrd-running-title">{t("strategies.running.title")}</span>
        {targetsBody}
      </section>

      {/* S5: read-back writes exist in the contract but are not enabled for this build. */}
      <section className="mrd-card" style={P.column} aria-labelledby="mrd-readback-title">
        <div style={P.rowBetween}>
          <span className="mrd-label" id="mrd-readback-title">{t("strategies.s5.title")}</span>
          <div style={P.actionRow}>
            <button type="button" className="mrd-chip" disabled title="not_enabled" data-action="reapply-saved">{t("strategies.s5.reapply")}</button>
            <button type="button" className="mrd-chip" disabled title="not_enabled" data-action="adopt-platform">{t("strategies.s5.adopt")}</button>
          </div>
        </div>
        <span className="mrd-why">{t("strategies.s5.reason")}</span>
        <p style={P.muted}>{selectedTarget ? `${selectedTarget.target_id} · ` : ""}{t("strategies.s5.gap")}</p>
      </section>

      <section className="mrd-card" id="mrd-strategy-catalog" style={P.column} aria-labelledby="mrd-catalog-title">
        <div style={P.rowBetween}>
          <span className="mrd-label" id="mrd-catalog-title">{t("strategies.catalog.title")}</span>
          <div style={P.filterRow} role="group" aria-label={t("strategies.filter.label")}>
            {STRATEGY_FILTERS.map(entry => (
              <button key={entry} type="button" style={P.filterButton(filter === entry)} aria-pressed={filter === entry} onClick={() => setFilter(entry)} data-filter={entry}>
                {t(`strategies.filter.${entry}` as DeskKey)} <span style={P.mono}>{t("strategies.filter.count", { count: counts[entry] })}</span>
              </button>
            ))}
          </div>
        </div>
        {catalogBody}
      </section>

      <section className="mrd-card" style={P.column} aria-labelledby="mrd-after-title">
        <span className="mrd-label" id="mrd-after-title">{t("strategies.after")}</span>
        <div style={P.strip}>
          <div style={P.stripCol} data-strip="now">
            <span className="mrd-label">{t("strategies.now")}</span>
            <b style={{ fontSize: 13.5 }}>{selectedTarget ? strategyText(selectedTarget.current_strategy, t, language) : t("strategies.target.unknown")}</b>
            <span style={P.muted}>{t("strategies.now.current")}</span>
            <span style={P.muted}>{t("strategies.after.mode")}: {selectedTarget ? modeText(selectedTarget.mode, t, language) : t("strategies.after.mode_unknown")}</span>
          </div>
          <div style={P.stripCol} data-strip="after">
            <span className="mrd-label">{t("strategies.after.selected")}</span>
            <b style={{ fontSize: 13.5 }}>{selectedOption ? selectedOption.label : t("strategies.after.none")}</b>
            {selectedOption ? (
              <>
                <span style={P.muted}>{t("strategies.after.mode")}: {selectedOption.allowed_execution_modes.map(mode => t(`mode.${mode}` as DeskKey)).join(", ")}</span>
                {selectedOption.eligibility === "blocked" ? <span style={P.badge("risk")}>{t("strategies.after.blocked", { reason: switchReasonText(selectedOption.reason, t) })}</span> : null}
              </>
            ) : null}
          </div>
        </div>
        <p style={P.muted}>{t("strategies.after.preview_only")}</p>
      </section>

      <section className="mrd-card" style={P.column} aria-labelledby="mrd-flow-title">
        <span className="mrd-label" id="mrd-flow-title">{t("strategies.steps.title")}</span>
        <div style={P.actionRow}>
          <button type="button" className="mrd-button" onClick={openFlow} data-action="open-switch-flow">{t("strategies.flow.open")}</button>
          <span style={P.muted}>{t("strategies.flow.note")}</span>
          <button type="button" className="mrd-chip" disabled title={switchReasonText(switchable?.reason_code ?? null, t) || undefined} data-action="confirm-entry">{t("strategies.confirm.action")}</button>
        </div>
      </section>

      <section className="mrd-card" ref={flowRef} id="mrd-switch-flow" tabIndex={-1} style={P.column} aria-labelledby="mrd-steps-title">
        <span className="mrd-label" id="mrd-steps-title">{t("strategies.steps.title")}</span>
        <div style={P.stepRow}>
          {SWITCH_STEPS.map((step, index) => {
            const state = index < currentStepIndex ? "done" : index === currentStepIndex ? "current" : "todo";
            return (
              <div key={step} style={P.step(state)} data-step={step} data-state={state}>
                <span style={P.stepNumber}>{String(index + 1).padStart(2, "0")}</span>
                <span style={P.stepName}>{t(`strategies.steps.${step}` as DeskKey)}</span>
                {state === "current" ? <span style={P.muted}>{t("strategies.steps.current")}</span> : null}
              </div>
            );
          })}
        </div>

        {flow.step === "preview" ? (
          <div style={P.actionRow}>
            <button type="button" className="mrd-button" onClick={buildPreview}>{t("strategies.preview.action")}</button>
          </div>
        ) : null}

        {flow.step === "confirm" ? (
          <div style={P.column}>
            <p style={P.muted}>{t("strategies.steps.not_enabled")}</p>
            {!admin || flow.forbidden ? <InlineForbidden t={t} reason={t("strategies.confirm.forbidden")} /> : null}
            {admin && !flow.forbidden && confirmReason ? <p style={P.muted}>{confirmReason}</p> : null}
            <p style={P.muted}>{t("strategies.confirm.not_enabled")}</p>
            <div style={P.actionRow}>
              <button type="button" className="mrd-button" onClick={confirm} disabled={!admin || switchable?.allowed !== true} data-action="confirm-switch">
                {t("strategies.confirm.action")}
              </button>
            </div>
          </div>
        ) : null}

        {flow.step === "verify" ? <p style={P.muted}>{t("strategies.steps.not_enabled")}</p> : null}

        <div style={P.actionRow}>
          <button type="button" className="mrd-chip" onClick={() => dispatch({ type: "back" })} disabled={flow.step === "target"}>{t("strategies.back")}</button>
          <button type="button" className="mrd-chip" onClick={() => { dispatch({ type: "reset" }); setTargetId(null); setFilter("all"); }}>{t("strategies.reset")}</button>
        </div>
      </section>

      {targetsMock && catalogMock ? <p style={P.muted}>{t("strategies.mock_note")}</p>
        : catalogMock ? <p style={P.muted}>{t("strategies.catalog_mock_note")}</p>
        : targetsMock ? <p style={P.muted}>{t("mock.badge")}</p> : null}
    </section>
  );
}
