import { useEffect, useState } from "react";
import type { SettingsHistoryResponse } from "../../api/contracts";
import { loadSettingsHistory } from "../../api/endpoints";
import { useLanguage, useT } from "../../i18n";
import { managementStatusText } from "../../lib/accountManagementText";
import { useApi } from "../../lib/hooks";
import { EmptyState, ErrorState, Skeleton, StatusBadge } from "../../components/primitives";
import { Timeline, type TimelineItem } from "../../components/Timeline";
import { useToast } from "../../components/Toast";
import type { AccountRow } from "./helpers";

type HistoryItem = SettingsHistoryResponse["items"][number];

export function HistoryTab({ account }: { account: AccountRow }) {
  const t = useT();
  const language = useLanguage();
  const toast = useToast();
  const first = useApi(() => loadSettingsHistory(account.account_alias, account.platform), [account.account_alias, account.platform]);
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [availability, setAvailability] = useState<SettingsHistoryResponse["availability"] | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    if (first.phase === "ready") {
      setItems(first.data.items);
      setCursor(first.data.next_cursor);
      setAvailability(first.data.availability);
    }
  }, [first.phase, first.data]);

  if (first.phase === "loading") return <Skeleton height={200} />;
  if (first.phase === "error") return <ErrorState onRetry={first.reload} />;

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await loadSettingsHistory(account.account_alias, account.platform, 25, cursor);
      setItems(prev => [...prev, ...page.items]);
      setCursor(page.next_cursor);
      setAvailability(page.availability);
    } catch {
      toast({ kind: "error", text: t("error.generic") });
    } finally {
      setLoadingMore(false);
    }
  };

  const eventLabel = (item: HistoryItem): string => {
    if (item.event === "draft_saved") return t("accounts.event.draft_saved");
    if (item.event === "approved") return t("accounts.event.approved");
    if (item.event === "account_management_change") return t("accounts.event.account_management_change");
    return t("accounts.event.unrecorded");
  };

  const managementSummary = (item: HistoryItem): string | null => {
    if (item.event !== "account_management_change") return null;
    const to = managementStatusText(item.new_management_enabled ? "managed" : "management_disabled", language);
    const rev = item.management_revision ?? t("common.na");
    if (item.old_management_enabled === true || item.old_management_enabled === false) {
      const from = managementStatusText(item.old_management_enabled ? "managed" : "management_disabled", language);
      return t("accounts.management.history_transition", { from, to, revision: rev });
    }
    return t("accounts.management.history_init", { to, revision: rev });
  };

  const timelineItems: TimelineItem[] = items.map(item => {
    const parts = [
      managementSummary(item),
      item.actor_alias || t("accounts.event.unrecorded"),
      item.draft_revision === null ? null : t("accounts.draft_revision", { value: item.draft_revision }),
      item.source ? null : t("accounts.event.unrecorded"),
      t("decisions.ref", { id: item.short_id || item.change_ref || item.id }),
    ].filter(Boolean) as string[];
    const detail = parts.filter((part, index) => part !== parts[index - 1]).join(" · ");
    return { id: item.id, time: item.time, title: eventLabel(item), detail };
  });

  const effectVerification = availability?.effect_verification;
  const managementAvailability = availability?.management_change;

  return (
    <section className="card">
      <h2 className="card-title">{t("accounts.tab.history")}</h2>
      {managementAvailability && (
        <p className="card-note" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span>{t("accounts.management.history_availability")}</span>
          <StatusBadge status={managementAvailability.status} reason={managementAvailability.unavailable_reason} />
          <span>{t("accounts.management.history_note")}</span>
        </p>
      )}
      {items.length === 0 ? (
        <EmptyState title={t("accounts.history.empty")} />
      ) : (
        <Timeline items={timelineItems} />
      )}
      {cursor && (
        <div style={{ marginTop: 12 }}>
          <button type="button" className="button button-secondary" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? t("common.loading") : t("common.load_more")}
          </button>
        </div>
      )}
      {effectVerification && effectVerification.status !== "ok" && (
        <div className="card-note" role="status" data-state={effectVerification.status}>
          <p>{t("accounts.effect_unconfirmed")}</p>
          <StatusBadge status={effectVerification.status} reason={effectVerification.unavailable_reason} />
          {effectVerification.unavailable_reason && (
            <span className="state-short">{t(`reason.${effectVerification.unavailable_reason}`)}</span>
          )}
        </div>
      )}
    </section>
  );
}
