/**
 * Clock text for a broker execution row. A US 23/5 overnight fill is booked on the
 * next trade date (IBKR dates 20:00 ET to midnight fills to the following day), so
 * when the local date differs from the trade date the local date is kept, so the
 * execution time is never shown a day late.
 */
export function executionClock(localTime: string, tradeDate: string | null | undefined): string {
  const localDay = localTime.slice(0, 10);
  return tradeDate && localDay !== tradeDate ? `${localDay} ${localTime.slice(11)}` : localTime.slice(11);
}
