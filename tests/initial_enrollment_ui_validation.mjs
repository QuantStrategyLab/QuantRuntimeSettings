import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js';
import { initialEnrollmentDigest } from '../web/strategy-switch-console/application/console_api/initial_enrollment.js';
const root=new URL('../web/strategy-switch-console/frontend/',import.meta.url).pathname;
const dir=await mkdtemp(join(tmpdir(),'initial-ui-'));
try {
 const outfile=join(dir,'render.cjs');
 await build({stdin:{resolveDir:root,contents:`import {createElement as h} from 'react';
  import {renderToStaticMarkup} from 'react-dom/server'; import {I18nProvider} from './src/i18n';
  import DecisionsPage from './src/pages/decisions/DecisionsPage';
  export {initialEnrollmentBinding,humanDecisionExpectation,reviewedDecisionMatches} from './src/operations';
  export function render(item,sources) {globalThis.__initialItem=item; globalThis.__initialSources=sources||[]; globalThis.__initialUseApi=0;
    return renderToStaticMarkup(h(I18nProvider,{language:'zh'},h(DecisionsPage)));}
  export function renderLang(item,language,sources) {globalThis.__initialItem=item; globalThis.__initialSources=sources||[]; globalThis.__initialUseApi=0;
    return renderToStaticMarkup(h(I18nProvider,{language},h(DecisionsPage)));}`},bundle:true,platform:'node',format:'cjs',outfile,jsx:'automatic',loader:{'.css':'empty'},define:{'import.meta.env':'{}'},plugins:[{name:'mock',setup(b){
   b.onLoad({filter:/\/lib\/hooks\.ts$/},()=>({contents:`export function useApi() {const n=globalThis.__initialUseApi++; return {phase:'ready',data:n===0?{status:'ok',items:[globalThis.__initialItem],sources:globalThis.__initialSources||[]}:n===1?{admin:true}:{},reload(){}};} export const createRequestGate=()=>({start:()=>1,current:()=>true,invalidate(){}});`,loader:'js'}));
   b.onLoad({filter:/\/pages\/decisions\/DecisionsPage\.tsx$/},async({path})=>({contents:(await readFile(path,'utf8')).replace('useState<string | null>(null);\n  const [busy','useState<string | null>(globalThis.__initialItem.id);\n  const [busy'),loader:'tsx'}));
 }}]});
 const ui=createRequire(import.meta.url)(outfile);
 const names=['positions','cash','open_orders','recent_executions','local_execution_ledger'];
 const kinds=['account_strategy_positions','returned_account_cash','all_client_open_orders','broker_requested_window','bounded_live_claims_and_outcomes'];
 const facts={observed_at:'2026-10-29T00:00:00Z',surfaces:Object.fromEntries(names.map((n,i)=>[n,{status:'complete',items:[],scope:{kind:kinds[i],currency:null,window_start:null,window_end:null,limit_per_namespace:null,gateway_availability:null,truncated:null}}]))};
 const candidate='a'.repeat(64), factsSha='b'.repeat(64), recovery_id='synthetic';
 const material={mode:'initial_enrollment',recovery_id,candidate_sha256:candidate,facts_sha256:factsSha};
 const material_sha256=await initialEnrollmentDigest(material);
 const entry={freshness:{data_status:'ready'},recovery:{...material,readiness:'awaiting_human_confirmation',blocker_codes:[]},decision_binding:{kind:'recovery',subject_id:recovery_id,material_sha256}};
 const body=ui.initialEnrollmentBinding(entry,'approve');
 assert.deepEqual(body,{...material,decision:'approve'});
 const expectation=await ui.humanDecisionExpectation('recovery',entry,body);
 assert.equal(ui.reviewedDecisionMatches(entry.decision_binding,expectation),true);
 assert.equal(ui.reviewedDecisionMatches({...entry.decision_binding,material_sha256:'c'.repeat(64)},expectation),false);
 assert.equal(ui.initialEnrollmentBinding({...entry,recovery:{...entry.recovery,readiness:'blocked',blocker_codes:['initial_enrollment_cash_incomplete']}},'approve'),null);
 const item={id:'reconciliation_recovery:synthetic',short_id:'IN-TEST',category:'reconciliation_recovery',priority:'high',created_at:null,expires_at:null,evidence_freshness:{status:'ready',as_of:null},status:'pending',affects_live:false,diff:[],account_alias:'synthetic',platform:'ibkr',decision_binding:entry.decision_binding,presentation:{material_kind:'initial_enrollment',strategy_profile:'synthetic'},initial_enrollment:{facts,candidate_sha256:candidate,facts_sha256:factsSha,readiness:'awaiting_human_confirmation',blocker_codes:[]}};
 const ready=ui.render(item); assert.match(ready,/initial-enrollment-facts/); assert.match(ready,/inbox-actions/);
 const blocked=ui.render({...item,initial_enrollment:{...item.initial_enrollment,readiness:'blocked',blocker_codes:['initial_enrollment_cash_incomplete'],facts:{...facts,surfaces:{...facts.surfaces,cash:{...facts.surfaces.cash,status:'unknown',items:null}}}}});
 assert.match(blocked,/initial-enrollment-facts/); assert.doesNotMatch(blocked,/class="inbox-actions"/); assert.match(blocked,/未知/);
 const missing=ui.render({...item,initial_enrollment:{...item.initial_enrollment,facts:null}});
 assert.doesNotMatch(missing,/class="inbox-actions"/);
 assert.doesNotMatch(blocked,/data-unknown="true"/);

 // Redundant internal audit copy: a normal recovery row already names its
 // category in the title, so the list drops the repeated badge; the raw short id
 // is shown once, in the detail header, and never again in "more info".
 const normal={...item,title_key:'decisions.reconciliation_recovery',presentation:null,initial_enrollment:null,evidence_freshness:{status:'ready',as_of:null}};
 for (const language of ['zh','en']) {
  const html=ui.renderLang(normal,language);
  const start=html.indexOf('class="inbox-item');
  assert.ok(start>=0,`${language}: the list row renders`);
  const row=html.slice(start,html.indexOf('</button>',start));
  assert.equal((row.match(/class="badge/g)||[]).length,1,`${language}: the row keeps only its status badge, not a repeated category`);
  assert.match(row,/badge-warn/,`${language}: the pending status badge stays`);
  assert.doesNotMatch(row,/class="item-ref"/,`${language}: the list shows no raw short id`);
  assert.match(row,new RegExp(language==='zh'?'对账恢复确认':'Reconciliation recovery'),`${language}: the title still names the category`);
  assert.equal((html.match(/class="decision-ref"/g)||[]).length,1,`${language}: the detail keeps exactly one header ref`);
  assert.match(html,/class="decision-ref">[^<]*IN-TEST/,`${language}: that ref is the traceable one`);
  assert.doesNotMatch(html,new RegExp(language==='zh'?'更多信息':'More info'),`${language}: no empty disclosure when there is nothing left to show`);
  assert.match(html,new RegExp(language==='zh'?'对账恢复':'Reconciliation recovery'),`${language}: the detail still names the category`);
  // The evidence timestamp is the only remaining disclosure content, so it
  // brings the block back rather than leaving an empty one — without the ref.
  const withAsOf=ui.renderLang({...normal,evidence_freshness:{status:'ready',as_of:'2026-10-29T00:00:00Z'}},language);
  const moreAt=withAsOf.indexOf(language==='zh'?'更多信息':'More info');
  assert.ok(moreAt>=0,`${language}: the timestamp disclosure survives`);
  const moreBlock=withAsOf.slice(moreAt,withAsOf.indexOf('</details>',moreAt));
  assert.ok(!moreBlock.includes('IN-TEST'),`${language}: the disclosure never repeats the ref`);
  assert.match(moreBlock,/asof/,`${language}: the disclosure still carries the evidence timestamp`);
  // A first-enrollment item keeps its category badge: its title is different.
  const enrollment=ui.renderLang(item,language);
  const enrollmentStart=enrollment.indexOf('class="inbox-item');
  const enrollmentRow=enrollment.slice(enrollmentStart,enrollment.indexOf('</button>',enrollmentStart));
  assert.equal((enrollmentRow.match(/class="badge/g)||[]).length,2,`${language}: first enrollment keeps category plus status`);
  assert.match(enrollmentRow,new RegExp(language==='zh'?'对账恢复':'Reconciliation recovery'),`${language}: the category still distinguishes the enrollment row`);
  assert.match(enrollmentRow,new RegExp(language==='zh'?'首次接入确认':'Initial enrollment'),`${language}: the enrollment title stays distinct`);
  assert.doesNotMatch(enrollmentRow,/class="item-ref"/,`${language}: enrollment rows show no raw short id either`);
  assert.equal((enrollment.match(/class="decision-ref"/g)||[]).length,1,`${language}: enrollment detail keeps its single header ref`);
 }

 // Normal recovery detail: the header ref is the only place the number appears.
 // A real material block renders here (non-empty presentation plus a ready
 // recovery source), so this cannot pass by counting classes on an empty block.
 const recoverySource={source:'recovery',status:'ok',current_reconciliation_observation:{
  label:{zh:'对账观测',en:'Reconciliation observation'},
  connection_status:'connected',data_status:'ready',comparison_status:'matched',
  status_label:{zh:'已接入 / 数据就绪',en:'Connected / data ready'},
  generated_at:'2026-10-29T00:00:00Z',computed_at:'2026-10-29T00:00:00Z',last_observed_at:'2026-10-29T00:00:00Z'}};
 const presentation={material_kind:'recovery_approval_material',
  label:{zh:'恢复审批材料',en:'Recovery approval material'},
  decision_status:'undecided',decision_status_label:{zh:'待确认',en:'Undecided'},
  strategy_profile:'synthetic',source_generated_at:'2026-10-29T00:00:00Z',
  source_computed_at:'2026-10-29T00:00:00Z',last_observed_at:'2026-10-29T00:00:00Z'};
 const normalRecovery={...normal,presentation};
 for (const language of ['zh','en']) {
  const html=ui.renderLang(normalRecovery,language,[recoverySource]);
  // The material block is genuinely present, not an empty disclosure.
  assert.match(html,/class="reconciliation-materials"/,`${language}: the material section renders`);
  assert.equal((html.match(/class="reconciliation-material"/g)||[]).length,1,`${language}: one material article for the selected item`);
  const articleAt=html.indexOf('class="reconciliation-material"');
  const article=html.slice(articleAt,html.indexOf('</article>',articleAt));
  assert.match(article,new RegExp(language==='zh'?'恢复审批材料':'Recovery approval material'),`${language}: the material keeps its label`);
  assert.equal((article.match(/<dt>/g)||[]).length,5,`${language}: status, freshness and the three timestamps survive`);
  assert.match(article,new RegExp(language==='zh'?'处理状态':'Processing status'),`${language}: the material keeps its decision status`);
  assert.match(article,new RegExp(language==='zh'?'待确认':'Undecided'),`${language}: the material keeps the status value`);
  assert.match(article,/datetime="2026-10-29T00:00:00Z"/i,`${language}: the material keeps its provenance timestamps`);
  assert.ok(article.includes(' · '),`${language}: the material keeps the strategy · account identity row`);
  // The number itself appears exactly once on the whole page — the header ref.
  assert.equal((html.match(/IN-TEST/g)||[]).length,1,`${language}: the short id appears once across the whole page`);
  assert.ok(html.includes(`class="decision-ref">${language==='zh'?'编号':'Ref'} IN-TEST`),`${language}: that one occurrence is the header ref`);
  assert.doesNotMatch(html,/class="reconciliation-ref"/,`${language}: the material row reuses the header ref instead of repeating the number`);
 }
 console.log('initial_enrollment_ui_validation: PASS');
} finally {await rm(dir,{recursive:true,force:true});}
