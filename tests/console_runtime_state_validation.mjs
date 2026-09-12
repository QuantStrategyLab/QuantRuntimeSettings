import { githubVariableListMock } from './helpers/github_variable_list_mock.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import worker, { __test } from '../web/strategy-switch-console/worker.js';
import { normalizeAccountOptionsPayload as normalizeAccountSchema } from '../web/strategy-switch-console/account_options_schema.js';

const source = readFileSync(new URL('../web/strategy-switch-console/app.js', import.meta.url), 'utf8');
function frontendFunction(name, context) {
  const start = source.indexOf(`    function ${name}(`);
  assert.ok(start >= 0);
  const next = source.slice(start + 1).search(/\n    (?:async )?function /);
  const end = next < 0 ? source.length : start + 1 + next;
  return vm.runInNewContext(`(${source.slice(start, end).trim()})`, context);
}
const cleanOptionalBoolean = (value) => typeof value === 'boolean' ? value : null;
test('account persistence preserves explicit observation and variable-source bindings', () => {
  const source = { ibkr: [{ key: 'fixture', label: 'Fixture', target_name: 'fixture', supported_domains: ['us_equity'],
    runtime_status_target_id: 'ibkr.fixture', github_environment: 'fixture-environment', variable_scope: 'environment' }] };
  assert.deepEqual(normalizeAccountSchema(source), source);
});

test('account schema preserves an explicit broker environment without inferring missing values', () => {
  const normalized = normalizeAccountSchema({
    longbridge: [{
      key: 'paper', label: 'Paper', target_name: 'paper', supported_domains: ['us_equity'],
      broker_environment: 'paper', default_execution_mode: 'live',
    }],
    ibkr: [{ key: 'legacy', label: 'Legacy', target_name: 'legacy', supported_domains: ['us_equity'] }],
  });
  assert.equal(normalized.longbridge[0].broker_environment, 'paper');
  assert.equal(normalized.longbridge[0].default_execution_mode, 'live');
  assert.equal('broker_environment' in normalized.ibkr[0], false);
  assert.throws(() => normalizeAccountSchema({
    longbridge: [{ key: 'bad', label: 'Bad', target_name: 'bad', supported_domains: ['us_equity'], broker_environment: 'sandbox' }],
  }), /broker_environment/);
});
for (const [mode, expected] of [[undefined, false], ['current', false], ['none', true], ['floor', true]]) {
  test(`cash preview preserves current policy unless explicitly overridden: ${mode}`, () => {
    const fn = frontendFunction('pendingReservePolicy', {
      currentReservePolicyForAccount: () => ({ minReservedCashUsd: '100', reservedCashRatio: '0.1' }),
      currentEntryForAccount: () => ({}),
      cleanDisplayNumber: value => String(value ?? ''),
      cleanDisplayRatio: value => String(value ?? ''),
      normalizeReservePolicyMode: value => value || 'current',
    });
    assert.equal(fn({ reserved_cash_policy_mode: mode }, 'ibkr', {}).changed, expected);
  });
}
for (const value of [undefined, true, false]) {
  test(`frontend does not invent enabled: ${value}`, () => {
    const fn = frontendFunction('runtimeTargetStateForAccount', {
      currentEntryForAccount: () => ({ strategy_profile: 'example', runtime_target_enabled: value }),
      cleanOptionalBoolean,
    });
    const result = fn('ibkr', {});
    assert.equal(result.known, value !== undefined);
    assert.equal(result.enabled, value ?? null);
  });
}
test('account routing defaults do not become runtime observations', () => {
  const fn = frontendFunction('currentEntryForAccount', {
    state: { currentStrategies: {} }, resolveCurrentEntryByKey: () => null,
    window: { __DEFAULT_ACCOUNT_OPTIONS__: { ibkr: [{ runtime_target_enabled: true }] } },
    platformConfig: {}, platformSupportsMarginPolicy: () => false, cleanOptionalBoolean,
  });
  assert.equal(fn('ibkr', { key: 'example' }).runtime_target_enabled ?? null, null);
});

for (const sample of [
  { name: 'repo disabled fallback', scoped: false, expected: false },
  { name: 'explicit target enabled', target: true, scoped: false, expected: true },
  { name: 'explicit target disabled', target: false, scoped: true, expected: false },
  { name: 'environment enabled', environment: true, scoped: true, expected: true },
  { name: 'missing remains unknown', expected: undefined },
  { name: 'nested service env enabled beats repo disabled', nested: true, scoped: false, expected: true },
  { name: 'nested service env disabled beats repo enabled', nested: false, scoped: true, expected: false },
  { name: 'top-level service override beats nested env', target: false, nested: true, scoped: true, expected: false },
]) {
  test(sample.name, async () => {
    const original = globalThis.fetch;
    globalThis.fetch = githubVariableListMock(async (url) => {
      const path = String(url);
      let value;
      if (path.endsWith('/CLOUD_RUN_SERVICE_TARGETS_JSON')) value = JSON.stringify({ targets: [{
        service: 'example-service',
        ...(sample.nested === undefined ? {} : { env: {
          RUNTIME_TARGET_ENABLED: String(sample.nested),
          IBKR_CASH_ONLY_EXECUTION: 'false', IBKR_RESERVED_CASH_RATIO: '0.07',
          INCOME_LAYER_ENABLED: 'true', OPTION_OVERLAY_ENABLED: 'false',
        } }),
        ...(sample.target === undefined ? {} : { RUNTIME_TARGET_ENABLED: String(sample.target) }),
        runtime_target: { platform_id: 'ibkr', strategy_profile: 'tqqq_growth_income',
          service_name: 'example-service', account_scope: 'example' },
      }] });
      else if (path.endsWith('/RUNTIME_TARGET_ENABLED')) {
        if (sample.environment) {
          value = path.includes('/environments/example/') ? String(sample.scoped) : 'false';
        } else if (sample.scoped !== undefined) value = String(sample.scoped);
      }
      return value === undefined ? new Response('', { status: 404 })
        : Response.json({ value });
    });
    try {
      const result = await __test.loadCurrentStrategies({ ibkr: [{
        key: 'example', target_name: 'example', service_name: 'example-service', account_scope: 'example',
        ...(sample.environment ? { variable_scope: 'environment', github_environment: 'example' } : {}),
      }] }, { RUNTIME_SETTINGS_DISPATCH_TOKEN: 'synthetic-only' });
      assert.equal(result.ibkr.example.runtime_target_enabled, sample.expected);
      if (sample.nested !== undefined) {
        assert.equal(result.ibkr.example.cash_only_execution, false);
        assert.equal(result.ibkr.example.reserved_cash_ratio, '0.07');
        assert.equal(result.ibkr.example.income_layer_enabled, true);
        assert.equal(result.ibkr.example.option_overlay_enabled, false);
      }
    } finally { globalThis.fetch = original; }
  });
}

test('loading an account never silently prepares an enable override', () => {
  for (const configured of [undefined, true, false]) {
    const form = { runtimeTargetTouched: false };
    const fn = frontendFunction('syncRuntimeTargetForAccount', {
      state: { forms: { ibkr: form } }, selectedAccount: () => ({}),
      runtimeTargetEnabledForAccount: () => configured ?? null,
    });
    fn('ibkr');
    assert.equal(form.runtimeTargetMode, 'current');
  }
});

for (const sample of [
  { name: 'signed out', ready: true, allowed: false, available: true, login: null, message: 'loginDescription' },
  { name: 'session unavailable', ready: true, allowed: false, available: false, login: null, message: 'loginUnavailable' },
  { name: 'access denied', ready: true, allowed: false, available: true, login: 'example', message: 'loginDenied' },
  { name: 'signed in', ready: true, allowed: true, available: true, login: 'example', message: 'loginDenied' },
  { name: 'loading', ready: false, allowed: false, available: false, login: null, message: 'loginUnavailable' },
]) {
  test(`private shell visibility: ${sample.name}`, () => {
    const nodes = {};
    const el = (id) => nodes[id] ??= {};
    const render = frontendFunction('renderAppVisibility', {
      state: { appReady: sample.ready, auth: sample, bootMessageKey: 'loading' },
      document: { body: { classList: { toggle() {} } } }, el, t: (key) => key,
    });
    render();
    assert.equal(el('app-shell').hidden, !sample.ready || !sample.allowed);
    assert.equal(el('login-screen').hidden, !sample.ready || sample.allowed);
    assert.equal(el('login-message').textContent, sample.message);
  });
}

for (const hidden of ['', 'qmt', 'qmt,binance']) {
  test(`console visibility is deployment configuration only: ${hidden || 'all visible'}`, async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response('', { status: 503 });
    try {
      const meta = await __test.loadPlatformMeta({ STRATEGY_SWITCH_HIDDEN_PLATFORMS: hidden });
      assert.equal(meta.qmt.console_visible, !hidden.includes('qmt'));
      assert.equal(meta.binance.console_visible, !hidden.includes('binance'));
      assert.equal(meta.ibkr.console_visible, true);
      assert.equal(Object.keys(meta).length, 6);
    } finally { globalThis.fetch = original; }
  });
}


test('admin page CSP permits only its own inline script and style', async () => {
  const env = {
    SESSION_SECRET: 'synthetic-admin-session', STRATEGY_SWITCH_ADMIN_LOGINS: 'operator',
    STRATEGY_SWITCH_CONFIG: { get: async () => null, put: async () => {} },
  };
  const cookie = await __test.makeSession('operator', [], env);
  const response = await worker.fetch(new Request('https://switch.example/admin', {
    headers: { Cookie: `qsl_switch_session=${cookie}` },
  }), env);
  assert.equal(response.status, 200);
  const html = await response.text();
  const csp = response.headers.get('Content-Security-Policy');
  const nonce = html.match(/<script nonce="([a-zA-Z0-9]+)">/)?.[1];
  assert.ok(nonce);
  assert.ok(html.includes(`<style nonce="${nonce}">`));
  assert.ok(csp.includes(`script-src 'self' 'nonce-${nonce}'`));
  assert.ok(csp.includes(`style-src 'self' 'nonce-${nonce}'`));
  assert.ok(!csp.includes('unsafe-inline'));
});

for (const sample of [
  { name: 'fresh and ready', control: 'ready', queue: 'ready', freshness: 'fresh', intent: null, expected: true },
  { name: 'already confirmed', control: 'ready', queue: 'ready', freshness: 'fresh', intent: { decision: 'keep_parked' }, expected: false },
  { name: 'stale candidate', control: 'ready', queue: 'ready', freshness: 'stale', intent: null, expected: false },
  { name: 'stale control plane', control: 'stale', queue: 'ready', freshness: 'fresh', intent: null, expected: false },
  { name: 'owner queue unavailable', control: 'ready', queue: 'unavailable', freshness: 'fresh', intent: null, expected: false },
]) {
  test(`only current P6 evidence becomes an owner action: ${sample.name}`, () => {
    const fn = frontendFunction('candidateNeedsOperatorAction', {
      state: { controlPlane: { payload: { data_status: sample.control } }, ownerDecisions: { data_status: sample.queue } },
      ownerDecisionEntry: () => ({ intent: sample.intent }),
    });
    assert.equal(fn({
      lifecycle: { stage: 'P6', status: 'owner_decision_required' },
      recommendation: { code: 'owner_live_decision' },
      freshness: { status: sample.freshness },
    }), sample.expected);
  });
}

test('a parked AIAudit research result stays outside the owner-action queue', () => {
  const action = frontendFunction('candidateNeedsOperatorAction', {
    state: { controlPlane: { payload: { data_status: 'ready' } }, ownerDecisions: { data_status: 'ready' } },
    ownerDecisionEntry: () => null,
  });
  const visible = frontendFunction('candidateIsControlPlaneVisible', {
    candidateNeedsOperatorAction: action,
    isParkedResearchResult: frontendFunction('isParkedResearchResult'),
  });
  const candidate = {
    source_id: 'aiaudit.soxl_manual_validation',
    lifecycle: { stage: 'P3', status: 'parked' },
    recommendation: { code: 'park' },
    evidence: { p3_evidence_id: '34407783620' },
  };
  assert.equal(action(candidate), false);
  assert.equal(visible(candidate), false);
  assert.equal(frontendFunction('isParkedResearchResult')(candidate), true);
});

test('stale research material is not presented as a read failure', () => {
  const classify = frontendFunction('controlPlaneSourceCondition', {});
  assert.equal(JSON.stringify(classify(
    { data_status: 'stale', errors: ['source_stale', 'p3_parked', 'decision_data_projection_parked'] },
    { data_status: 'stale', errors: ['control_plane_not_ready'] },
    { data_status: 'ready', errors: [] },
  )), JSON.stringify({ status: 'stale', unavailable: false, stale: true, needsReview: true }));
  assert.equal(JSON.stringify(classify(
    { data_status: 'unavailable', errors: ['control_plane_request_failed'] },
    { data_status: 'ready', errors: [] },
    { data_status: 'ready', errors: [] },
  )), JSON.stringify({ status: 'unavailable', unavailable: true, stale: false, needsReview: true }));
});

test('only the explicit AIAudit SOXL validation source gets a run link', () => {
  const fn = frontendFunction('parkedResearchResultSourceUrl', {
    isParkedResearchResult: frontendFunction('isParkedResearchResult'),
  });
  assert.equal(
    fn({ source_id: 'aiaudit.soxl_manual_validation', lifecycle: { stage: 'P3', status: 'parked' }, recommendation: { code: 'park' }, evidence: { p3_evidence_id: '34407783620' } }),
    'https://github.com/QuantStrategyLab/AIAuditBridge/actions/runs/34407783620',
  );
  assert.equal(fn({ source_id: 'uesp.soxl_daily_research', evidence: { p3_evidence_id: '34407783620' } }), '');
  assert.equal(fn({ source_id: 'aiaudit.soxl_manual_validation', evidence: { p3_evidence_id: 'not-a-run' } }), '');
});

test('parked research results preserve the source reason and use a neutral fallback', () => {
  const fn = frontendFunction('parkedResearchResultReason', {
    t: key => ({ parkedResearchResultFallback: 'validation retained' })[key],
  });
  assert.equal(fn({ recommendation: { reason: 'Drawdown improvement was insufficient for the selected objective.' } }), 'Drawdown improvement was insufficient for the selected objective.');
  assert.equal(fn({ recommendation: { reason: '   ' } }), 'validation retained');
});

test('all platforms remain readable within the Worker external request budget', async () => {
  const original = globalThis.fetch;
  let requests = 0;
  const options = {
    longbridge: ['hk', 'sg', 'paper'].map(key => ({ key, target_name: key })),
    ibkr: [0, 1, 2, 3].map(i => ({ key: `example-${i}`, target_name: `example-${i}` })),
    schwab: [{ key: 'default', target_name: 'default' }],
    firstrade: [{ key: 'default', target_name: 'default' }],
    binance: [{ key: 'default', target_name: 'default' }],
  };
  globalThis.fetch = async url => {
    if (++requests > 50) throw new Error('Too many subrequests');
    const path = new URL(url).pathname;
    if (path.endsWith('/variables')) return Response.json({ total_count: 1,
      variables: [{ name: 'RUNTIME_TARGET_ENABLED', value: 'false' }] });
    return path.endsWith('/RUNTIME_TARGET_ENABLED') ? Response.json({ value: 'false' })
      : new Response('', { status: 404 });
  };
  try {
    const result = await __test.loadCurrentStrategies(options, { RUNTIME_SETTINGS_DISPATCH_TOKEN: 'synthetic-only' });
    for (const [platform, accounts] of Object.entries(options)) {
      for (const account of accounts) assert.equal(result[platform]?.[account.key]?.runtime_target_enabled, false, platform);
    }
    assert.ok(requests <= 10, `expected scoped bulk reads, got ${requests}`);
  } finally { globalThis.fetch = original; }
});

for (const secondPageStatus of [200, 403, 404, 429, 500]) {
  test(`paginated variable reads are complete or unknown: ${secondPageStatus}`, async () => {
    const original = globalThis.fetch;
    const requested = [];
    globalThis.fetch = async url => {
      const request = new URL(url);
      requested.push(request);
      assert.equal(request.origin, 'https://api.github.com');
      assert.equal(request.pathname, '/repos/QuantStrategyLab/FirstradePlatform/actions/variables');
      if (request.searchParams.get('page') === '1') return Response.json({ total_count: 31,
        variables: Array.from({ length: 30 }, (_, i) => ({ name: `EXAMPLE_${i}`, value: 'unused' })),
      }, { headers: { Link: '<https://untrusted.example/next>; rel="next"' } });
      return secondPageStatus === 200 ? Response.json({ total_count: 31,
        variables: [{ name: 'RUNTIME_TARGET_ENABLED', value: 'false' }],
      }) : new Response('', { status: secondPageStatus });
    };
    try {
      const result = await __test.loadCurrentStrategies({ firstrade: [{ key: 'default', target_name: 'default' }] },
        { RUNTIME_SETTINGS_DISPATCH_TOKEN: 'synthetic-only' });
      assert.equal(result.firstrade?.default?.runtime_target_enabled, secondPageStatus === 200 ? false : undefined);
      assert.equal(requested.length, 2, 'failed pages must not trigger retries or per-variable fallback');
    } finally { globalThis.fetch = original; }
  });
}

test('failed variable-list page never publishes a partial configuration', async () => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    if (++requests > 1) throw new Error('synthetic timeout');
    return Response.json({ total_count: 2, variables: [{ name: 'RUNTIME_TARGET_ENABLED', value: 'true' }] },
      { headers: { Link: '<https://api.github.com/example?page=2>; rel="next"' } });
  };
  try {
    const result = await __test.loadCurrentStrategies({ binance: [{ key: 'default', target_name: 'default' }] },
      { RUNTIME_SETTINGS_DISPATCH_TOKEN: 'synthetic-only' });
    assert.equal(result.binance, undefined);
    assert.equal(requests, 2);
  } finally { globalThis.fetch = original; }
});

test('console account metadata preserves an explicit monitoring reference', () => {
  const options = __test.normalizeAccountOptionsPayload({ ibkr: [{key:'example',target_name:'example',runtime_status_target_id:'ibkr.monitor-a'}] },'fixture');
  assert.equal(options.ibkr[0].runtime_status_target_id,'ibkr.monitor-a');
});

for (const scenario of ['ready','stale','missing','wrong-platform','duplicate-source','duplicate-account','unlinked']) {
  test(`account monitoring match is exact and read-only: ${scenario}`, () => {
    const account={key:'a', runtime_status_target_id:scenario==='unlinked'?'':'ibkr.monitor-a'};
    const entry={freshness:{data_status:scenario==='stale'?'stale':'ready'},target:{target_id:'ibkr.monitor-a',target:{platform:scenario==='wrong-platform'?'binance':'ibkr'},monitoring:{},disposition:{}},execution_observation:{code:'monitoring_only'}};
    const targets=scenario==='missing'?[]:scenario==='duplicate-source'?[entry,entry]:[entry];
    const fn=frontendFunction('accountMonitoringRecord',{state:{auth:{allowed:true},runtimeTargetLifecycle:{payload:{targets}}},optionsFor:()=>scenario==='duplicate-account'?[account,{...account,key:'b'}]:[account]});
    const result=fn('ibkr',account);
    assert.equal(Boolean(result),scenario==='ready'||scenario==='stale');
    if(result) assert.equal(result.execution_observation.code,'monitoring_only');
  });
}

for (const scenario of [
  {name:'no visible candidate',allowed:true,candidates:[],pending:false,visible:true},
  {name:'human decision',allowed:true,candidates:[{}],pending:true,visible:true},
  {name:'forward-only signed out',allowed:false,candidates:[{forward_observation:{}}],pending:false,visible:false},
  {name:'forward-only signed in',allowed:true,candidates:[{forward_observation:{}}],pending:false,visible:true},
]) {
  test(`control-plane visibility: ${scenario.name}`, () => {
    const nodes=Object.fromEntries(['switch-view','health-view','control-plane-view'].map(id=>[id,{hidden:false}]));
    const fn=frontendFunction('renderConsoleView',{
      el:id=>nodes[id],
      state:{auth:{allowed:scenario.allowed},controlPlane:{payload:{candidates:scenario.candidates}}},
      candidateIsControlPlaneVisible:item=>scenario.pending||Boolean(item?.forward_observation),
    });
    fn();
    assert.equal(nodes['switch-view'].hidden,false);
    assert.equal(nodes['health-view'].hidden,true);
    assert.equal(nodes['control-plane-view'].hidden,!scenario.visible);
  });
}

test('browsing compatible strategies does not require live authorization', () => {
  const catalog = {candidate:{profile:'candidate',domain:'us_equity'},foreign:{profile:'foreign',domain:'crypto'}};
  const context = {strategyOptions:Object.keys(catalog),cleanStrategyProfile:x=>x,strategyCatalogEntry:x=>catalog[x]||{},
    dcaConfigForStrategy:()=>null,platformSupportsDca:()=>false,supportedDomainsForAccount:()=>['us_equity'],
    strategyAllowedForAccount:()=>false};
  context.strategyCompatibleWithAccount = frontendFunction('strategyCompatibleWithAccount',context);
  const choices = frontendFunction('strategyChoicesForAccount',context);
  assert.deepEqual(Array.from(choices('schwab',{},'live')),['candidate']);
});

test('browsing a candidate does not make it runnable', () => {
  const context={cleanStrategyProfile:x=>x,strategyCatalogEntry:()=>({profile:'candidate',domain:'us_equity',runtime_enabled:false}),
    strategyCompatibleWithAccount:()=>true,dcaConfigForStrategy:()=>null,platformSupportsDca:()=>false,
    supportedDomainsForAccount:()=>['us_equity'],normalizeExecutionMode:x=>x,supportedExecutionModesForPlatform:()=>['live','dry_run'],
    strategyCanSwitchLive:()=>false};
  assert.equal(frontendFunction('strategyAllowedForAccount',context)('schwab',{},'candidate','live'),false);
});

test('operator page has no engineering diagnostics entry point', () => {
  const html=readFileSync(new URL('../web/strategy-switch-console/index.html',import.meta.url),'utf8');
  assert.doesNotMatch(html,/id="open-system-status"/);
  assert.match(html,/<details[^>]+id="health-view"[^>]+hidden/);
});

for (const sample of [
  {configured:true,record:'disabled',fresh:'ready',expected:'monitoringConfigMismatch'},
  {configured:false,record:'enabled',fresh:'ready',expected:'monitoringConfigMismatch'},
  {configured:true,record:'disabled',fresh:'stale',expected:'controlDataStale'},
  {configured:false,record:'disabled',fresh:'ready',expected:'not_applicable'},
]) test(`monitoring compares saved configuration without inventing runtime: ${JSON.stringify(sample)}`,()=>{
  const fn=frontendFunction('accountMonitoringText',{
    accountMonitoringRecord:()=>({freshness:{data_status:sample.fresh},target:{target:{configured_state:sample.record}},execution_observation:{code:'not_applicable'}}),
    runtimeTargetStateForAccount:()=>({known:true,enabled:sample.configured}),t:x=>x,runtimeTargetLifecycleObservationLabel:x=>x,
  });
  assert.equal(fn('ibkr',{}),sample.expected);
});

test('Binance without an explicit market uses crypto, not US equities',()=>{
  assert.deepEqual(Array.from(frontendFunction('inferSupportedDomains',{})('binance',{})),['crypto']);
});

test('only current complete recovery evidence becomes an action',()=>{
  const context={state:{reconciliationRecovery:{payload:{data_status:'ready'}}}};
  const ready={freshness:{data_status:'ready'},recovery:{readiness:'awaiting_human_confirmation',blocker_codes:[],candidate_sha256:'a',dual_review:{evidence_binding_sha256:'a'}}};
  const needs=frontendFunction('recoveryNeedsOperatorAction',context);
  assert.equal(needs(ready),true);
  assert.equal(needs({...ready,confirmation:{}}),false);
  assert.equal(needs({...ready,freshness:{data_status:'stale'}}),false);
  assert.equal(needs({...ready,recovery:{...ready.recovery,readiness:'blocked'}}),false);
  assert.equal(needs({...ready,recovery:{...ready.recovery,blocker_codes:['missing_sample']}}),false);
  assert.equal(needs({...ready,recovery:{...ready.recovery,dual_review:{evidence_binding_sha256:'b'}}}),false);
  context.state.reconciliationRecovery.payload.data_status='stale';
  assert.equal(needs(ready),false);
  const access=frontendFunction('recoveryConfirmationAvailableToCurrentUser',{recoveryNeedsOperatorAction:()=>true,state:{auth:{admin:false}}});
  assert.equal(access(ready),false);
  assert.equal(frontendFunction('recoveryConfirmationAvailableToCurrentUser',{recoveryNeedsOperatorAction:()=>true,state:{auth:{admin:true}}})(ready),true);
  const html=readFileSync(new URL('../web/strategy-switch-console/index.html',import.meta.url),'utf8');
  assert.ok(html.indexOf('id="reconciliation-recovery-board"')<html.indexOf('id="health-view"'));
});

for (const observation of [
  {runtime_enabled:false,scheduler_state:'paused',strategy_profile:'example',execution_mode:'live'},
  {runtime_enabled:null,scheduler_state:'unknown',strategy_profile:null,execution_mode:null},
]) test('deployment observation survives Worker normalization without inferred values '+JSON.stringify(observation),()=>{
  const target={target_id:'example',target:{platform:'ibkr',configured_state:'disabled',execution_mode:'live'},
    monitoring:{runtime_guard:'pass',execution_heartbeat:'not_applicable'},
    disposition:{code:'continue_disabled_validation',reason_code:'target_intentionally_disabled'},no_order:true};
  assert.deepEqual(__test.normalizeRuntimeTargetLifecycleTarget({...target,deployment:observation},'test').deployment,observation);
  assert.equal(__test.normalizeRuntimeTargetLifecycleTarget(target,'test').deployment,undefined);
  assert.throws(()=>__test.normalizeRuntimeTargetLifecycleTarget({...target,deployment:{...observation,runtime_enabled:'false'}},'test'));
  assert.throws(()=>__test.normalizeRuntimeTargetLifecycleTarget({...target,deployment:{...observation,raw_cloud_id:'private'}},'test'));
});

for (const scenario of ['missing','stale','true','false']) test(`actual deployment never falls back to saved settings: ${scenario}`,()=>{
  const record=scenario==='missing'?null:{freshness:{data_status:scenario==='stale'?'stale':'ready'},target:{deployment:{runtime_enabled:scenario==='true',scheduler_state:'paused'}}};
  const fn=frontendFunction('accountDeploymentObservation',{accountMonitoringRecord:()=>record});
  assert.equal(fn('ibkr',{})?.runtime_enabled ?? null,scenario==='missing'||scenario==='stale'?null:scenario==='true');
});

for (const sample of [
 {enabled:true,schedule:'paused',desired:true,profile:'example',expected:'scheduleNotApplied'},
 {enabled:false,schedule:'paused',desired:true,profile:'example',expected:'settingsNotApplied'},
 {enabled:true,schedule:'enabled',desired:true,profile:'other',expected:'strategyNotApplied'},
 {enabled:true,schedule:'enabled',desired:true,profile:'example',expected:'switchesApplied'},
 {enabled:false,schedule:'paused',desired:false,profile:'example',expected:'switchesApplied'},
]) test('application status requires deployment and scheduler agreement '+JSON.stringify(sample),()=>{
 const fn=frontendFunction('accountApplicationText',{accountDeploymentObservation:()=>({runtime_enabled:sample.enabled,scheduler_state:sample.schedule,strategy_profile:sample.profile}),
 runtimeTargetStateForAccount:()=>({known:true,enabled:sample.desired}),currentStrategyForAccount:()=> 'example',t:x=>x});
 assert.equal(fn('ibkr',{}),sample.expected);
});

test('account details keep saved, deployed and application state separate', () => {
  const html = readFileSync(new URL('../web/strategy-switch-console/index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../web/strategy-switch-console/app.js', import.meta.url), 'utf8');
  assert.ok(html.includes('data-i18n="configuredSwitch"'));
  assert.ok(html.includes('class="account-facts"'));
  assert.ok(app.includes('["deployedSwitch", accountDeploymentText(platform, account)]'));
  assert.ok(app.includes('["applicationStatus", application]'));
  const overview = app.slice(app.indexOf('function renderAccountOverview'), app.indexOf('function renderControls'));
  assert.ok(overview.includes('runtimeOverviewStatus(saved, application === t("switchesApplied"), record, configurationMismatch)'));
  assert.ok(overview.includes('accountDeploymentText(platform, account)'));
  assert.ok(overview.includes('accountApplicationText(platform, account)'));
});

test('legacy lifecycle alias with explicit live flags is not downgraded by the browser',()=>{
 const normalize=frontendFunction('normalizeLifecycleStage',{});
 const fn=frontendFunction('strategyCanSwitchLive',{normalizeAllowedExecutionModes:x=>x,cleanOptionalBoolean:x=>x,normalizeLifecycleStage:normalize,cleanDisplayText:x=>x||''});
 const entry={runtime_enabled:true,can_switch_live:true,allowed_execution_modes:['live'],lifecycle_stage:'runtime_enabled'};
 assert.equal(fn(entry),true);
 assert.equal(fn({...entry,can_switch_live:false}),false);
});

test('fresh publication cannot refresh an old runtime report',()=>{
 const record={freshness:{data_status:'ready',age_seconds:1},deployment_freshness:{data_status:'stale',age_seconds:172800},target:{deployment:{runtime_enabled:true}}};
 const fn=frontendFunction('accountDeploymentObservation',{accountMonitoringRecord:()=>record});
 assert.equal(fn('binance',{}),null);
 const age=frontendFunction('accountMonitoringAge',{Intl,state:{lang:'en'}});
 assert.equal(age(record),'2 days ago');
});



test('promotion confirmation uses the selected account mode as read-only context', () => {
  const html = readFileSync(new URL('../web/strategy-switch-console/index.html', import.meta.url), 'utf8');
  assert.ok(html.includes('id="promotion-decision-panel"'));
  assert.ok(html.includes('id="promotion-confirm-block"'));
  assert.ok(html.includes('id="promotion-ticket-select"'));
  assert.equal(html.includes('id="promotion-execution-mode-select"'), false);
  assert.ok(html.includes('id="promotion-execution-mode-readonly"'));
  assert.ok(html.includes('id="promotion-risk-profile-select"'));
  assert.ok(html.includes('id="risk-envelope-panel"'));
  assert.ok(html.includes('id="risk-envelope-preference"'));
  assert.ok(html.includes('id="risk-envelope-capital-band"'));
  assert.ok(html.includes('id="risk-envelope-status"'));
  const quickFormStart = html.indexOf('id="quick-form"');
  const promotionPanelPos = html.indexOf('id="promotion-decision-panel"');
  assert.ok(promotionPanelPos > 0 && promotionPanelPos < quickFormStart);
  assert.ok(source.includes('function promotionTicketQueueMessage('));
  assert.ok(source.includes('promotionTicketLoginRequired'));
  assert.ok(source.includes('promotionTicketLoadFailed'));
  assert.ok(source.includes('promotionAdminOnly'));
  assert.ok(source.includes('await refreshResearchPromotionTickets()'));
  assert.ok(source.includes('function renderRiskEnvelopePanel('));
  assert.ok(source.includes('function buildDesignPreviewRiskEnvelopeView('));
  assert.ok(source.includes('live_authority_granted'));
  assert.ok(source.includes('function buildPromotionConfirmation('));
  assert.ok(source.includes('function promotionConfirmationExecutionMode('));
  assert.ok(source.includes('function selectedPromotionTicket('));
  assert.equal(source.includes('hint.split(/\\s+/).includes("paper")'), false);
  assert.ok(source.includes('synthetic matching is not supported'));
  assert.ok(source.includes('requestJson("/api/research-promotion-tickets")'));
  assert.ok(source.includes('/api/research-promotion-decisions'));
  const build = frontendFunction('buildPromotionConfirmation', {
    PROMOTION_RISK_PROFILES: ['CAPITAL_PRESERVATION', 'BALANCED_COMPOUNDING', 'GROWTH_COMPOUNDING'],
    DEFAULT_PROMOTION_RISK_PROFILE: 'CAPITAL_PRESERVATION',
  });
  const ok = build({
    targetPlatform: 'ibkr',
    executionMode: 'live',
    riskProfile: 'BALANCED_COMPOUNDING',
    paperSupported: true,
    suggestedRiskProfile: 'GROWTH_COMPOUNDING',
  });
  assert.equal(ok.target_platform, 'ibkr');
  assert.equal(ok.execution_mode, 'live');
  assert.equal(ok.risk_profile, 'BALANCED_COMPOUNDING');
  assert.equal(Object.keys(ok).sort().join(','), 'execution_mode,risk_profile,target_platform');
  assert.equal(Object.prototype.hasOwnProperty.call(ok, 'live_authority_granted'), false);
  assert.throws(
    () => build({
      targetPlatform: 'firstrade',
      executionMode: 'paper',
      riskProfile: 'CAPITAL_PRESERVATION',
      paperSupported: false,
      suggestedRiskProfile: 'CAPITAL_PRESERVATION',
    }),
    /synthetic matching/,
  );
});

test('promotion ticket queue surfaces login, load failure, and empty states', () => {
  const loginRequired = frontendFunction('promotionTicketQueueMessage', {
    state: { auth: { allowed: false }, researchPromotion: { payload: {} } },
    t: (key) => key,
  });
  assert.equal(loginRequired(), 'promotionTicketLoginRequired');
  const loadFailed = frontendFunction('promotionTicketQueueMessage', {
    state: {
      auth: { allowed: true },
      researchPromotion: {
        payload: { data_status: 'unavailable', errors: ['research_promotion_request_failed'] },
      },
    },
    t: (key) => key,
  });
  assert.equal(loadFailed(), 'promotionTicketLoadFailed');
  const empty = frontendFunction('promotionTicketQueueMessage', {
    state: {
      auth: { allowed: true },
      researchPromotion: { payload: { data_status: 'ready', errors: [] } },
    },
    t: (key) => key,
  });
  assert.equal(empty(), 'promotionTicketEmpty');
});

test('selected promotion ticket prefers ticket suggested risk profile', () => {
  const selected = frontendFunction('selectedPromotionTicket', {
    state: {
      researchPromotion: {
        selectedTicketId: 'ticket-1',
        payload: {
          tickets: [
            {
              ticket_id: 'ticket-1',
              state: 'awaiting_human',
              suggested_risk_profile: 'GROWTH_COMPOUNDING',
              strategy_profile: 'demo',
            },
          ],
        },
      },
    },
  });
  assert.equal(selected().suggested_risk_profile, 'GROWTH_COMPOUNDING');
});

for (const sample of [
  { name: 'unverified record', allowed: true, status: 'ready', tickets: [{state:'awaiting_human'}], applications: [], visible:false, notice:'promotionTicketEmpty' },
  { name: 'empty queue', allowed: true, status: 'ready', tickets: [], applications: [], visible: false, notice: 'promotionTicketEmpty' },
  { name: 'pending candidate', allowed: true, status: 'ready', tickets: [{ state: 'awaiting_human', shadow_evidence_kind: 'paired_forward_observation' }], applications: [], visible: true },
  { name: 'accepted application preparation stays in history', allowed: true, status: 'ready', tickets: [], applications: [{ state: 'human_accepted' }], visible: false, notice: 'promotionTicketEmpty' },
  { name: 'failed queue with old candidate', allowed: true, status: 'unavailable', tickets: [{ state: 'awaiting_human', shadow_evidence_kind: 'paired_forward_observation' }], applications: [], visible: false, notice: 'promotionTicketLoadFailed' },
  { name: 'stale queue', allowed: true, status: 'stale', tickets: [{ state: 'awaiting_human', shadow_evidence_kind: 'paired_forward_observation' }], applications: [], visible: false, notice: 'promotionTicketLoadFailed' },
  { name: 'queue errors', allowed: true, status: 'ready', errors: ['unavailable'], tickets: [{ state: 'awaiting_human', shadow_evidence_kind: 'paired_forward_observation' }], applications: [], visible: false, notice: 'promotionTicketLoadFailed' },
  { name: 'signed out', allowed: false, status: 'ready', tickets: [{ state: 'awaiting_human', shadow_evidence_kind: 'paired_forward_observation' }], applications: [], visible: false },
  { name: 'hidden target platform', allowed: true, platformVisible: false, status: 'ready', tickets: [{ state: 'awaiting_human', shadow_evidence_kind: 'paired_forward_observation' }], applications: [], visible: false, notice: 'promotionTargetUnavailable' },
]) test(`promotion panel shows actionable candidates only: ${sample.name}`, () => {
  const nodes = {
    'promotion-decision-panel': { hidden: false },
    'promotion-queue-notice': { hidden: false, textContent: '' },
  };
  const context = {
    state: { selected: 'ibkr', auth: { allowed: sample.allowed }, researchPromotion: {
      payload: { data_status: sample.status, tickets: sample.tickets, applications: sample.applications, errors: sample.errors || [] },
    } },
    el: id => nodes[id], t: key => key, platformMeta: { ibkr: { console_visible: sample.platformVisible !== false } },
  };
  context.promotionTicketNeedsSourceCheck = frontendFunction('promotionTicketNeedsSourceCheck', context);
  context.reviewablePromotionTickets = frontendFunction('reviewablePromotionTickets', context);
  context.promotionApplications = frontendFunction('promotionApplications', context);
  context.renderUnverifiedPromotionRecords = () => {};
  context.renderPromotionApplicationPreparation = () => {};
  context.promotionTicketQueueMessage = frontendFunction('promotionTicketQueueMessage', context);
  frontendFunction('renderPromotionConfirmControls', context)();
  assert.equal(nodes['promotion-decision-panel'].hidden, !sample.visible);
  assert.equal(nodes['promotion-queue-notice'].hidden, !sample.allowed || (sample.visible && !sample.notice));
  if (sample.notice) assert.equal(nodes['promotion-queue-notice'].textContent, sample.notice);
});

test('Binance private scope is shown only with a valid report', () => {
  const shouldShow = frontendFunction('binancePrivateScopeShouldShow', {});
  assert.equal(shouldShow({ auth: { allowed: true, admin: true }, selected: 'binance', binancePrivateScope: { status: 'empty', report: null } }), false);
  assert.equal(shouldShow({ auth: { allowed: true, admin: true }, selected: 'binance', binancePrivateScope: { status: 'not_available', report: null } }), false);
  assert.equal(shouldShow({ auth: { allowed: true, admin: true }, selected: 'binance', binancePrivateScope: { status: 'available', report: { platform: 'binance', assets: [] } } }), true);
  assert.equal(shouldShow({ auth: { allowed: true, admin: false }, selected: 'binance', binancePrivateScope: { status: 'available', report: { platform: 'binance', assets: [] } } }), false);
});

test('only reviewable promotion tickets create a dashboard research entry', () => {
  const reviewable = frontendFunction('reviewablePromotionTickets', {
    promotionTicketNeedsSourceCheck: ticket => !ticket.shadow_evidence_kind,
  });
  const tickets = [
    { state: 'awaiting_human' },
    { state: 'awaiting_human', shadow_evidence_kind: 'paired_forward_observation' },
    { state: 'human_accepted', shadow_evidence_kind: 'paired_forward_observation' },
  ];
  assert.equal(reviewable({ data_status: 'ready', errors: [], tickets }).length, 1);
  assert.equal(reviewable({ data_status: 'stale', errors: [], tickets }).length, 0);
  assert.equal(reviewable({ data_status: 'ready', errors: ['source_unavailable'], tickets }).length, 0);
});

test('research page puts current decisions before collapsed history and labels the intent platform', () => {
  const html = readFileSync(new URL('../web/strategy-switch-console/index.html', import.meta.url), 'utf8');
  const decision = html.indexOf('id="promotion-decision-panel"');
  const emptyState = html.indexOf('id="promotion-queue-notice"');
  const history = html.indexOf('id="parked-research-results"');
  assert.ok(decision > 0 && emptyState > decision && history > emptyState);
  assert.match(html, /<details[^>]+id="parked-research-results"[^>]*>/);
  assert.ok(html.includes('id="platform-strip-label"'));
  assert.equal(html.includes('id="overview-notice"'), false);
  assert.equal(html.includes('id="overview-count-total"'), false);
  assert.match(html, /data-overview-filter="normal"/);
  assert.match(html, /data-overview-filter="paused"/);
  assert.match(html, /data-overview-filter="abnormal"/);
});

for (const status of ['deploymentUnverified', 'switchesApplied', 'strategyNotApplied', 'settingsNotApplied', 'scheduleNotApplied']) {
  test(`account next step stays within observed configuration: ${status}`, () => {
    const fn = frontendFunction('accountNextStep', { accountApplicationText: () => status, t: key => key });
    const step = fn('ibkr', {});
    assert.equal(step.label, status === 'deploymentUnverified' ? 'recheckRuntimeStatus'
      : status === 'switchesApplied' ? 'noSwitchAction' : 'reviewAccountSettings');
    assert.equal(step.openSettings, !['deploymentUnverified', 'switchesApplied'].includes(status));
  });
}

test('unknown scheduler readback remains unknown when the switch agrees', () => {
  const fn = frontendFunction('accountApplicationText', {
    accountDeploymentObservation: () => ({ runtime_enabled: true, scheduler_state: 'unknown', strategy_profile: 'example' }),
    runtimeTargetStateForAccount: () => ({ known: true, enabled: true }),
    currentStrategyForAccount: () => 'example', t: key => key,
  });
  assert.equal(fn('ibkr', {}), 'deploymentUnverified');
});

test('account status follows runtime readback instead of the form execution mode', () => {
  const html = readFileSync(new URL('../web/strategy-switch-console/index.html', import.meta.url), 'utf8');
  for (const id of ['plan-check-account', 'plan-check-strategy', 'plan-check-risk', 'plan-check-authority', 'selected-monitoring-status']) {
    assert.equal(html.includes(`id="${id}"`), false, `${id} should not appear in the account page`);
  }

  function createNode() {
    return {
      children: [], hidden: false, textContent: '',
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
    };
  }
  const rendered = [];
  for (const executionMode of ['live', 'dry_run']) {
    const nodes = {
      'account-overview': createNode(),
      'account-overview-body': createNode(),
      'account-runtime-details': createNode(),
      'account-runtime-details-body': createNode(),
    };
    const context = {
      state: { selected: 'ibkr', forms: { ibkr: { executionMode } } },
      el: id => nodes[id],
      document: { createElement: () => createNode() },
      hasPrivateConfig: () => true,
      selectedAccount: () => ({ key: 'main' }),
      currentStrategyForAccount: () => 'example',
      strategyLabel: () => 'Example strategy',
      currentRuntimeTargetText: () => 'configured enabled',
      accountDeploymentText: () => 'deployed enabled',
      accountSchedulerText: () => 'scheduled',
      accountApplicationText: () => 'switchesApplied',
      accountMonitoringRecord: () => ({ freshness: { data_status: 'ready' }, execution_observation: { code: 'not_due' } }),
      accountMonitoringAge: () => '5 minutes ago',
      accountObservationAge: () => '5 minutes ago',
      accountMonitoringText: () => 'not in a due window',
      accountNextStep: () => ({ label: 'noSwitchAction' }),
      runtimeTargetStateForAccount: () => ({ known: true, enabled: true }),
      runtimeOverviewStatus: () => ({ status: 'normal', reason: '' }),
      t: key => key,
    };
    frontendFunction('renderAccountOverview', context)();
    rendered.push(nodes['account-overview-body'].children.map(pair =>
      pair.children.map(child => child.textContent)));
    assert.deepEqual(nodes['account-runtime-details-body'].children.map(pair => pair.children[0].textContent), [
      'deployedSwitch', 'schedulerState', 'applicationStatus',
    ]);
  }
  assert.deepEqual(rendered[0], rendered[1]);
  assert.deepEqual(rendered[0], [
    ['overviewRuntime', 'overviewRuntimeNormal'],
    ['configuredStrategy', 'Example strategy'],
    ['latestReadback', '5 minutes ago'],
  ]);
});

test('account status shows a next step only when observed state needs attention', () => {
  function createNode() {
    return {
      children: [], hidden: false, textContent: '',
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
    };
  }
  const nodes = Object.fromEntries([
    'account-overview', 'account-overview-body', 'account-runtime-details', 'account-runtime-details-body',
  ].map(id => [id, createNode()]));
  const context = {
    state: { selected: 'ibkr', forms: { ibkr: { executionMode: 'live' } } },
    el: id => nodes[id], document: { createElement: () => createNode() },
    hasPrivateConfig: () => true, selectedAccount: () => ({ key: 'main' }),
    currentStrategyForAccount: () => 'example', strategyLabel: () => 'Example strategy',
    currentRuntimeTargetText: () => 'configured enabled', accountDeploymentText: () => 'deployed disabled',
    accountSchedulerText: () => 'paused', accountApplicationText: () => 'settingsNotApplied',
    accountMonitoringRecord: () => ({ freshness: { data_status: 'ready' }, execution_observation: { code: 'attention' } }),
    accountMonitoringAge: () => '2 minutes ago', accountObservationAge: () => '2 minutes ago', accountMonitoringText: () => 'needs review',
    runtimeTargetStateForAccount: () => ({ known: true, enabled: true }),
    runtimeOverviewStatus: () => ({ status: 'abnormal', reason: 'config' }),
    accountNextStep: () => ({ label: 'reviewAccountSettings' }), t: key => key,
  };
  frontendFunction('renderAccountOverview', context)();
  assert.deepEqual(nodes['account-overview-body'].children.at(-1).children.map(child => child.textContent), [
    'accountDetailAction', 'reviewAccountSettings',
  ]);
});

test('opening account settings selects the exact account without submitting or enabling', () => {
  const events = [];
  const state = { selected: 'schwab', forms: { ibkr: { runtimeTargetMode: 'current' } } };
  const nodes = {
    'strategy-settings': { open: false, scrollIntoView: () => events.push('scroll') },
    'account-select': { value: '', dispatchEvent: event => events.push(event.type), focus: () => events.push('focus') },
  };
  const fn = frontendFunction('openAccountSettings', { state, el: id => nodes[id], render: () => events.push('render'), Event });
  fn('ibkr', { key: 'second-account' });
  assert.equal(state.selected, 'ibkr');
  assert.equal(state.view, 'accounts');
  assert.equal(nodes['account-select'].value, 'second-account');
  assert.equal(nodes['strategy-settings'].open, true);
  assert.equal(state.forms.ibkr.runtimeTargetMode, 'current');
  assert.deepEqual(events, ['render', 'change', 'scroll', 'focus']);
});

test('viewing a prepared application opens its account without replacing the current draft', () => {
  const application = {
    strategy_profile: 'candidate-strategy',
    application_preparation: { preflight_status: 'ready' },
  };
  const account = {
    platform: 'longbridge',
    key: 'paper',
    configured_execution_mode: 'live',
    preflight_status: 'ready',
  };
  const draft = { accountKey: 'sg', strategy: 'user-draft', executionMode: 'dry_run' };
  const opened = [];
  const fn = frontendFunction('openSelectedPromotionApplicationAccount', {
    selectedPromotionApplication: () => application,
    selectedPromotionApplicationAccount: () => account,
    openAccountSettings: (...args) => opened.push(args),
  });
  fn();
  assert.deepEqual(draft, { accountKey: 'sg', strategy: 'user-draft', executionMode: 'dry_run' });
  assert.deepEqual(opened, [['longbridge', account, true]]);
});

test('decisions and account observations stay outside collapsed strategy settings', () => {
  const html = readFileSync(new URL('../web/strategy-switch-console/index.html', import.meta.url), 'utf8');
  const settings = html.indexOf('id="strategy-settings"');
  assert.ok(settings > 0);
  assert.match(html, /<details class="strategy-settings" id="strategy-settings">/);
  for (const id of ['control-plane-view', 'promotion-decision-panel', 'reconciliation-recovery-board', 'account-overview', 'toast']) {
    assert.ok(html.indexOf(`id="${id}"`) < settings, `${id} must remain visible with settings collapsed`);
  }
  assert.ok(html.indexOf('id="promotion-decision-panel"') < html.indexOf('id="account-overview"'));
  assert.ok(html.indexOf('id="quick-form"') > settings);
  assert.ok(source.includes('...(needsAttention ? [["accountDetailAction", nextStep]] : [])'));
  assert.equal((html.match(/id="dispatch-button"/g) || []).length, 1);
});

for (const sample of [
  { ticket: { shadow_passed: true, shadow_evidence_kind: '' }, result: 'promotionObservationReported promotionEvidenceSourceMissing' },
  { ticket: { shadow_passed: true, shadow_evidence_kind: 'paired_forward_observation' }, result: 'promotionObservationReported promotionEvidenceNeedsReview' },
  { ticket: { shadow_passed: false, shadow_evidence_kind: 'paired_forward_observation' }, result: 'promotionObservationFailed promotionEvidenceNeedsReview' },
  { ticket: { shadow_passed: null }, result: 'promotionObservationMissing promotionEvidenceSourceMissing' },
  { ticket: { shadow_passed: 'true', shadow_evidence_kind: '   ' }, result: 'promotionObservationMissing promotionEvidenceSourceMissing' },
]) test(`promotion evidence separates reported outcome from provenance: ${JSON.stringify(sample.ticket)}`, () => {
  const message = frontendFunction('promotionTicketEvidenceMessage', { t: key => key });
  assert.equal(message(sample.ticket), sample.result);
});

test('promotion rendering preserves candidate identity, target context and admin-only actions', () => {
  const nodes = Object.fromEntries([
    'promotion-decision-panel', 'promotion-queue-notice', 'promotion-target-summary',
    'promotion-ticket-select', 'promotion-execution-mode-readonly', 'promotion-risk-profile-select',
    'promotion-confirm-meta', 'promotion-ticket-meta', 'promotion-ticket-detail',
    'promotion-accept-button', 'promotion-reject-button',
  ].map(id => [id, {
    hidden: false, textContent: '', value: '', dataset: {}, options: [],
    replaceChildren() { this.options = []; this.value = ''; },
    append(option) { this.options.push(option); if (option.selected) this.value = option.value; },
  }]));
  const ticket = { ticket_id: 'candidate-one', strategy_profile: 'SOXL V7 frozen252 forward', created_at: '2026-09-08T00:00:00Z',
    state: 'awaiting_human', suggested_risk_profile: 'GROWTH_COMPOUNDING',
    shadow_evidence_kind: 'shadow_decision', shadow_passed: false,
    proposed_params: { cash_reserve_ratio: 0.03 }, notification_body: 'Forward observation remains pending.' };
  const context = {
    state: { selected: 'ibkr', auth: { allowed: true, admin: false }, researchPromotion: {
      selectedTicketId: '', payload: { data_status: 'ready', tickets: [ticket], applications: [], errors: [] },
    } },
    el: id => nodes[id], platformMeta: { ibkr: { label: 'IBKR' } },
    t: key => ({
      promotionTargetSummary: 'Target: {platform}; account: {account}',
      promotionExecutionModeReadonly: 'Mode: {mode}',
      promotionTicketEvidenceKind: 'Evidence: {kind}',
      promotionTicketParams: 'Parameters: {params}',
      promotionTicketNotification: 'Note: {body}',
    }[key] || key),
    strategyLabel: () => 'Example strategy', selectedAccount: () => ({ label: 'Primary account' }),
    formatDateTime: value => value, renderRiskEnvelopePanel: () => {}, renderUnverifiedPromotionRecords: () => {},
    renderPromotionApplicationPreparation: () => {},
    selectedPromotionApplication: () => null,
    renderPromotionSelectionControls: () => {
      nodes['promotion-execution-mode-readonly'].textContent = 'Mode: live';
      return { platform: 'ibkr', key: 'primary', label: 'Primary account', broker_environment: 'live' };
    },
    promotionConfirmationExecutionMode: () => 'live',
    PROMOTION_RISK_PROFILES: ['CAPITAL_PRESERVATION', 'BALANCED_COMPOUNDING', 'GROWTH_COMPOUNDING'],
    DEFAULT_PROMOTION_RISK_PROFILE: 'CAPITAL_PRESERVATION',
    Option: class { constructor(text, value, _defaultSelected, selected) { Object.assign(this, { text, value, selected }); } },
  };
  for (const name of ['promotionTicketNeedsSourceCheck', 'reviewablePromotionTickets', 'promotionApplications', 'promotionTicketDisplayName', 'promotionTicketQueueMessage', 'selectedPromotionTicket', 'promotionRiskProfileLabel', 'promotionTicketEvidenceMessage', 'promotionTicketDetailMessage']) {
    context[name] = frontendFunction(name, context);
  }
  const render = frontendFunction('renderPromotionConfirmControls', context);
  render();
  assert.equal(nodes['promotion-ticket-select'].value, ticket.ticket_id);
  assert.equal(nodes['promotion-target-summary'].textContent, 'Target: IBKR; account: Primary account');
  assert.equal(nodes['promotion-risk-profile-select'].value, 'GROWTH_COMPOUNDING');
  assert.equal(nodes['promotion-execution-mode-readonly'].textContent, 'Mode: live');
  assert.equal(nodes['promotion-accept-button'].disabled, true);
  assert.equal(nodes['promotion-reject-button'].disabled, true);
  context.state.auth.admin = true;
  render();
  assert.equal(nodes['promotion-accept-button'].disabled, false);
  context.promotionConfirmationExecutionMode = () => '';
  const renderNoOrder = frontendFunction('renderPromotionConfirmControls', context);
  renderNoOrder();
  assert.equal(nodes['promotion-accept-button'].disabled, true);
  assert.equal(nodes['promotion-reject-button'].disabled, false);
  context.promotionConfirmationExecutionMode = () => 'live';
  assert.match(nodes['promotion-ticket-meta'].textContent, /promotionObservationFailed promotionEvidenceNeedsReview/);
  assert.match(nodes['promotion-ticket-detail'].textContent, /shadow_decision/);
  assert.match(nodes['promotion-ticket-detail'].textContent, /promotionObservationFailed/);
  assert.match(nodes['promotion-ticket-detail'].textContent, /cash_reserve_ratio/);
  assert.match(nodes['promotion-ticket-detail'].textContent, /Forward observation remains pending/);
  context.state.researchPromotion.payload.tickets = [{ ...ticket, state: 'human_accepted' }];
  render();
  assert.equal(nodes['promotion-decision-panel'].hidden, true);
  assert.equal(nodes['promotion-accept-button'].disabled, true);
  assert.equal(context.state.researchPromotion.selectedTicketId, '');
});

test('hiding all platforms also hides account observations outside the settings form', () => {
  const surface = { hidden: false };
  const nodes = { 'platform-strip': { replaceChildren() {} }, 'switch-view': { hidden: false, querySelector: () => surface } };
  frontendFunction('renderPlatforms', { el: id => nodes[id], state: { selected: 'ibkr' },
    platformMeta: { ibkr: { console_visible: false } }, hasPrivateConfig: () => true })();
  assert.equal(nodes['switch-view'].hidden, true);
});

test('overview status maps fresh runtime evidence to the user-facing state', () => {
  const status = frontendFunction('runtimeOverviewStatus', {})
    .bind(null);
  const assertStatus = (actual, expectedStatus, expectedReason) => {
    assert.equal(actual.status, expectedStatus);
    assert.equal(actual.reason, expectedReason);
  };
  assertStatus(status({ known: true, enabled: true }, true, {
    freshness: { data_status: 'ready' }, execution_observation: { code: 'monitoring_only' },
  }), 'normal', '');
  assertStatus(status({ known: true, enabled: false }, true, {
    freshness: { data_status: 'ready' }, execution_observation: { code: 'not_applicable' },
  }), 'paused', '');
  assertStatus(status({ known: true, enabled: true }, true, {
    freshness: { data_status: 'ready' }, execution_observation: { code: 'attention' },
  }), 'abnormal', 'attention');
  assertStatus(status({ known: true, enabled: true }, true, {
    freshness: { data_status: 'stale' }, execution_observation: { code: 'monitoring_only' },
  }), 'abnormal', 'stale');
  assertStatus(status({ known: true, enabled: true }, true, null), 'abnormal', 'pending');
  assertStatus(status({ known: true, enabled: true }, false, {
    freshness: { data_status: 'ready' }, execution_observation: { code: 'not_due' },
  }, true), 'abnormal', 'config');
});

for (const sample of [
  { configured: undefined, application: 'deploymentUnverified', unknown: true, attention: true, runtimeStatus: 'abnormal', runtimeReason: 'config' },
  { configured: true, application: 'deploymentUnverified', unknown: true, attention: true, runtimeStatus: 'abnormal', runtimeReason: 'config' },
  { configured: false, application: 'deploymentUnverified', unknown: true, attention: true, runtimeStatus: 'abnormal', runtimeReason: 'config' },
  { configured: true, application: 'settingsNotApplied', unknown: false, attention: true, runtimeStatus: 'abnormal', runtimeReason: 'config' },
  { configured: false, application: 'switchesApplied', observation: 'not_applicable', unknown: false, attention: false, runtimeStatus: 'paused', runtimeReason: '' },
  { configured: true, application: 'switchesApplied', observation: 'attention', unknown: false, attention: true, runtimeStatus: 'abnormal', runtimeReason: 'attention' },
]) test('overview keeps saved settings separate from actual state '+JSON.stringify(sample), () => {
  const context = {
    hasPrivateConfig: () => true,
    platformMeta: { binance: { label: 'Binance' }, hidden: { console_visible: false } },
    optionsFor: () => [{ key: 'account', label: 'Account' }],
    currentStrategyForAccount: () => 'example', strategyLabel: () => 'Example',
    runtimeTargetStateForAccount: () => ({ known: sample.configured !== undefined, enabled: sample.configured }),
    accountApplicationText: () => sample.application,
    accountMonitoringRecord: () => ({ freshness: { data_status: 'ready' }, execution_observation: { code: sample.observation } }),
    accountMonitoringAge: () => 'deployment age', accountObservationAge: () => '1 minute ago', accountMonitoringText: () => 'record', t: x => x,
    runtimeOverviewStatus: () => ({ status: sample.runtimeStatus, reason: sample.runtimeReason }),
  };
  const rows = frontendFunction('overviewAccounts', context)();
  assert.equal(rows.length, 1, 'hidden platforms never appear');
  assert.equal(rows[0].configured, sample.configured === undefined ? 'unknown' : sample.configured ? 'enabled' : 'disabled');
  assert.equal(rows[0].unknown, sample.unknown);
  assert.equal(rows[0].attention, sample.attention);
  assert.equal(rows[0].runtimeStatus, sample.runtimeStatus);
  assert.equal(rows[0].runtimeReason, sample.runtimeReason);
  assert.equal(frontendFunction('overviewAccounts', {...context, hasPrivateConfig: () => false})().length, 0);
});

test('overview filters preserve unknown and search only the chosen scope', () => {
  const rows = [
    { platformLabel: 'Binance', account: { label: 'Main' }, strategy: 'Crypto', runtimeStatus: 'abnormal' },
    { platformLabel: 'IBKR', account: { label: 'Second' }, strategy: 'Trend', runtimeStatus: 'paused' },
    { platformLabel: 'LongBridge', account: { label: 'SG' }, strategy: 'Trend', runtimeStatus: 'normal' },
  ];
  const filter = frontendFunction('filterOverviewAccounts', {});
  assert.equal(filter(rows, 'paused', '').length, 1);
  assert.equal(filter(rows, 'normal', '').length, 1);
  assert.equal(filter(rows, 'abnormal', '').length, 1);
  assert.equal(filter(rows, 'all', '  bINAnCe ').length, 1);
  assert.equal(filter(rows, 'normal', 'Trend').length, 1);
  assert.equal(filter(rows, 'all', 'not-found').length, 0);
});

for (const view of ['overview', 'accounts', 'research']) test(`workspace navigation isolates ${view} from the other jobs`, () => {
  const nodes = {};
  const nav = { hidden: true };
  const buttons = ['overview', 'accounts', 'research'].map(workspace => ({
    dataset: { workspace }, attributes: {},
    setAttribute(key, value) { this.attributes[key] = value; },
    removeAttribute(key) { delete this.attributes[key]; },
  }));
  const state = { view, appReady: true, auth: { allowed: true }, refreshing: false };
  const context = { state, t: key => key, el: id => nodes[id] ??= {},
    document: { querySelector: () => nav, querySelectorAll: () => buttons } };
  const render = frontendFunction('renderWorkspace', context);
  render();
  for (const name of ['overview', 'accounts', 'research']) assert.equal(nodes[`${name}-view`].hidden, name !== view);
  assert.equal(nodes['platform-strip'].hidden, view !== 'accounts');
  assert.equal(nodes['health-view'].hidden, view !== 'research');
  assert.equal(buttons.filter(button => button.attributes['aria-current'] === 'page').length, 1);
  assert.equal(nav.hidden, false);
  state.auth.allowed = false;
  render();
  assert.equal(nav.hidden, true, 'private navigation must disappear on logout');
});

test('viewing an account does not expand editing or change the configured switch', () => {
  const state = { selected: 'longbridge', forms: { binance: { runtimeTargetMode: 'current' } } };
  const nodes = {
    'strategy-settings': { open: true }, 'workspace-title': { scrollIntoView() {} },
    'account-select': { value: '', dispatchEvent() {}, focus() {} },
  };
  const fn = frontendFunction('openAccountSettings', { state, el: id => nodes[id], render() {}, Event });
  fn('binance', { key: 'default' }, false);
  assert.equal(state.view, 'accounts');
  assert.equal(nodes['account-select'].value, 'default');
  assert.equal(nodes['strategy-settings'].open, false);
  assert.equal(state.forms.binance.runtimeTargetMode, 'current');
});

test('unverified promotion records are separated by evidence, not by test-like names', () => {
  const check = frontendFunction('promotionTicketNeedsSourceCheck', {});
  assert.equal(check({strategy_profile:'synthetic-profile',shadow_evidence_kind:'paired_forward_observation'}),false);
  assert.equal(check({strategy_profile:'soxl_soxx_trend_income'}),true);
  assert.equal(check({shadow_evidence_kind:'  '}),true);
});
