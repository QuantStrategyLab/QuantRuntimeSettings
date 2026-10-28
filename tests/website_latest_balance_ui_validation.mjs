import assert from 'node:assert/strict';
import { build } from '../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Synthetic balances and identities only; no account/financial source is read.
const root = new URL('../web/strategy-switch-console/frontend/', import.meta.url).pathname;
const directory = await mkdtemp(join(tmpdir(), 'latest-balance-ui-'));
try {
  const outfile = join(directory, 'render.cjs');
  await build({stdin:{resolveDir:root,contents:`
    import { createElement as h } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { I18nProvider } from './src/i18n';
    import { PrefsContext } from './src/app/context';
    import { DEFAULT_PREFERENCES } from './src/lib/prefs';
    import { CurrencyTotals } from './src/components/CurrencyTotals';
    export const render = (language, totals, hideAmounts=false) => renderToStaticMarkup(h(I18nProvider,{language},h(PrefsContext.Provider,{value:{prefs:{...DEFAULT_PREFERENCES,language,hideAmounts},resolvedTheme:'light',setPrefs(){}}},h(CurrencyTotals,{totals}))));
  `},bundle:true,platform:'node',format:'cjs',outfile,jsx:'automatic',loader:{'.css':'empty'},define:{'import.meta.env':'{}'},logLevel:'silent'});
  const ui = createRequire(import.meta.url)(outfile);
  const accounts = Array.from({length:8},(_,index)=>({platform:'fictional',account_alias:`fictional-${index+1}`,account_ref:`opaque-${index+1}`,included:true,observation_date:index<5?'2026-10-27':'2026-10-28',as_of:index<5?'2026-10-27T10:00:00Z':'2026-10-28T00:00:00Z',freshness:'fresh',fresh:true,stale:false,unavailable_reason:null}));
  const total = {currency:'USD',total:800,account_count:8,expected_account_count:8,excluded_account_count:0,as_of:accounts[0].as_of,latest_as_of:accounts[7].as_of,observation_date:null,stale:false,status:'ok',unavailable_reason:null,account_coverage:accounts};
  for(const language of ['zh','en']) {
    const html=ui.render(language,[total]);
    assert.ok(html.includes(language==='zh'?'USD 最近已知余额合计':'USD latest known balance total'));
    assert.ok(html.includes('USD 800.00'));
    assert.ok(html.includes(language==='zh'?'已计入 8/8 个账户':'Includes 8 of 8 accounts'),'full coverage remains visible across asynchronous updates');
    assert.ok(!html.includes(language==='zh'?'可能包含环境待确认账户':'May include accounts with unconfirmed environments'),'internal audit copy is not shown');
    assert.ok(html.includes(language==='zh'?'最早数据':'Earliest data'));
    assert.ok(html.includes(language==='zh'?'最晚数据':'Latest data'));
    assert.ok(html.includes('2026-10-27')&&html.includes('2026-10-28'),'individual native observation dates are retained');
    assert.equal((html.match(/data-status="fresh"/g)||[]).length,8,'every included fresh account has an explicit freshness label');
    assert.doesNotMatch(html,/valuation_date_mismatch|估值日期不同|different valuation dates|opaque-/,'no same-day exclusion or opaque source identifier is rendered');
    const partial=ui.render(language,[{...total,total:700,account_count:7,excluded_account_count:1,stale:true,status:'partial',unavailable_reason:'snapshot_stale',account_coverage:accounts.map((account,index)=>index===0?{...account,included:false,freshness:'stale',fresh:false,stale:true,unavailable_reason:'snapshot_stale'}:account)}]);
    assert.ok(partial.includes(language==='zh'?'USD 最近已知余额小计':'USD latest known balance subtotal'));
    assert.ok(partial.includes(language==='zh'?'已计入 7/8 个账户':'Includes 7 of 8 accounts'));
    assert.ok(partial.includes(language==='zh'?'未计入':'Excluded'));
    assert.ok(partial.includes('data-status="stale"'));
    const stale=ui.render(language,[{...total,status:'stale',stale:true}]);
    const meta=stale.slice(stale.indexOf('class="currency-meta"'),stale.indexOf('<details'));
    assert.equal((meta.match(/data-status="stale"/g)||[]).length,1,'the total freshness badge is not repeated');
    const empty=ui.render(language,[{...total,total:null,status:'unavailable',account_count:0,as_of:null,latest_as_of:null,account_coverage:[]}]);
    assert.ok(empty.includes('—'));
    assert.ok(!empty.includes('USD 0.00'),'missing balances never become zero');
    const zero=ui.render(language,[{...total,total:0,account_count:1,expected_account_count:1,as_of:accounts[0].as_of,latest_as_of:accounts[0].as_of,account_coverage:[accounts[0]]}]);
    assert.ok(zero.includes('USD 0.00'),'an explicitly reported zero is preserved');
    assert.ok(zero.includes(language==='zh'?'余额数据':'Balance data'));
    assert.ok(!zero.includes(language==='zh'?'最晚数据':'Latest data'),'equal endpoints use one source-time label');
    const masked=ui.render(language,[total],true);
    assert.ok(masked.includes('•••')&&!masked.includes('800.00'),'known balances obey amount privacy');
    const {latest_as_of,...legacy}=total;
    const old=ui.render(language,[legacy]);
    assert.ok(old.includes(language==='zh'?'USD 资产合计':'USD asset total'));
    assert.ok(!old.includes(language==='zh'?'可能包含环境待确认账户':'May include accounts with unconfirmed environments'),'legacy totals do not receive the latest-balance note');
    assert.ok(!old.includes(language==='zh'?'最晚数据':'Latest data'),'older interfaces retain their single source-time rendering');
    assert.doesNotMatch(html,/perf\.|reason\.|state\./);
  }
  console.log('website_latest_balance_ui_validation: PASS (zh/en latest known balances, 8/8 asynchronous coverage, source range, fresh/stale/unknown/zero/masking, legacy DTO)');
} finally {await rm(directory,{recursive:true,force:true});}
