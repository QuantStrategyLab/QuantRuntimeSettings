import type { DeskKey, DeskTranslate } from "../i18n/index.ts";
import type { DeskPage } from "../router.ts";

/** Phase and contract endpoints each page will read (FE-PLAN.md §4, API-CONTRACT.md §4). */
export const PAGE_PLAN: Record<DeskPage, { phase: number; endpoints: string[] }> = {
  overview: { phase: 4, endpoints: ["GET /api/desk/overview", "GET /api/desk/ribbon"] },
  accounts: { phase: 5, endpoints: ["GET /api/desk/accounts", "GET /api/desk/accounts/{target_id}", "GET /api/desk/targets/{target_id}/readback", "POST /api/desk/readbacks"] },
  switch: { phase: 6, endpoints: ["GET /api/desk/switch/targets", "POST /api/desk/switch/previews", "POST /api/desk/switch/requests", "GET /api/desk/switch/requests/{request_id}"] },
  performance: { phase: 7, endpoints: ["GET /api/desk/performance", "GET /api/market-benchmark"] },
  alerts: { phase: 8, endpoints: ["GET /api/desk/alerts", "GET /api/desk/alerts/delivery"] },
  logs: { phase: 8, endpoints: ["GET /api/desk/ribbon", "GET /api/desk/logs"] },
};

/** Phase 1 skeleton: what the page is for, what it will show, where its data comes from. */
export function PageStub({ page, t }: { page: DeskPage; t: DeskTranslate }) {
  const plan = PAGE_PLAN[page];
  const parts = t(`page.${page}.parts` as DeskKey).split("|");
  return (
    <section className="mrd-stub" aria-labelledby="mrd-page-title">
      <div className="mrd-card mrd-stub-hero">
        <span className="mrd-label">{t("stub.eyebrow", { phase: plan.phase })}</span>
        <h1 id="mrd-page-title" className="mrd-serif">{t(`page.${page}.headline` as DeskKey)}</h1>
        <p>{t(`page.${page}.body` as DeskKey)}</p>
        <div className="mrd-glow" aria-hidden="true" />
      </div>
      <div className="mrd-stub-grid">
        <div className="mrd-card">
          <span className="mrd-label">{t("stub.planned")}</span>
          <ol className="mrd-parts">
            {parts.map((part, index) => (
              <li key={part}><b>{String(index + 1).padStart(2, "0")}</b>{part}</li>
            ))}
          </ol>
        </div>
        <div className="mrd-card">
          <span className="mrd-label">{t("stub.sources")}</span>
          <ul className="mrd-endpoints">
            {plan.endpoints.map(endpoint => <li key={endpoint}><code>{endpoint}</code></li>)}
          </ul>
          <p className="mrd-note">{t("stub.note")}</p>
        </div>
      </div>
    </section>
  );
}
