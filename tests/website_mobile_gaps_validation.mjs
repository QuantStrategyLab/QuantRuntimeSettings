import assert from 'node:assert/strict';
import { build } from '../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Fictional fixtures only. Render production components and i18n, replacing network hooks.
const root = new URL('../web/strategy-switch-console/frontend/', import.meta.url).pathname;
const directory = await mkdtemp(join(tmpdir(), 'website-mobile-gaps-'));
try {
  const outfile = join(directory, 'render.cjs');
  await build({ stdin: { resolveDir: root, contents: `
    import { createElement as h } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { I18nProvider } from './src/i18n';
    import { PrefsContext } from './src/app/context';
    import { DEFAULT_PREFERENCES } from './src/lib/prefs';
    import { CurrencyTotals } from './src/components/CurrencyTotals';
    import { HoldingsTab, RankingTab } from './src/pages/performance/PerformanceTabs';
    import { ReturnsCard } from './src/pages/performance/ReturnsCard';
    import { CalendarCard } from './src/pages/performance/CalendarCard';
    import { StatStrip } from './src/pages/health/HealthPage';
    import { CatalogTab } from './src/pages/strategies/StrategiesPage';
    const render = (language, component, props) => renderToStaticMarkup(h(I18nProvider, { language }, h(component, props)));
    export const totals = (language, totals) => render(language, CurrencyTotals, { totals });
    export const holdings = (language, data, hideAmounts=false) => render(language, PrefsContext.Provider, {value:{prefs:{...DEFAULT_PREFERENCES,language,hideAmounts},resolvedTheme:'light',setPrefs(){}},children:h(HoldingsTab,{state:{phase:'ready',data,reload(){}}})});
    export const ranking = (language, data) => render(language, RankingTab, {state:{phase:'ready',data,reload(){}}});
    export const returns = language => render(language, ReturnsCard, {scope:'all',range:'YTD',epoch:0,state:globalThis.__mobileState});
    export const catalog = language => render(language, CatalogTab, {refreshEpoch:0});
    export const health = (language, credential) => render(language, StatStrip, {summary:{phase:"ready",data:{status:"ok",accounts:[],counts:{configured:0,observed:0},date:"2026-10-27"},reload(){}},credential:{phase:"ready",data:credential,reload(){}}});
    export const calendar = language => render(language, CalendarCard, {scope:'all',range:'YTD',epoch:0});
  ` }, bundle: true, platform: 'node', format: 'cjs', outfile, jsx: 'automatic', loader: { '.css': 'empty' },
    define: { 'import.meta.env': '{}' }, plugins: [{ name: 'controlled-state', setup(b) {
      b.onLoad({ filter: /\/lib\/hooks\.ts$/ }, () => ({ contents: 'export const useApi = () => globalThis.__mobileState;', loader: 'js' }));
      b.onLoad({ filter: /\/StrategiesPage\.tsx$/ }, async ({ path }) => ({ contents: await readFile(path, 'utf8') + '\nexport { CatalogTab };', loader: 'tsx' }));
      b.onLoad({ filter: /\/HealthPage\.tsx$/ }, async ({ path }) => ({ contents: await readFile(path, 'utf8') + '\nexport { StatStrip };', loader: 'tsx' }));
      b.onLoad({ filter: /\/PerformanceTabs\.tsx$/ }, async ({ path }) => ({ contents: await readFile(path, 'utf8') + '\nexport { HoldingsTab, RankingTab };', loader: 'tsx' }));
    } }], logLevel: 'silent' });
  const ui = createRequire(import.meta.url)(outfile);
  const row = { account_alias: 'fictional-alpha', platform: 'example', symbol: 'DEMO.LONG', quantity: 0.000123, market_value: null, avg_cost: null, unrealized_pnl: null, currency: 'USD', status: 'partial', unavailable_reason: 'avg_cost_missing', coverage: 'partial' };
  const data = { status: 'partial', label_key: 'performance.current_holdings_unrealized', rows: [row] };
  for (const language of ['zh', 'en']) {
    const credentialValue = credential => {
      const html = ui.health(language, credential);
      const marker = `<span class="kpi-title">${language === 'zh' ? '凭证' : 'Credentials'}</span><div class="kpi-value num">`;
      assert.ok(html.includes(marker));
      return html.slice(html.indexOf(marker) + marker.length).split('</div>')[0].replace(/<[^>]*>/g, '');
    };
    assert.equal(credentialValue({phase:'unknown',requires_action:true}), language==='zh'?'未知':'Unknown');
    assert.equal(credentialValue({phase:'not_due',requires_action:false}), '0');
    assert.equal(credentialValue({phase:'expired',requires_action:true}), '1');
    globalThis.__mobileState = {phase:'ready',data:{status:'partial',as_of:'2026-10-27T01:00:00Z',account_assignment_status:'read_failed',strategies:[{profile:'fictional-profile',domain:'us_equity',allowed_execution_modes:[],configured_accounts:[],health_score:50,health_status:'watch',status:'stale',unavailable_reason:'strategy_health_stale',as_of:'2026-10-20T01:00:00Z',freshness:{status:'stale',age_seconds:604800}}]}};
    const catalog = ui.catalog(language);
    assert.ok(catalog.includes(language==='zh'?'账户绑定待确认':'Account binding unconfirmed'));
    assert.ok(catalog.includes('data-binding="unknown"'));
    assert.ok(!catalog.includes('data-binding="unbound"'));
    assert.ok(catalog.includes(language==='zh'?'健康数据截至':'Health data as of'));
    assert.ok(catalog.includes('10/20') || catalog.includes('20/10') || catalog.includes('2026'));
    assert.ok(!catalog.includes(language==='zh'?'未绑定账户':'No account linked'));
    assert.ok(!catalog.includes(language==='zh'?'当前没有账户配置策略':'No account is configured'));
    assert.ok(catalog.includes(language==='zh'?'数据偏旧':'Stale') || catalog.includes(language==='zh'?'数据过期':'Stale'));
    const holdings = ui.holdings(language, data);
    assert.ok(holdings.includes('DEMO.LONG'));
    assert.ok(holdings.includes('0.000123'));
    assert.ok(holdings.includes(language === 'zh' ? '未提供：' : 'Not provided:'));
    assert.ok(holdings.includes(language === 'zh' ? '成本价' : 'Avg cost'));
    assert.doesNotMatch(holdings, /state\.|reason\./);
    const brokerCost = { ...row, platform: 'longbridge', broker_cost_price: '1234.567890123456789', broker_cost_method: 'broker_configured' };
    const nativeCost = ui.holdings(language, { ...data, rows: [brokerCost] });
    assert.ok(nativeCost.includes('1,234.567890123456789 USD'), 'native broker decimal text keeps every digit');
    const cells = [...nativeCost.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(match => match[1].replace(/<[^>]*>/g,''));
    assert.equal(cells[5], '—', 'native broker cost cannot manufacture unrealized P/L');
    assert.ok(nativeCost.includes(language === 'zh' ? '券商成本（按券商设置）' : 'Broker cost (broker settings)'));
    assert.ok(nativeCost.includes(language === 'zh' ? '平均成本' : 'Avg cost'), 'the unavailable average cost is still identified separately');
    const maskedCost = ui.holdings(language, { ...data, rows: [brokerCost] }, true);
    assert.ok(maskedCost.includes('•••'));
    assert.ok(!maskedCost.includes('1234.567890123456789') && !maskedCost.includes('1,234.567890123456789'), 'masked cost leaks neither raw nor grouped decimal');
    for (const invalid of [{ ...brokerCost, platform:'schwab' }, { ...brokerCost, broker_cost_method:'unverified' }, { ...brokerCost, broker_cost_price:'not-a-decimal' }, { ...brokerCost, status:'unavailable' }]) {
      assert.ok(!ui.holdings(language, { ...data, rows:[invalid] }).includes('1,234.567890123456789'), 'unqualified native cost is never trusted');
    }
    const averageWins = ui.holdings(language, { ...data, rows:[{ ...brokerCost, avg_cost:12.5 }] });
    assert.ok(averageWins.includes('USD 12.50'));
    assert.ok(!averageWins.includes('1,234.567890123456789'), 'a reported average cost keeps precedence');
    const costOnlyRanking = ui.ranking(language, { ...data, rows:[{ ...brokerCost, quantity:2, market_value:999, unrealized_pnl:null }] });
    assert.ok(!costOnlyRanking.includes('bar-row'), 'native broker cost cannot become ranking P/L');
    const ranking = ui.ranking(language, data);
    assert.ok(ranking.includes(language === 'zh' ? '暂无可排名的持仓' : 'No holdings are eligible for ranking'));
    assert.ok(ranking.includes(language === 'zh' ? '未实现盈亏' : 'unrealized P/L'));
    const staleNumber = ui.ranking(language, { ...data, rows: [{ ...row, status: 'unavailable', quantity: 2, avg_cost: 3, unrealized_pnl: 1 }] });
    assert.doesNotMatch(staleNumber, /bar-row|33\.33/);
    const noMovement = ui.ranking(language, { ...data, rows: [{ ...row, quantity: 2, avg_cost: 3, unrealized_pnl: 0 }] });
    assert.ok(noMovement.includes(language === 'zh' ? '暂无盈亏变化' : 'no P/L movement'));
    assert.ok(!noMovement.includes(language === 'zh' ? '排名需要' : 'Ranking requires'));
    const total = { currency: 'USD', total: 42, status: 'partial', account_count: 1, expected_account_count: 2, as_of: null, stale: false, unavailable_reason: 'valuation_date_mismatch', account_coverage: [
      { platform: 'example', account_alias: 'fictional-alpha', included: true, observation_date: '2026-10-27', as_of: '2026-10-27T01:00:00Z', freshness: 'fresh', unavailable_reason: null },
      { platform: 'example', account_alias: 'fictional-beta', included: false, observation_date: '2026-10-26', as_of: '2026-10-26T01:00:00Z', freshness: 'stale', unavailable_reason: 'valuation_date_mismatch' },
    ] };
    const coverage = ui.totals(language, [total]);
    assert.ok(coverage.includes('<details'));
    assert.ok(coverage.includes('fictional-beta'));
    assert.ok(coverage.includes('2026-10-26'));
    assert.ok(coverage.includes(language === 'zh' ? '未计入' : 'Excluded'));
    assert.ok(coverage.includes(language === 'zh' ? '估值日期不同' : 'different valuation dates'));
    assert.doesNotMatch(coverage, /state\.|reason\./);
    globalThis.__mobileState = { phase: 'ready', data: { status: 'unavailable', unavailable_reason: 'external_cashflow_required', per_currency: [], points: [], benchmark_availability: [], per_account: [{ platform: 'ibkr', account_alias: 'fictional-native', status: 'partial', return_kind: 'twr', points: [{ date: '2026-10-26', value: 0 }] }] } };
    const returns = ui.returns(language);
    assert.ok(returns.includes('fictional-native'));
    assert.ok(returns.includes(language === 'zh' ? '不代表全部账户的组合收益' : 'not returns for the full portfolio'));
    globalThis.__mobileState = { phase: 'ready', data: { status: 'no_data', unavailable_reason: 'snapshot_history_missing', cells: [], as_of: null } };
    const calendar = ui.calendar(language);
    assert.ok(calendar.includes(language === 'zh' ? '缺少历史资产快照' : 'Historical asset snapshots are missing'));
  }
  const css = await readFile(join(root, 'src/pages/performance/performance.css'), 'utf8');
  assert.match(css, /\.holdings-view \.data-table \{ min-width: 920px; \}/);
  assert.match(css, /white-space: nowrap; overflow-wrap: normal; word-break: normal/);
  console.log('website_mobile_gaps_validation: PASS (zh/en holdings, ranking, coverage, native returns, calendar, unknown credentials, strategy assignment/freshness; synthetic only)');
} finally { delete globalThis.__mobileState; await rm(directory, { recursive: true, force: true }); }
