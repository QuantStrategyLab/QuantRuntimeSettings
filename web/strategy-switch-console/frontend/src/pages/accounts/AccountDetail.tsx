import { useDisplayNames } from "../../lib/useDisplayNames";
import { useEffect, useRef, useState } from "react";
import type { TodayRunSummary } from "../../api/contracts";
import { loadSettingsDiff } from "../../api/endpoints";
import { factEnvironment, factForAccount, userDeclarationOf } from "../../lib/accountFacts";
import { useNavigate } from "../../app/context";
import { setNavigationGuard } from "../../app/router";
import { useT, type Translate } from "../../i18n";
import { useApi } from "../../lib/hooks";
import { AsOfStamp, Badge, ErrorState, StatusBadge } from "../../components/primitives";
import { AccountFactsAmounts, EnvironmentBadge, type AccountEnvironment } from "../../components/AccountFactsAmounts";
import { BinanceWalletFacts } from "../../components/BinanceWalletFacts";
import type { AccountFactsView } from "../../components/AccountGroups";
import { ConfirmationDialog, useConfirmation } from "../../components/Dialog";
import { Tabs } from "../../components/Tabs";
import { accountOption } from "../../lib/accountDirectory";
import { platformLabel, type AccountRow, type ConsoleConfig, type EditMap } from "./helpers";
import { DiffSummary, StrategyTab } from "./StrategyTab";
import { ControlsTab } from "./ControlsTab";
import { HistoryTab } from "./HistoryTab";
import { RiskPreference } from "./RiskPreference";
import { AccountDeclaration } from "./AccountDeclaration";
import { verifiedSchwabAccountTypeToken } from "../../presentation";

type TodayRun = TodayRunSummary["accounts"][number];

const TAB_IDS = ["overview", "strategy", "controls", "history"] as const;
type TabId = (typeof TAB_IDS)[number];

function normalizeTab(tab: string | null): TabId {
  return (TAB_IDS as readonly string[]).includes(tab || "") ? (tab as TabId) : "overview";
}

export function AccountDetail({
  account,
  tab,
  config,
  todayRun,
  todayFailed,
  facts,
  onBack,
  onDeclarationSaved,
}: {
  account: AccountRow;
  tab: string | null;
  config: ConsoleConfig | null;
  todayRun: TodayRun | undefined;
  todayFailed: boolean;
  facts: AccountFactsView;
  onBack: () => void;
  onDeclarationSaved: () => void;
}) {
  const t = useT();
  const names = useDisplayNames(config);
  const navigate = useNavigate();
  const { confirmRequest, confirm, resolveConfirm } = useConfirmation();
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<EditMap>({});
  const dirty = editing && Object.keys(edits).length > 0;
  const diffState = useApi(() => loadSettingsDiff(account.account_alias, account.platform), [account.account_alias, account.platform]);

  // Unsaved draft edits block navigation away from this account via the shared guard.
  const confirmRef = useRef(confirm);
  confirmRef.current = confirm;
  const tRef = useRef<Translate>(t);
  tRef.current = t;
  useEffect(() => {
    if (!dirty) return;
    setNavigationGuard(() =>
      confirmRef.current({
        title: tRef.current("common.unsaved_guard_title"),
        summary: tRef.current("common.unsaved_guard_body"),
        tone: "normal",
      }),
    );
    return () => setNavigationGuard(null);
  }, [dirty]);

  const active = normalizeTab(tab);
  const selector = accountOption(config, account.platform, account.account_alias)?.account_selector?.trim();
  const fact = factForAccount(facts.rows, account.platform, account.account_alias);
  const evidenceEnvironment = config?.currentStrategies?.[account.platform]?.[account.account_alias]?.execution_evidence?.broker_environment;
  const factKnown = factEnvironment(fact);
  const evidenceKnown = evidenceEnvironment === "paper" || evidenceEnvironment === "live" ? evidenceEnvironment : null;
  const hasFactSignal = fact?.broker_environment === "live" || fact?.broker_environment === "paper" || fact?.account_scope === "live" || fact?.account_scope === "paper" || fact?.binding_environment === "live" || fact?.binding_environment === "paper";
  const trustedEnvironment: AccountEnvironment | null = factKnown && evidenceKnown && factKnown !== evidenceKnown ? null
    : factKnown ?? (!hasFactSignal ? evidenceKnown : null);
  const declared = userDeclarationOf(fact);
  const environment: AccountEnvironment | null = trustedEnvironment ?? (hasFactSignal || evidenceKnown ? null : declared?.environment ?? null);
  const nativeTypeToken = verifiedSchwabAccountTypeToken(account.platform, fact?.data_status, fact?.broker_account_type)?.toLowerCase();
  const nativeType = nativeTypeToken === "cash" || nativeTypeToken === "margin" ? nativeTypeToken : null;
  const accountType = nativeType ?? declared?.accountType ?? null;
  const declarationConflict = Boolean(
    (trustedEnvironment && declared?.environment && trustedEnvironment !== declared.environment)
    || (nativeType && declared?.accountType && nativeType !== declared.accountType),
  );

  const runBadge = todayFailed ? (
    <StatusBadge status="read_failed" />
  ) : todayRun ? (
    <>
      <StatusBadge status={todayRun.status} reason={todayRun.unavailable_reason} />
      <AsOfStamp value={todayRun.as_of} />
    </>
  ) : (
    <StatusBadge status="no_data" />
  );

  return (
    <div className="accounts-detail section-stack">
      <div>
        <button type="button" className="button button-secondary button-sm accounts-mobile-back" onClick={onBack}>
          ← {t("accounts.back_to_list")}
        </button>
      </div>
      <section className="card">
        <div className="accounts-detail-head">
          <h2 className="card-title">{names.account(account.account_alias, account.platform)}</h2>
          <EnvironmentBadge environment={environment} />
          {!trustedEnvironment && !hasFactSignal && !evidenceKnown && environment && <span>{t("accounts.declaration.source")}</span>}
        </div>
        {declarationConflict && (
          <p className="accounts-inline-note error" role="alert">{t("accounts.declaration.conflict_notice")}</p>
        )}
        <div className="accounts-summary-rows">
          <div className="accounts-summary-row">
            <span>{t("common.platform")}</span>
            <span>{platformLabel(config, account.platform)}</span>
          </div>
          {selector && (
            <div className="accounts-summary-row">
              <span>{t("accounts.identity")}</span>
              <span className="num">{selector}</span>
            </div>
          )}
          <div className="accounts-summary-row">
            <span>{t("accounts.run_state")}</span>
            <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>{runBadge}</span>
          </div>
          {account.platform !== "binance" && accountType && (
            <div className="accounts-summary-row">
              <span>{t("accounts.declaration.account_type")}</span>
              <span>{t(`accounts.declaration.type.${accountType}`)}{!nativeType && <> · {t("accounts.declaration.source")}</>}</span>
            </div>
          )}
        </div>
        {account.platform === "binance"
          ? <BinanceWalletFacts platform={account.platform} accountKey={account.account_alias} view={facts.binance} />
          : <AccountFactsAmounts fact={fact} phase={facts.phase} />}
      </section>
      <Tabs
        id="account-detail"
        items={TAB_IDS.map(id => ({ id, label: t(`accounts.tab.${id}`) }))}
        active={active}
        onChange={id => navigate({ tab: id })}
        ariaLabel={t("accounts.title")}
      />
      <div id="account-detail-panel" className="section-stack" role="tabpanel" aria-labelledby={`account-detail-tab-${active}`} tabIndex={0}>
        {active === "overview" && (
          <section className="card">
            <h2 className="card-title">{t("accounts.tab.overview")}</h2>
            {diffState.phase === "loading" && <div className="skeleton" style={{ height: 200 }} aria-hidden="true" />}
            {diffState.phase === "error" && <ErrorState onRetry={diffState.reload} />}
            {diffState.phase === "ready" && (
              <>
                {diffState.data.identity_status === "identity_conflict" && (
                  <p className="accounts-inline-note error" role="alert">{t("accounts.identity_conflict")}</p>
                )}
                <DiffSummary rows={diffState.data.rows} t={t} />
                <p className="card-note" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <Badge tone="unknown">{t("accounts.draft_revision", { value: diffState.data.draft_revision })}</Badge>
                  {diffState.data.status !== "ok" && <StatusBadge status={diffState.data.status} />}
                </p>
              </>
            )}
          </section>
        )}
        {active === "overview" && <RiskPreference platform={account.platform} accountKey={account.account_alias} />}
        {active === "overview" && <AccountDeclaration platform={account.platform} accountKey={account.account_alias} onSaved={onDeclarationSaved} />}
        {active === "strategy" && (
          <StrategyTab
            account={account}
            diffState={diffState}
            config={config}
            editing={editing}
            setEditing={setEditing}
            edits={edits}
            setEdits={setEdits}
            confirm={confirm}
          />
        )}
        {active === "controls" && <ControlsTab account={account} config={config} confirm={confirm} />}
        {active === "history" && <HistoryTab account={account} />}
      </div>
      {confirmRequest && <ConfirmationDialog request={confirmRequest} onResolve={resolveConfirm} />}
    </div>
  );
}
