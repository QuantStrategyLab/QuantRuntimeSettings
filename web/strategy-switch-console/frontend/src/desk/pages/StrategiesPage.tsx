import { useEffect, useReducer, useRef, useState } from "react";
import type { Language } from "../../lib/prefs";
import type { DeskApi, DeskResult } from "../api/endpoints.ts";
import type { Mode, Read, StrategyOption, StrategyRef, SwitchStrategies, SwitchTargets } from "../contract/types";
import { formatAge } from "../format.ts";
import type { DeskKey, DeskTranslate } from "../i18n/index.ts";
import { EmptyState, LoadingState, RecoverableErrorState, StalePartialBanner } from "../components/StateBlocks.tsx";
import { useDeskLoad } from "../components/useDeskLoad.ts";
import { useNarrow } from "../components/useNarrow.ts";
import { P } from "../components/deskStyles.ts";
import { InlineForbidden } from "./AuthPage.tsx";
import {
  INITIAL_STRATEGY_FLOW, SWITCH_STEPS, STRATEGY_FILTERS, catalogCounts, filterCatalog, strategyFlowReducer,
} from "../strategies/model.ts";
import type { StrategyFilter } from "../strategies/model.ts";

function reasonText(reason: string, t: DeskTranslate): string {
  return t(`read.reason.${reason}` as DeskKey);
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

function TargetRow({ target, selected, onSelect, t, language }: {
  target: SwitchTargets["targets"][number];
  selected: boolean;
  onSelect: () => void;
  t: DeskTranslate;
  language: Language;
}) {
  return (
    <div style={P.targetRow(selected)} data-target-id={target.target_id} data-selected={selected ? "true" : "false"}>
      <div style={P.column}>
        <b style={{ fontSize: 13.5 }}>{target.target_id}</b>
        <span style={P.mono}>{target.platform_label} · {target.account_ref}</span>
        <span style={P.muted}>{t("strategies.running.current")}: {strategyText(target.current_strategy, t, language)}</span>
        <span style={P.muted}>{t("strategies.running.mode")}: {modeText(target.mode, t, language)}</span>
        {target.switchable.allowed ? null : <span style={P.muted}>{switchReasonText(target.switchable.reason_code, t)}</span>}
      </div>
      <button type="button" className="mrd-chip" aria-pressed={selected} onClick={onSelect}>
        {selected ? t("strategies.running.selected") : t("strategies.running.select")}
      </button>
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
  const narrow = useNarrow();

  const targets = useDeskLoad<DeskResult<SwitchTargets>>(() => api.switchTargets(), [api]);
  const strategies = useDeskLoad<DeskResult<SwitchStrategies> | null>(
    () => (targetId ? api.switchStrategies(targetId) : Promise.resolve(null)),
    [api, targetId],
  );

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

  const catalog: StrategyOption[] = strategies.load.state === "ready" && strategies.load.result
    ? strategies.load.result.data.strategies
    : [];

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
  const counts = catalogCounts(catalog);
  const filtered = filterCatalog(catalog, filter);
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

  let targetsBody;
  if (targets.load.state === "loading") {
    targetsBody = <LoadingState t={t} label={t("strategies.running.title")} startedAt={targets.load.startedAt} onRetry={targets.reload} />;
  } else if (targets.load.state === "failed") {
    targetsBody = <RecoverableErrorState t={t} onRetry={targets.reload} />;
  } else if (targets.load.result.data.targets.length === 0) {
    targetsBody = <EmptyState t={t} title={t("strategies.running.empty")} />;
  } else {
    const rows = targets.load.result.data.targets;
    const unknown = rows.filter(row => row.mode.status === "unknown" || row.current_strategy.status === "unknown").length;
    targetsBody = (
      <div style={P.page}>
        {unknown > 0 ? <StalePartialBanner t={t} language={language} included={rows.length - unknown} total={rows.length} /> : null}
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
    catalogBody = <EmptyState t={t} title={t("strategies.running.empty")} />;
  } else if (strategies.load.state === "loading") {
    catalogBody = <LoadingState t={t} label={t("strategies.catalog.title")} startedAt={strategies.load.startedAt} onRetry={strategies.reload} />;
  } else if (strategies.load.state === "failed") {
    catalogBody = <RecoverableErrorState t={t} onRetry={strategies.reload} />;
  } else if (filtered.length === 0) {
    catalogBody = <EmptyState t={t} title={t("strategies.catalog.empty")} />;
  } else {
    catalogBody = (
      <div style={P.grid}>
        {filtered.map(option => (
          <StrategyCard key={option.profile} option={option} selected={option.profile === flow.profile} onSelect={() => selectStrategy(option)} t={t} />
        ))}
      </div>
    );
  }

  const confirmReason = flow.blockedReason === "forbidden" ? null : switchReasonText(flow.blockedReason, t);

  return (
    <section style={P.page} aria-labelledby="mrd-page-title" data-flow-step={flow.step}>
      <div className="mrd-card" style={P.hero}>
        <span className="mrd-label">{t("strategies.eyebrow")}</span>
        <h1 id="mrd-page-title" className="mrd-serif" style={P.title(narrow, language === "zh")}>{t("strategies.title")}</h1>
        <p style={P.lead}>{t("strategies.body")}</p>
      </div>

      <section className="mrd-card" style={P.column} aria-labelledby="mrd-running-title">
        <span className="mrd-label" id="mrd-running-title">{t("strategies.running.title")}</span>
        {targetsBody}
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

      <section className="mrd-card" style={P.column} aria-labelledby="mrd-steps-title">
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

      {targets.load.state === "ready" && targets.load.result.source === "mock" ? <p style={P.muted}>{t("strategies.mock_note")}</p> : null}
    </section>
  );
}
