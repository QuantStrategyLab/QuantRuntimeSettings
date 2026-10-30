import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {inspectSelector,verifyFixedActive} from '../scripts/console_958_selector_probe.mjs';
const require=createRequire(import.meta.url);
const ts=require(process.env.QRS_TEST_TYPESCRIPT || '../web/strategy-switch-console/frontend/node_modules/typescript');
const source=Buffer.from(`
const PLATFORM_CONFIG = { binance: { supported_execution_modes: ["live", "dry_run"] } };
function supportedExecutionModesForPlatform(platform) { return PLATFORM_CONFIG[platform]?.supported_execution_modes || []; }
function accountDraftStrategyChoices(platform, accountOption, profiles) {
 const choices = [];
 for (const profile of profiles) {
  if (profile.frozen === true) continue;
  const modes = profile.allowed_execution_modes;
  if (!modes.some((mode) => mode === "paper" || mode === "live")) continue;
  choices.push(profile);
 }
 return choices;
}
`);
test('two reversible insertions return only booleans and digests',()=>{
 const r=inspectSelector(ts,source,source);
 assert.equal(r.two_insertions_reversible,true);
 assert.match(r.active_code_sha256,/^[a-f0-9]{64}$/);
 assert.notEqual(r.active_code_sha256,r.candidate_code_sha256);
 assert.equal(Object.values(r).every(v=>typeof v==='boolean'||/^[a-f0-9]{64}$/.test(v)),true);
});
test('unknown selector, helper or configuration changes are refused',()=>{
 for(const pair of [['profile.frozen === true','profile.frozen === false'],['return PLATFORM_CONFIG','return otherConfig'],['["live", "dry_run"]','["live"]']])
  assert.throws(()=>inspectSelector(ts,source,Buffer.from(source.toString().replace(...pair))));
});
test('duplicate definitions and invalid syntax are refused',()=>{
 assert.throws(()=>inspectSelector(ts,source,Buffer.concat([source,Buffer.from('\nfunction supportedExecutionModesForPlatform() {}')])));
 assert.throws(()=>inspectSelector(ts,source,Buffer.concat([source,Buffer.from('\nfunction (')])));
});
test('different or non-single serving deployment is refused',()=>{
 const good={deployments:[{id:'7bc41232-5b83-4e46-b220-8fe912f3234f',versions:[{version_id:'2ee87f0f-d07f-436f-9d54-f311ba37923b',percentage:100}]}]};
 verifyFixedActive(good);
 for(const changed of [{...good,deployments:[]},{deployments:[{...good.deployments[0],id:'wrong'}]},
  {deployments:[{...good.deployments[0],versions:[{version_id:'wrong',percentage:100}]}]},
  {deployments:[{...good.deployments[0],versions:[{...good.deployments[0].versions[0],percentage:99}]}]}]) assert.throws(()=>verifyFixedActive(changed));
});
