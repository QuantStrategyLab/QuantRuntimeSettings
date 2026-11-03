import type { CSSProperties } from "react";

/**
 * Layout and paint for the performance page, as inline styles that read only --mrd-* / --font-*
 * tokens. They live here instead of desk.css because the console's CSS size budget
 * (scripts/check-budget.mjs, 20 KB gz) has no room left for a chart UI; JS has headroom.
 */
const col: CSSProperties = { display: "flex", flexDirection: "column", minWidth: 0 };
const row: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center" };
const note: CSSProperties = { margin: 0, color: "var(--mrd-ink-3)", fontSize: 12 };

export const S = {
  page: { ...col, gap: 16 } as CSSProperties,
  title: (narrow: boolean, zh: boolean): CSSProperties => ({ margin: 0, fontSize: narrow ? (zh ? 22 : 26) : zh ? 28 : 32, lineHeight: 1.2 }),
  note,
  bench: { ...col, gap: 14 } as CSSProperties,
  kpi: { ...row, alignItems: "baseline", gap: "4px 12px", marginTop: 8 } as CSSProperties,
  kpiValue: (narrow: boolean): CSSProperties => ({ fontSize: narrow ? 28 : 32, lineHeight: 1 }),
  kpiSub: { color: "var(--mrd-ink-2)", fontSize: 12.5 } as CSSProperties,
  chips: { ...row, gap: 8 } as CSSProperties,
  extras: (open: boolean): CSSProperties => ({ ...col, gap: 8, display: open ? "flex" : "none" }),
  chip: (on: boolean | null): CSSProperties => ({
    color: on === false ? "var(--mrd-ink-3)" : "var(--mrd-ink)",
    background: on === false ? "none" : undefined,
    fontWeight: 500,
    cursor: on === null ? undefined : "pointer",
  }),
  check: (on: boolean): CSSProperties => ({
    display: "inline-grid", placeItems: "center", width: 14, height: 14, borderRadius: "50%", fontSize: 10, lineHeight: 1,
    boxShadow: on ? "none" : "inset 0 0 0 1.5px var(--mrd-ink-3)",
    background: on ? "var(--mrd-ink)" : undefined,
    color: on ? "var(--mrd-bg)" : undefined,
  }),
  ticker: { color: "var(--mrd-ink-3)", font: "11px var(--font-mono)" } as CSSProperties,
  tableWrap: { ...col, gap: 8, overflowX: "auto" } as CSSProperties,
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 } as CSSProperties,
  th: (first: boolean, narrow: boolean): CSSProperties => ({
    padding: narrow ? "8px 4px" : "9px 10px", textAlign: first ? "left" : "right", fontSize: 11,
    fontWeight: 500, color: "var(--mrd-ink-3)", borderBottom: "1px solid var(--mrd-line)", whiteSpace: narrow ? "normal" : "nowrap",
  }),
  rowHead: (narrow: boolean): CSSProperties => ({
    padding: narrow ? "8px 4px" : "9px 10px", textAlign: "left", fontWeight: 500, fontSize: narrow ? 11.5 : 13,
    borderBottom: "1px solid var(--mrd-line)", whiteSpace: narrow ? "normal" : "nowrap",
  }),
  td: (narrow: boolean, color?: string): CSSProperties => ({
    padding: narrow ? "8px 4px" : "9px 10px", textAlign: "right", fontFamily: "var(--font-mono)", fontSize: narrow ? 11.5 : 13,
    whiteSpace: "nowrap", borderBottom: "1px solid var(--mrd-line)", color,
  }),
  name: { ...row, gap: 8 } as CSSProperties,
  state: (narrow: boolean): CSSProperties => ({ flexBasis: "100%", marginLeft: narrow ? 0 : 34, color: "var(--mrd-ink-3)", fontSize: 11, fontWeight: 400 }),
  tag: { padding: "1px 8px", borderRadius: 99, boxShadow: "inset 0 0 0 1px var(--mrd-line)", color: "var(--mrd-ink-3)", font: "10.5px var(--font-sans)" } as CSSProperties,
  rowTr: (hidden: boolean, portfolio: boolean): CSSProperties => ({ opacity: hidden ? 0.5 : 1, background: portfolio ? "var(--mrd-panel-2)" : undefined }),
  readout: { ...row, gap: "4px 14px", minHeight: 22, marginBottom: 6, fontSize: 12 } as CSSProperties,
  readoutItem: { display: "inline-flex", alignItems: "center", gap: 6 } as CSSProperties,
  hint: { color: "var(--mrd-ink-3)" } as CSSProperties,
  dot: (token: string): CSSProperties => ({ width: 8, height: 8, borderRadius: "50%", background: `var(${token})` }),
  value: { marginLeft: "auto", font: "500 12px var(--font-mono)" } as CSSProperties,
  tip: {
    ...col, position: "absolute", top: 18, zIndex: 2, gap: 4, minWidth: 170, padding: "10px 12px", fontSize: 12,
    background: "var(--mrd-panel-2)", border: "1px solid var(--mrd-line)", borderRadius: 14, boxShadow: "var(--mrd-shadow)", pointerEvents: "none",
  } as CSSProperties,
  svgBox: { position: "relative", minWidth: 0 } as CSSProperties,
  svg: { display: "block", maxWidth: "100%", overflow: "visible", touchAction: "pan-y" } as CSSProperties,
};

/** Excess colour: sign only, never rank. */
export const signColor = (excess: number | null): string | undefined =>
  excess === null || excess === 0 ? undefined : excess > 0 ? "var(--mrd-mint)" : "var(--mrd-coral)";
