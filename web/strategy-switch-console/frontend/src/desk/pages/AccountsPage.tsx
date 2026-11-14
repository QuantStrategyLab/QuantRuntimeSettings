import { useEffect, useState } from "react";
import type { Language } from "../../lib/prefs";
import type { DeskApi, DeskResult } from "../api/endpoints.ts";
import type { Credentials } from "../contract/types";
import type { N1Accounts, N1BrokerHealth, N1Read } from "../contract/n1";
import { coverageText, n1ReasonKey, readValue } from "../api/n1.ts";
import { formatAge } from "../format.ts";
import type { DeskKey, DeskTranslate } from "../i18n/index.ts";
import { CredentialExpiryRow } from "../components/CredentialExpiryRow.tsx";
import { DeskTabs } from "../components/DeskTabs.tsx";
import { EmptyState, LoadingState, RecoverableErrorState, StalePartialBanner } from "../components/StateBlocks.tsx";
import { useDeskLoad } from "../components/useDeskLoad.ts";
import { useNarrow } from "../components/useNarrow.ts";
import { P } from "../components/deskStyles.ts";
import { CredentialsTab } from "./CredentialsTab.tsx";

export type AccountsTab = "brokers" | "credentials";

function reasonText(reason: string, t: DeskTranslate): string {
  return t(n1ReasonKey(reason));
}

function connectivityView(read: N1Read<"up" | "degraded" | "down">, t: DeskTranslate, language: Language): { text: string; tone: "ok" | "warn" | "risk" | "unknown" } {
  if (read.status === "unknown") return { text: `${t("accounts.connectivity.unknown")} · ${reasonText(read.reason, t)}`, tone: "unknown" };
  if (read.status === "partial") return { text: `${t("accounts.connectivity.unknown")} · ${t("n1.partial", { coverage: coverageText(read.coverage) })}`, tone: "unknown" };
  if (read.status === "stale") return { text: `${t("read.stale", { age: formatAge(read.age_seconds, language) ?? "—" })} · ${t(`accounts.connectivity.${read.value}` as DeskKey)}`, tone: "unknown" };
  if (read.value === "up") return { text: t("accounts.connectivity.up"), tone: "ok" };
  if (read.value === "degraded") return { text: t("accounts.connectivity.degraded"), tone: "warn" };
  return { text: t("accounts.connectivity.down"), tone: "risk" };
}

function heartbeatText(read: N1Read<{ at: string }>, t: DeskTranslate, language: Language): string {
  if (read.status === "unknown") return `${t("read.unknown_mark")} · ${reasonText(read.reason, t)}`;
  if (read.status === "partial") return `${read.value.at} · ${t("n1.partial", { coverage: coverageText(read.coverage) })}`;
  if (read.status === "stale") return `${t("read.stale", { age: formatAge(read.age_seconds, language) ?? "—" })} · ${read.value.at}`;
  return read.value.at;
}

function lastOrderText(read: N1Read<{ at: string; count: number }>, t: DeskTranslate, language: Language): string {
  if (read.status === "unknown") return `${t("read.unknown_mark")} · ${reasonText(read.reason, t)}`;
  if (read.status === "stale") return t("read.stale", { age: formatAge(read.age_seconds, language) ?? "—" });
  // A partial order read cannot prove "no orders".
  if (read.status === "partial") return t("n1.partial", { coverage: coverageText(read.coverage) });
  return read.value.count === 0 ? t("accounts.last_order.none") : t("accounts.last_order.value", { count: read.value.count, at: read.value.at });
}

/** Config line: drift without a known count reads "?", and an unknown state never reads as synced. */
function configText(config: N1BrokerHealth["config"], t: DeskTranslate): string {
  if (config.state !== "drift") return t(`config.${config.state}` as DeskKey);
  return t("config.drift", { count: config.drift_count.status === "known" ? config.drift_count.value : t("read.unknown_mark") });
}

function BrokerCard({ broker, t, language, narrow, onManage }: { broker: N1BrokerHealth; t: DeskTranslate; language: Language; narrow: boolean; onManage: () => void }) {
  const connectivity = connectivityView(broker.connectivity, t, language);
  const freshness = broker.data_freshness;
  return (
    <article className="mrd-card" style={P.card} data-platform={broker.platform} data-connectivity={broker.connectivity.status}>
      <div style={P.cardHead}>
        <div style={P.column}>
          <b style={{ fontSize: 16 }}>{broker.label}</b>
          <span style={P.mono}>{broker.platform}</span>
        </div>
        <span style={P.badge(connectivity.tone)}>{connectivity.text}</span>
      </div>

      <div style={P.column}>
        <span className="mrd-label">{t("accounts.broker.targets")}</span>
        <div style={P.row}>
          {broker.targets.map(target => (
            <a key={target.target_id} style={P.link} href={`#/desk/switch?target=${encodeURIComponent(target.target_id)}`}>
              {target.target_id} · {target.account_ref}
            </a>
          ))}
        </div>
      </div>

      <hr style={P.divider} />
      <div style={P.detailList}>
        <div style={P.detailItem}>
          <span style={P.detailLabel}>{t("accounts.broker.heartbeat")}</span>
          <span style={P.detailValue}>{heartbeatText(broker.heartbeat, t, language)}</span>
        </div>
        <div style={P.detailItem}>
          <span style={P.detailLabel}>{t("accounts.broker.freshness")}</span>
          <span style={P.detailValue}>
            {t(`freshness.${freshness.data_status}` as DeskKey, { age: formatAge(freshness.age_seconds, language) ?? "—" })}
          </span>
        </div>
        <div style={P.detailItem}>
          <span style={P.detailLabel}>{t("accounts.broker.config")}</span>
          <span style={P.detailValue}>
            {configText(broker.config, t)}
          </span>
        </div>
        <div style={P.detailItem}>
          <span style={P.detailLabel}>{t("accounts.broker.last_order")}</span>
          <span style={P.detailValue}>{lastOrderText(broker.last_order, t, language)}</span>
        </div>
      </div>

      {/* Decision 6: on phones the expiry lives only on the Credentials list and the Overview item. */}
      {narrow ? null : (
        <>
          <hr style={P.divider} />
          <CredentialExpiryRow credential={broker.credential} t={t} language={language} onManage={onManage} />
        </>
      )}
      <div style={P.actionRow}>
        <a style={P.link} href={`#/desk/switch?target=${encodeURIComponent(broker.targets[0]?.target_id ?? "")}`}>{t("accounts.broker.switch")}</a>
      </div>
    </article>
  );
}

/** Ready-state broker list: a pure function of the N1 payload, testable against the golden payloads. */
export function BrokersView({ data, source, t, language, narrow, onManage }: {
  data: N1Accounts;
  source: DeskResult<N1Accounts>["source"];
  t: DeskTranslate;
  language: Language;
  narrow: boolean;
  onManage: () => void;
}) {
  const read = data.brokers;
  if (read.status === "unknown") {
    // An unreadable broker list is not "no brokers".
    return (
      <section className="mrd-card" style={P.column} role="status" data-read="unknown">
        <p style={P.muted}>{t("accounts.brokers.unknown", { reason: reasonText(read.reason, t) })}</p>
      </section>
    );
  }
  const brokers = readValue(read) ?? [];
  if (brokers.length === 0 && read.status === "known") return <EmptyState t={t} title={t("accounts.brokers.empty")} />;
  const notReady = brokers.filter(broker => broker.data_freshness.data_status !== "ready");
  // The banner carries the oldest age the payload already reports; an unavailable broker has none.
  const ages = notReady.map(broker => broker.data_freshness.age_seconds).filter((age): age is number => typeof age === "number");
  const oldestAge = ages.length ? Math.max(...ages) : null;
  return (
    <div style={P.page}>
      {notReady.length > 0 ? <StalePartialBanner t={t} language={language} ageSeconds={oldestAge} included={brokers.length - notReady.length} total={brokers.length} /> : null}
      {read.status === "partial" ? <p style={P.muted} role="status">{t("n1.partial", { coverage: coverageText(read.coverage) })}</p> : null}
      <div style={P.grid}>
        {brokers.map(broker => (
          <BrokerCard key={broker.platform} broker={broker} t={t} language={language} narrow={narrow} onManage={onManage} />
        ))}
      </div>
      {source === "mock" ? <p style={P.muted}>{t("mock.title")}</p> : null}
    </div>
  );
}

export function AccountsPage({ api, t, language, initialTab = "brokers" }: {
  api: DeskApi;
  t: DeskTranslate;
  language: Language;
  initialTab?: AccountsTab;
}) {
  const [tab, setTab] = useState<AccountsTab>(initialTab);
  const narrow = useNarrow();
  const accounts = useDeskLoad<DeskResult<N1Accounts>>(() => api.accounts(), [api]);
  const credentials = useDeskLoad<DeskResult<Credentials>>(() => api.credentials(), [api]);

  // A deep link such as ?tab=credentials wins when it changes while the page is mounted.
  useEffect(() => { setTab(initialTab); }, [initialTab]);

  // Frame N1: the credentials tab carries the credential count once the read is back.
  const credentialCount = credentials.load.state === "ready" ? credentials.load.result.data.items.length : null;
  const credentialsLabel = credentialCount === null
    ? t("accounts.tabs.credentials")
    : t("accounts.tabs.credentials_count", { label: t("accounts.tabs.credentials"), count: credentialCount });
  const tabs = [
    { id: "brokers", label: t("accounts.tabs.brokers") },
    { id: "credentials", label: credentialsLabel },
  ];

  let body;
  if (tab === "credentials") {
    body = <CredentialsTab load={credentials.load} t={t} language={language} reload={credentials.reload} />;
  } else if (accounts.load.state === "loading") {
    body = <LoadingState t={t} label={t("accounts.title")} startedAt={accounts.load.startedAt} onRetry={accounts.reload} />;
  } else if (accounts.load.state === "failed") {
    body = <RecoverableErrorState t={t} onRetry={accounts.reload} />;
  } else {
    body = <BrokersView data={accounts.load.result.data} source={accounts.load.result.source} t={t} language={language} narrow={narrow} onManage={() => setTab("credentials")} />;
  }

  return (
    <section style={P.page} aria-labelledby="mrd-page-title">
      <div className="mrd-card" style={P.hero}>
        <span className="mrd-label">{t("accounts.eyebrow")}</span>
        <h1 id="mrd-page-title" className="mrd-serif" style={P.title(narrow, language === "zh")}>{t("accounts.title")}</h1>
        <p style={P.lead}>{t("accounts.body")}</p>
      </div>
      <DeskTabs id="accounts" items={tabs} active={tab} onChange={id => setTab(id === "credentials" ? "credentials" : "brokers")} label={t("accounts.title")} />
      <div id="accounts-panel" role="tabpanel" aria-labelledby={`accounts-tab-${tab}`}>{body}</div>
    </section>
  );
}
