import { AccountGroups, type AccountFactsView } from "../../components/AccountGroups";
import { findAccount } from "../../lib/accountDirectory";
import { useState } from "react";
import { getJson } from "../../api/client";
import { loadAccountFacts, loadAccounts, loadTodayRuns } from "../../api/endpoints";
import { useNavigate } from "../../app/context";
import { useT } from "../../i18n";
import { useApi } from "../../lib/hooks";
import { EmptyState, ErrorState, Skeleton, StatusBadge } from "../../components/primitives";
import { type ConsoleConfig } from "./helpers";
import { AccountDetail } from "./AccountDetail";
import "./accounts.css";

export default function AccountsPage({ account, tab }: { account: string | null; tab: string | null }) {
  const t = useT();
  const navigate = useNavigate();
  const [epoch, setEpoch] = useState(0);

  const accountsState = useApi(() => loadAccounts(), [epoch]);
  const configState = useApi(() => getJson<ConsoleConfig>("/api/config").catch(() => null), [epoch]);
  const todayState = useApi(() => loadTodayRuns(), [epoch]);
  const factsState = useApi(() => loadAccountFacts(), [epoch]);

  const config = configState.phase === "ready" ? configState.data : null;
  const accounts = accountsState.phase === "ready" ? accountsState.data.accounts : [];
  const selected = account ? findAccount(accounts, account) : undefined;
  const facts: AccountFactsView = factsState.phase === "ready"
    ? { rows: factsState.data.accounts, phase: "ready" }
    : { rows: [], phase: factsState.phase };

  const todayFailed =
    todayState.phase === "error" || (todayState.phase === "ready" && todayState.data.status === "read_failed");
  const todayRun =
    selected && todayState.phase === "ready" && !todayFailed
      ? todayState.data.accounts.find(item => item.account_alias === selected.account_alias && item.platform === selected.platform)
      : undefined;

  const select = (alias: string) => navigate({ account: alias });

  let listBody;
  if (accountsState.phase === "loading") {
    listBody = <Skeleton height={240} />;
  } else if (accountsState.phase === "error") {
    listBody = <ErrorState onRetry={accountsState.reload} />;
  } else if (accounts.length === 0) {
    listBody = <EmptyState title={t("overview.no_accounts")} />;
  } else {
    listBody = <AccountGroups accounts={accounts} config={config} facts={facts} onSelect={select} />;
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">{t("accounts.title")}</h1>
        {accountsState.phase === "ready" && accountsState.data.status === "partial" && <StatusBadge status="partial" />}
        <button type="button" className="button button-secondary" onClick={() => setEpoch(value => value + 1)}>
          {t("common.refresh")}
        </button>
      </header>
      {accountsState.phase === "ready" && accountsState.data.unassigned_decision_count > 0 && (
        <p className="card-note" style={{ margin: 0 }}>
          {t("accounts.unassigned_note", { count: accountsState.data.unassigned_decision_count })}
        </p>
      )}
      {!selected && <p className="card-note">{t("accounts.select_account")}</p>}
      <div className={`accounts-split${selected ? " detail-open" : ""}`}>
        <div className="accounts-list">{listBody}</div>
        {selected && (
          <AccountDetail
            key={`${selected.platform}/${selected.account_alias}`}
            account={selected}
            tab={tab}
            config={config}
            todayRun={todayRun}
            todayFailed={todayFailed}
            facts={facts}
            onBack={() => navigate({ account: null })}
          />
        )}
      </div>
    </div>
  );
}
