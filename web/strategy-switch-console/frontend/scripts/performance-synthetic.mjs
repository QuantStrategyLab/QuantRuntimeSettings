// Dev-only fictional data, never imported into a production bundle.
export function performanceFixture(path, query, scenario, now = Date.now()) {
  if (!scenario.startsWith('performance')) return undefined;
  const empty = scenario === 'performance-empty';
  const end = now - (scenario === 'performance-stale' ? 10 : 0) * 86400000;
  const dates = Array.from({length:7},(_,i)=>new Date(end-(6-i)*86400000).toISOString().slice(0,10));
  const options = ['alpha','beta'].map(key=>({key:`synthetic-${key}`,label:`Synthetic ${key}`,broker_environment:'live',target_name:`synthetic-${key}`,default_strategy_profile:'demo-profile-1'}));
  const facts = options.map((a,i)=>({platform:'longbridge',account_key:a.key,binding_status:'bound',identity_status:'partial_identity',identity_mismatch:false,data_status:'fresh',aggregation_status:'included',account_scope:'live',broker_environment:'live',observed_finished_at:new Date(now).toISOString(),balances:[{currency:'USD',net_assets:String(1000*(i+1)),total_cash:'100'}],cash:[{currency:'USD',available_cash:'100'}],holdings:[],return:{status:'unavailable'}}));
  if(path==='/api/config') return {accountOptions:{longbridge:options},platformMeta:{longbridge:{label:'LongBridge',console_visible:true}},currentStrategies:{longbridge:Object.fromEntries(options.map(a=>[a.key,{strategy_profile:'demo-profile-1',runtime_target_enabled:false}]))},strategyProfiles:[{profile:'demo-profile-1',label_en:'Synthetic strategy',label_zh:'合成策略',domain:'us_equity'}]};
  if(path==='/api/account-facts') return {ok:true,accounts:facts,summary:{}};
  if(path==='/api/overview-fx') return {base:'USD',rates:{HKD:8,SGD:1.5}};
  if(path==='/api/market-benchmark') return {ok:true,inception_date:'2026-10-09',points:empty?[]:['标普500','纳斯达克100','道琼斯工业平均指数','罗素2000'].flatMap((seriesId,j)=>dates.filter((_,i)=>!(j===2&&i===3)).map((date,i)=>({seriesId,observationDate:date,close:String(100+i*(j+1)*.7)})))};
  if(path==='/api/account-facts/history') {
    const key=query.get('account_key');
    if(scenario==='performance-partial'&&key==='synthetic-beta') return {status:503,body:{error:'synthetic_missing_history'}};
    return {ok:true,platform:'longbridge',account_key:key,identity_mismatch:false,series:{currency:'USD',truncated:false,points:empty?[]:dates.map((date,i)=>({observation_date:date,currency:'USD',net_assets:String((key==='synthetic-beta'?2000:1000)*(1+i*.013)),total_cash:'100'}))}};
  }
  return undefined;
}
