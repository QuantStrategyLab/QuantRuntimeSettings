import type { DeskPage } from "../router";

const PATHS: Record<DeskPage | "sun" | "moon", string> = {
  overview: "M4 11l8-7 8 7v8a1 1 0 01-1 1h-4v-6H9v6H5a1 1 0 01-1-1z",
  accounts: "M6.5 5h11a3 3 0 013 3v8a3 3 0 01-3 3h-11a3 3 0 01-3-3V8a3 3 0 013-3zM3.5 10h17M7.5 15h4",
  switch: "M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7",
  performance: "M4 19V5M4 19h16M8 15l4-5 3 3 5-7",
  alerts: "M6 16V11a6 6 0 1112 0v5l2 2H4zM10 20a2 2 0 004 0",
  logs: "M5 5h14M5 10h14M5 15h9M5 20h6",
  sun: "M12 8a4 4 0 110 8 4 4 0 010-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  moon: "M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z",
};

/** Line icons drawn with currentColor; decorative, the label carries the meaning. */
export function Icon({ name }: { name: keyof typeof PATHS }) {
  return (
    <svg className="mrd-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
