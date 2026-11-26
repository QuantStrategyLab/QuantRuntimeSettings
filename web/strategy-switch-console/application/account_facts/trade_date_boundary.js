// US 23/5 trade-date boundary shared by broker-execution consumers.
//
// IBKR dates fills from 20:00 ET to midnight on the following day, so an overnight
// execution's local wall time falls on the evening before its trade date. A
// local time may therefore differ from its trade date only in that shape: it is
// on the calendar day immediately before the trade date, at or after 20:00, and
// stated in US Eastern time. A null time zone is read as Eastern, the Flex default
// assumed by the producer; any other explicit zone keeps the same-day rule.
// Every other mismatch stays invalid.

export const TRADE_DATE_BOUNDARY = "20:00:00";
const EASTERN = "America/New_York";

function strictDayMs(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value ? ms : null;
}

/**
 * @param {string} localDay  YYYY-MM-DD of the local wall time
 * @param {string} timeText  HH:MM:SS of the local wall time
 * @param {string} tradeDate YYYY-MM-DD broker trade date
 * @param {string|null|undefined} timeZone record time zone, null when unstated
 */
export function localTimeMatchesTradeDate(localDay, timeText, tradeDate, timeZone = null) {
  const localMs = strictDayMs(localDay);
  const tradeMs = strictDayMs(tradeDate);
  if (localMs === null || tradeMs === null) return false;
  if (localMs === tradeMs) return true;
  if (timeZone !== null && timeZone !== undefined && timeZone !== EASTERN) return false;
  return tradeMs - localMs === 86_400_000 && typeof timeText === "string" && timeText >= TRADE_DATE_BOUNDARY;
}
