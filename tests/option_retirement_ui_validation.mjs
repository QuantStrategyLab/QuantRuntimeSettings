import assert from 'node:assert/strict';
import {createAccountSettingsController} from '../web/strategy-switch-console/frontend/src/accountSettingsState.ts';
import {buildSync} from '../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js';
const built=buildSync({entryPoints:['web/strategy-switch-console/frontend/src/pages/accounts/helpers.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {buildOverrides}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
import {__test} from '../web/strategy-switch-console/worker.js';

const identity={platform:'longbridge',key:'synthetic',target_name:'synthetic',broker_environment:'paper',
  account_selector:'synthetic',deployment_selector:'synthetic',account_scope:'PAPER',service_name:'synthetic-service'};
const settings={ok:true,platform:'longbridge',key:'synthetic',identity,
  draft:{status:'current',revision:1,identity,current_identity:identity,
    overrides:{option_overlay_enabled:true,income_layer_enabled:true}},
  risk:{revision:1,preference:null,scope_id:'synthetic'},
  operations:{save_draft:true,save_option_draft:false,apply_strategy:false},
  effective:{strategy_profile:{status:'known',value:'old'},income_layer_enabled:{status:'known',value:true}}};
const c=createAccountSettingsController();
assert.equal(c.applyRead(c.select({platform:'longbridge',key:'synthetic'}),settings),true);
c.edit({strategy:'new',strategyTouched:true});
const started=c.startSave('strategy');
assert.ok(started);
assert.equal(started.body.overrides.strategy_profile,'new');
assert.equal(started.body.overrides.option_overlay_enabled,null);
assert.equal(settings.draft.overrides.option_overlay_enabled,true, 'reading never mutates the stored draft');
const profiles=__test.normalizeStrategyProfilesPayload([{profile:'new',label:'Synthetic',domain:'us_equity',allowed_execution_modes:['paper'],option_overlay_enabled:false}]);
const observed={platform:'longbridge',config:{supported_domains:['us_equity']},draft:{overrides:{option_overlay_enabled:true,income_layer_enabled:true}}};
assert.doesNotThrow(()=>__test.assertAccountDraftPatch(profiles,observed,started.body.overrides,''));
const after={...observed.draft.overrides,...started.body.overrides};
for(const [key,value] of Object.entries(after)) if(value===null) delete after[key];
assert.equal(Object.hasOwn(after,'option_overlay_enabled'),false);
assert.equal(after.income_layer_enabled,true);
assert.doesNotThrow(()=>__test.assertAccountDraftPatch(profiles,{...observed,draft:{overrides:after}},{strategy_profile:'new'},''));
const rows=[{field:'option_overlay_enabled',overridden:true,draft:true},{field:'income_layer_enabled',overridden:true,draft:true}];
const result=buildOverrides(rows,{});
assert.equal(result.option_overlay_enabled,null);
assert.equal(result.income_layer_enabled,true);
assert.equal(rows[0].draft,true);
console.log('option retirement UI: saved draft cleanup and income preservation passed');
