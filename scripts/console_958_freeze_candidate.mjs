// Pure fixed-baseline freeze-policy candidate; no network or output.
import {createHash} from 'node:crypto';
import {inspectSelector} from './console_958_candidate.mjs';
const fail=()=>{throw Error('freeze_candidate_unverified')};
const sha=b=>createHash('sha256').update(b).digest('hex');
const editableNames=['normalizeStrategyProfilesPayload','assertStrategyAllowedForAccount','accountDraftStrategyChoices','syncAccountDefaultResponse','buildAdminState'];
const names=[...editableNames,'isEligibleLegacyContinuityInput'];
// Exact canonical set from strategy_profiles_asset.js at 3f675c; its blob is
// independently pinned by the workflow, and the test compares the full set.
export const FROZEN_POLICY=Object.freeze(["global_etf_rotation","tecl_xlk_trend_income","hk_global_etf_tactical_rotation","hk_low_vol_dividend_quality_snapshot","hk_equity_combo","cn_industry_etf_rotation","cn_industry_etf_rotation_aggressive","cn_index_etf_tactical_rotation","cn_chinext_tactical_rotation","cn_chinext_growth_momentum_quality","cn_dividend_quality_snapshot","cn_chinext_growth_momentum_quality_snapshot","cn_star_growth_momentum_quality","cn_equity_combo"]);
export function assertFrozenPolicySource(profiles){
 if(!Array.isArray(profiles))fail();
 const frozen=profiles.filter(x=>x?.frozen===true).map(x=>x.profile).sort();
 if(frozen.length!==FROZEN_POLICY.length||new Set(frozen).size!==frozen.length||JSON.stringify(frozen)!==JSON.stringify([...FROZEN_POLICY].sort()))fail();
}
const helper=`\nfunction __qrs958Frozen(strategy) {\n  const aliases = { global_macro_etf_rotation: "global_etf_rotation", global_etf_confidence_vol_gate: "global_etf_rotation" };\n  const lookup = String(strategy?.profile || "").trim().toLowerCase().replaceAll("-", "_");\n  const profile = aliases[lookup] || lookup;\n  return strategy?.frozen === true || ["global_etf_rotation","tecl_xlk_trend_income","hk_global_etf_tactical_rotation","hk_low_vol_dividend_quality_snapshot","hk_equity_combo","cn_industry_etf_rotation","cn_industry_etf_rotation_aggressive","cn_index_etf_tactical_rotation","cn_chinext_tactical_rotation","cn_chinext_growth_momentum_quality","cn_dividend_quality_snapshot","cn_chinext_growth_momentum_quality_snapshot","cn_star_growth_momentum_quality","cn_equity_combo"].includes(profile);\n}\n`;
function parse(ts,bytes){
 if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>10*1024*1024)fail();
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),sf=ts.createSourceFile('worker.js',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 if(sf.parseDiagnostics.length || /\b__qrs958Frozen\b/.test(text))fail();const found=new Map();let defaults=0;
 for(const n of sf.statements){
  if(ts.isFunctionDeclaration(n)&&n.name){if(n.name.text==='__qrs958Frozen')fail();if(names.includes(n.name.text)){if(found.has(n.name.text))fail();found.set(n.name.text,n)}}
  if(ts.isVariableStatement(n))for(const d of n.declarationList.declarations)if(ts.isIdentifier(d.name)&&d.name.text==='DEFAULT_STRATEGY_PROFILES')defaults++;
 }
 if(found.size!==names.length||defaults!==1)fail();return {text,sf,found};
}
const code=(p,n)=>p.text.slice(n.getStart(p.sf),n.end);
export function buildFreezeCandidate(ts,baseline,active){
 const selector=inspectSelector(ts,baseline,active,true);
 const ref=parse(ts,baseline),old=parse(ts,active),current=parse(ts,selector.candidate);
 for(const name of names)if(code(ref,ref.found.get(name))!==code(old,old.found.get(name))||(name!=='accountDraftStrategyChoices' && code(old,old.found.get(name))!==code(current,current.found.get(name))))fail();
 const replacements=[];
 for(const name of editableNames){
  const node=current.found.get(name),original=code(current,node);let modified=original;
  if(name==='accountDraftStrategyChoices'){
   const from='profile.frozen === true';
   if(original.split(from).length!==2)fail();modified=original.replace(from,'__qrs958Frozen(profile)');
  }else if(name==='normalizeStrategyProfilesPayload'){
   const from='if (item.frozen === true)';
   if(original.split(from).length!==2)fail();modified=original.replace(from,'if (__qrs958Frozen(item))');
  }else if(name==='buildAdminState'){
   const from='(item) => (item.allowed_execution_modes || []).includes("dry_run")';
   if(original.split(from).length!==2)fail();modified=original.replace(from,'(item) => !__qrs958Frozen(item) && (item.allowed_execution_modes || []).includes("dry_run")');
  }else if(name==='syncAccountDefaultResponse'){
   const replacements=[
    ['const inputs = normalizeSwitchInputs(rawInput);', 'let inputs;\n  try {\n    inputs = normalizeSwitchInputs(rawInput);\n  } catch (error) {\n    if (__qrs958Frozen({ profile: rawInput?.strategy_profile })) throw new HttpError("frozen strategy requires valid continuity input", 409);\n    throw error;\n  }'],
    ['if (!accountOption) {', 'if (!accountOption) {\n    if (__qrs958Frozen(strategy)) throw new HttpError("frozen strategy cannot register a new account", 409);'],
    ['assertStrategyAllowedForAccount(inputs, accountOption, strategyProfiles);', 'if (__qrs958Frozen(strategy) && accountOption.default_strategy_profile !== inputs.strategy_profile) throw new HttpError("frozen strategy requires a matching account default", 409);\n  assertStrategyAllowedForAccount(inputs, accountOption, strategyProfiles);'],
   ];
   for(const [from,to] of replacements){if(modified.split(from).length!==2)fail();modified=modified.replace(from,to)}
  }else{
   const before='if (executionMode === "live")';
   if(original.split(before).length!==2)fail();
   const gate=`if (__qrs958Frozen(strategy) && !(\n    ["RECONCILE_ONLY", "RISK_REDUCTION_ONLY"].includes(inputs.live_continuity_state) && isEligibleLegacyContinuityInput(inputs, strategy)\n  )) {\n    throw new HttpError(\`strategy \${inputs.strategy_profile} is frozen for new selection\`, 409);\n  }\n  `;
   modified=original.replace(before,gate+before);
  }
  replacements.push({start:node.getStart(current.sf),end:node.end,original,modified});
 }
 // Add the helper immediately before an exact, unique top-level function.
 const pos=current.found.get('normalizeStrategyProfilesPayload').getStart(current.sf);
 replacements.push({start:pos,end:pos,original:'',modified:helper});
 replacements.sort((a,b)=>b.start-a.start||b.end-a.end);
 let output=current.text;
 for(const r of replacements){if(output.slice(r.start,r.end)!==r.original)fail();output=output.slice(0,r.start)+r.modified+output.slice(r.end)}
 // A fresh parser must accept the result; exact offset insertions preserve every other byte.
 const parsed=ts.createSourceFile('worker.js',output,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);if(parsed.parseDiagnostics.length)fail();
 const final=Buffer.from(output,'utf8');
 return {candidate:final,report:{active_code_sha256:sha(active),two_insertions_sha256:selector.report.candidate_code_sha256,candidate_code_sha256:sha(final),historic_freeze_functions_match:true,freeze_changes_bounded:true}};
}
