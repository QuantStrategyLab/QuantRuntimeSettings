/** Presentation only: local SVGs do not depend on an asset request or font glyph. */
export function QslMark({ className = "brand-mark" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 28 28" fill="none" aria-hidden="true" focusable="false">
    <path d="M5 5v18h18M8 18l5-6 4 3 6-9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

export function ThemeIcon({ dark }: { dark: boolean }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {dark ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></> : <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.2 8.2 0 1 0 10.2 10.2Z" />}
  </svg>;
}
