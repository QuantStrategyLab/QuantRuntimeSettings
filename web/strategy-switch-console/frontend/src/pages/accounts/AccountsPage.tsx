import { accountName } from "../../lib/displayNames";
import { useState } from "react";
import { getJson } from "../../api/client";
import { loadAccounts, loadTodayRuns } from "../../api/endpoints";
import { useNavigate } from "../../app/context";
import { useT } from "../../i18n";
import { useApi } from "../../lib/hooks";
import { DateText, EmptyState, ErrorState, Skeleton, StatusBadge } from "../../components/primitives";
import { DataTable, type Column } from "../../components/DataTable";
import { platformLabel, type AccountRow, type ConsoleConfig } from "./helpers";
import { AccountDetail } from "./AccountDetail";
import "./accounts.css";

export default function AccountsPage({ account, tab }: { account: string | null; tab: string | null }) {
  const t = useT();
  const navigate = useNavigate();
  const [epoch, setEpoch] = useState(0);

  const accountsState = useApi(() => loadAccounts(), [epoch]);
  const configState = useApi(() => getJson<ConsoleConfig>("/api/config").catch(() => null), [epoch]);
  const todayState = useApi(() => loadTodayRuns(), [epoch]);

  const config = configState.phase === "ready" ? configState.data : null;
  const accounts = accountsState.phase === "ready" ? accountsState.data.accounts : [];
  const selected = account ? accounts.find(item => item.account_alias === account) : undefined;

  const todayFailed =
    todayState.phase === "error" || (todayState.phase === "ready" && todayState.data.status === "read_failed");
  const todayRun =
    selected && todayState.phase === "ready" && !todayFailed
      ? todayState.data.accounts.find(item => item.account_alias === selected.account_alias)
      : undefined;

  const select = (alias: string) => navigate({ account: alias });

  const columns: Column<AccountRow>[] = [
    {
      id: "alias",
      header: t("accounts.col.alias"),
      cell: row => (
        <button type="button" className="accounts-alias-button" onClick={() => select(row.account_alias)}>
          {accountName(row.account_alias, row.platform)}
        </button>
      ),
      sortValue: row => row.account_alias,
    },
    {
      id: "platform",
      header: t("accounts.col.platform"),
      cell: row => platformLabel(config, row.platform),
      sortValue: row => row.platform,
    },
    {
      id: "drafts",
      header: t("accounts.col.drafts"),
      numeric: true,
      cell: row => row.pending_draft_count,
      sortValue: row => row.pending_draft_count,
    },
    {
      id: "todos",
      header: t("accounts.col.todos"),
      numeric: true,
      cell: row => (row.pending_decision_count === null ? "—" : row.pending_decision_count),
      sortValue: row => row.pending_decision_count,
    },
    {
      id: "last_change",
      header: t("accounts.col.last_change"),
      cell: row => <DateText value={row.last_change_at} />,
      sortValue: row => row.last_change_at,
    },
  ];

  let listBody;
  if (accountsState.phase === "loading") {
    listBody = <Skeleton height={240} />;
  } else if (accountsState.phase === "error") {
    listBody = <ErrorState onRetry={accountsState.reload} />;
  } else if (accounts.length === 0) {
    listBody = <EmptyState title={t("overview.no_accounts")} />;
  } else {
    listBody = (
      <>
        <div className="accounts-list-table">
          <DataTable
            columns={columns}
            rows={accounts}
            rowKey={row => `${row.platform}/${row.account_alias}`}
            defaultSort={{ column: "alias", direction: "asc" }}
            caption={t("accounts.title")}
          />
        </div>
        <div className="accounts-list-cards">
          {accounts.map(row => (
            <button key={`${row.platform}/${row.account_alias}`} type="button" className="account-card" onClick={() => select(row.account_alias)}>
              <span className="account-title">{accountName(row.account_alias, row.platform)}</span>
              <span className="account-row">
                <span>{t("accounts.col.platform")}</span>
                <span>{platformLabel(config, row.platform)}</span>
              </span>
              <span className="account-row">
                <span>{t("accounts.col.drafts")}</span>
                <span className="num">{row.pending_draft_count}</span>
              </span>
              <span className="account-row">
                <span>{t("accounts.col.todos")}</span>
                <span className="num">{row.pending_decision_count === null ? "—" : row.pending_decision_count}</span>
              </span>
              <span className="account-row">
                <span>{t("accounts.col.last_change")}</span>
                <span><DateText value={row.last_change_at} /></span>
              </span>
            </button>
          ))}
        </div>
      </>
    );
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
      <div className={`accounts-split${selected ? " detail-open" : ""}`}>
        <div className="accounts-list">{listBody}</div>
        {selected ? (
          <AccountDetail
            key={`${selected.platform}/${selected.account_alias}`}
            account={selected}
            tab={tab}
            config={config}
            todayRun={todayRun}
            todayFailed={todayFailed}
            onBack={() => navigate({ account: null })}
          />
        ) : (
          <div className="accounts-detail">
            <div className="card">
              <EmptyState title={t("accounts.select_account")} body={t("accounts.select_account_hint")} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
