const status = { ready: '资料可用', stale: '资料已过期（stale）', unavailable: '资料不可用' };
const comparison = { matched: '一致', mismatched: '有差异', incomparable: '无法比较' };
const coverage = { complete: '完整', partial: '部分', none: '无' };
const text = (id, value) => { document.getElementById(id).textContent = value; };
async function read(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error('offline_read_failed');
  return response.json();
}
// Each section renders independently, even when the other read fails.
await Promise.allSettled([
  (async () => {
    try {
      const value = await read('/api/reconciliation-observations');
      const row = value.observations[0];
      text('current-status', `${status[value.data_status]} · ${comparison[row.comparison_status]}`);
      for (const [label, value] of [
        ['环境', 'synthetic / 离线合成'], ['覆盖', coverage[row.coverage]],
        ['采样开始', row.first_observed_at], ['采样结束', row.last_observed_at],
        ['完整样本数', row.evidence_sample_count], ['原因', row.reason_codes.join(', ') || '无'],
      ]) {
        const term = document.createElement('dt'), detail = document.createElement('dd');
        term.textContent = label; detail.textContent = value ?? '未取得';
        document.getElementById('current-fields').append(term, detail);
      }
      text('current-json', JSON.stringify(value, null, 2));
    } catch { text('current-status', '观察资料不可用；无法比较。'); }
  })(),
  (async () => {
    try {
      const value = await read('/api/reconciliation-recovery');
      text('historical-status', status[value.data_status] || value.data_status);
      text('historical-json', JSON.stringify(value, null, 2));
    } catch { text('historical-status', '历史材料暂不可用。'); }
  })(),
]);
