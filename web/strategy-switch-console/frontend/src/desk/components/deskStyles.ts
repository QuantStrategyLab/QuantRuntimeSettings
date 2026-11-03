import type { CSSProperties } from "react";

/**
 * Layout and paint for the desk pages. Inline styles read only --mrd-* / --font-*
 * tokens, so the pages add no colour literals and no CSS-budget pressure.
 */
const col: CSSProperties = { display: "flex", flexDirection: "column", minWidth: 0 };
const row: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 };

export const P = {
  page: { ...col, gap: 16 } as CSSProperties,
  hero: { ...col, gap: 8, overflow: "hidden" } as CSSProperties,
  title: (narrow: boolean, zh: boolean): CSSProperties => ({
    margin: 0,
    fontSize: narrow ? (zh ? 24 : 28) : zh ? 32 : 38,
    lineHeight: 1.15,
  }),
  lead: { margin: 0, color: "var(--mrd-ink-2)", maxWidth: "56em" } as CSSProperties,
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 } as CSSProperties,
  catalogGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 } as CSSProperties,
  card: { ...col, gap: 10, padding: 16, borderRadius: 18, background: "var(--mrd-panel-2)", border: "1px solid var(--mrd-line)" } as CSSProperties,
  cardHead: { ...row, justifyContent: "space-between", alignItems: "baseline" } as CSSProperties,
  row: { ...row } as CSSProperties,
  rowBetween: { ...row, justifyContent: "space-between" } as CSSProperties,
  column: { ...col, gap: 4 } as CSSProperties,
  muted: { margin: 0, color: "var(--mrd-ink-3)", fontSize: 12 } as CSSProperties,
  mono: { fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--mrd-ink-3)" } as CSSProperties,
  strip: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 } as CSSProperties,
  stripCol: { ...col, gap: 6, padding: 14, borderRadius: 16, background: "var(--mrd-panel)", border: "1px solid var(--mrd-line)" } as CSSProperties,
  filterRow: { ...row, gap: 6 } as CSSProperties,
  filterButton: (on: boolean): CSSProperties => ({
    padding: "6px 12px",
    borderRadius: 99,
    border: "1px solid var(--mrd-line)",
    background: on ? "var(--mrd-panel-2)" : "none",
    color: on ? "var(--mrd-ink)" : "var(--mrd-ink-3)",
    font: "500 12px var(--font-sans)",
    cursor: "pointer",
  }),
  targetRow: (on: boolean): CSSProperties => ({
    ...row,
    justifyContent: "space-between",
    padding: "10px 12px",
    borderRadius: 14,
    border: "1px solid var(--mrd-line)",
    background: on ? "var(--mrd-panel-2)" : "none",
  }),
  stepRow: { ...row, gap: 6, alignItems: "stretch" } as CSSProperties,
  step: (state: "done" | "current" | "todo"): CSSProperties => ({
    ...col,
    flex: "1 1 120px",
    gap: 2,
    padding: "8px 10px",
    borderRadius: 12,
    border: "1px solid var(--mrd-line)",
    background: state === "current" ? "var(--mrd-panel-2)" : "none",
    opacity: state === "todo" ? 0.7 : 1,
  }),
  stepNumber: { font: "500 10.5px var(--font-mono)", color: "var(--mrd-ink-3)" } as CSSProperties,
  stepName: { fontSize: 12.5, fontWeight: 500 } as CSSProperties,
  badge: (tone: "ok" | "warn" | "risk" | "unknown"): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "3px 9px",
    borderRadius: 99,
    border: "1px solid var(--mrd-line)",
    color: tone === "risk" ? "var(--mrd-coral)" : tone === "warn" ? "var(--mrd-amber)" : tone === "ok" ? "var(--mrd-mint)" : "var(--mrd-unknown)",
    font: "500 11px var(--font-sans)",
    whiteSpace: "nowrap",
  }),
  actionRow: { ...row, gap: 8, marginTop: 4 } as CSSProperties,
  link: { color: "var(--mrd-violet)", textDecoration: "none", fontWeight: 500 } as CSSProperties,
  divider: { height: 1, background: "var(--mrd-line)", border: 0, margin: "4px 0" } as CSSProperties,
  detailList: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8, margin: 0 } as CSSProperties,
  detailItem: { ...col, gap: 2 } as CSSProperties,
  detailLabel: { margin: 0, color: "var(--mrd-ink-3)", fontSize: 11 } as CSSProperties,
  detailValue: { margin: 0, fontSize: 13, overflowWrap: "anywhere" } as CSSProperties,
};
