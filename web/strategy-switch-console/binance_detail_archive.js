import { normalizeBinanceAccountFacts, normalizeBinanceFactsBinding } from './binance_account_facts.js';

// Separate from the 366-day valuation projection and the two-day latest cache.
// Daily native detail has no automatic expiration. No new trading authority.
export function binanceDetailCommand(sql, command) {
  const binding = normalizeBinanceFactsBinding(command.binding);
  const day = command.date;
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)
      || !Number.isFinite(Date.parse(`${day}T00:00:00Z`))
      || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) {
    throw new Error('binance_detail_date_invalid');
  }
  sql.exec(`CREATE TABLE IF NOT EXISTS binance_detail_daily (
    account_key TEXT NOT NULL, binding_id TEXT NOT NULL, observation_date TEXT NOT NULL,
    payload_json TEXT NOT NULL, PRIMARY KEY(account_key, binding_id, observation_date))`);
  const read = () => {
    const row = sql.exec(`SELECT payload_json FROM binance_detail_daily
      WHERE account_key = ? AND binding_id = ? AND observation_date = ?`,
    binding.account_key, binding.source_binding.id, day).toArray()[0];
    if (!row) return null;
    const report = normalizeBinanceAccountFacts(JSON.parse(row.payload_json), binding);
    if (report.observed_finished_at.slice(0, 10) !== day) throw new Error('binance_detail_date_mismatch');
    return report;
  };
  const existing = read();
  if (command.action === 'binance_detail_read') return { ok: true, report: existing };
  const report = normalizeBinanceAccountFacts(command.report, binding);
  if (report.observed_finished_at.slice(0, 10) !== day) throw new Error('binance_detail_date_mismatch');
  const canonical = value => JSON.stringify(value, function (key, item) {
    return item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map(name => [name, item[name]])) : item;
  });
  if (existing) {
    const prior = Date.parse(existing.observed_finished_at), incoming = Date.parse(report.observed_finished_at);
    if (incoming < prior || (incoming === prior && canonical(existing) !== canonical(report))) {
      throw new Error('binance_detail_conflict');
    }
  }
  sql.exec(`INSERT INTO binance_detail_daily VALUES (?, ?, ?, ?)
    ON CONFLICT(account_key, binding_id, observation_date) DO UPDATE SET payload_json = excluded.payload_json`,
  binding.account_key, binding.source_binding.id, day, JSON.stringify(report));
  if (canonical(read()) !== canonical(report)) throw new Error('binance_detail_readback_failed');
  return { ok: true, readback_verified: true };
}
