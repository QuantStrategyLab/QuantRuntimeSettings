import { useEffect, useState } from "react";
import type { SettingsHistoryResponse } from "../../api/contracts";
import { loadSettingsHistory } from "../../api/endpoints";
import { useT } from "../../i18n";
import { useApi } from "../../lib/hooks";
import { EmptyState, ErrorState, Skeleton, StatusBadge } from "../../components/primitives";
import { Timeline, type TimelineItem } from "../../components/Timeline";
import { useToast } from "../../components/Toast";
import type { AccountRow } from "./helpers";

type HistoryItem = SettingsHistoryResponse["items"][number];

export function HistoryTab({ account }: { account: AccountRow }) {
  const t = useT();
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
    return t("accounts.event.unrecorded");
  };

  const timelineItems: TimelineItem[] = items.map(item => {
    const parts = [
      item.actor_alias || t("accounts.event.unrecorded"),
      item.draft_revision === null ? null : t("accounts.draft_revision", { value: item.draft_revision }),
      item.source ? null : t("accounts.event.unrecorded"),
      t("decisions.ref", { id: item.short_id }),
    ].filter(Boolean) as string[];
    const detail = parts.filter((part, index) => part !== parts[index - 1]).join(" · ");
    return { id: item.id, time: item.time, title: eventLabel(item), detail };
  });

  const effectVerification = availability?.effect_verification;

  return (
    <section className="card">
      <h2 className="card-title">{t("accounts.tab.history")}</h2>
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
        <p className="card-note">
          <StatusBadge status={effectVerification.status} reason={effectVerification.unavailable_reason} />{" "}
          {t("reason.effect_verification_not_recorded")}
        </p>
      )}
    </section>
  );
}
