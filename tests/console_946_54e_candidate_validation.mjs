// Run only after both fixed builders in the same unprivileged CI job.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {verify946OnFixed54e} from '../scripts/console_946_54e_patch.mjs';
import {classify946Readonly} from '../scripts/console_946_readonly_state.mjs';
import {testCandidate946} from '../scripts/console_946_runtime_test.mjs';
const frontend=createRequire(new URL('../web/strategy-switch-console/frontend/package.json',import.meta.url));
const worker=createRequire(new URL('../web/strategy-switch-console/package.json',import.meta.url));
const ts=frontend('typescript'),trace=worker('@jridgewell/trace-mapping');
const reference=await readFile(join(process.env.RUNNER_TEMP,'qrs54e-baseline/worker.js'));
const candidate=await verify946OnFixed54e(ts,trace,reference);
assert.ok(!candidate.equals(reference),'the fixed candidate contains the reviewed changes');
assert.deepEqual(classify946Readonly(reference,reference,candidate),{patch_ready:true,already_applied:false});
assert.deepEqual(classify946Readonly(candidate,reference,candidate),{patch_ready:false,already_applied:true});
await assert.rejects(verify946OnFixed54e(ts,trace,candidate),/active_54e_bytes_mismatch/,
  'the release verifier must continue to reject an already-patched active module');
assert.throws(()=>classify946Readonly(Buffer.concat([candidate,Buffer.from('\n')]),reference,candidate),/active_54e_bytes_mismatch/);
// Any trailing byte difference is rejected, even when AST statements match.
const tail=Buffer.from('\n//# sourceMappingURL=synthetic-test-only.map\n');
await assert.rejects(verify946OnFixed54e(ts,trace,Buffer.concat([reference,tail])),/active_54e_bytes_mismatch/);
const sf=ts.createSourceFile('worker.js',reference.toString('utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const varStmt=sf.statements.find(s=>ts.isVariableStatement(s)&&s.declarationList.declarations.some(d=>ts.isIdentifier(d.name)&&d.name.text==='V2_PAGE_HTML'));
assert.ok(varStmt,'historical asset statement exists');
const source=reference.toString('utf8'), start=varStmt.getStart(sf),end=varStmt.end;
const changed=Buffer.from(source.slice(0,start)+'var V2_PAGE_HTML = "synthetic-changed";'+source.slice(end));
await assert.rejects(verify946OnFixed54e(ts,trace,changed),/active_54e_bytes_mismatch/,'asset differences are not skipped');
const wrapper=sf.statements.find(s=>ts.isFunctionDeclaration(s)&&s.name?.text==='accountFactsHistoryResponse2');
assert.ok(wrapper,'historical history wrapper exists');
const wrapperStart=wrapper.getStart(sf), wrapperCode=source.slice(wrapperStart,wrapper.end);
assert.ok(!wrapperCode.includes('*/'));
const altered=wrapperCode.replace('loadAccountFactsBindings,','loadAccountFactsBindings: null,');
assert.notEqual(altered,wrapperCode);
const decoy=Buffer.from(source.slice(0,wrapperStart)+altered+source.slice(wrapper.end)+'\n/*'+wrapperCode+'*/\n');
await assert.rejects(verify946OnFixed54e(ts,trace,decoy),/active_54e_bytes_mismatch/,'old function text in a comment cannot authorize a changed function');
await testCandidate946(candidate);
console.log(JSON.stringify({ok:true,fixed_54e_candidate_verified:true,synthetic_worker_runtime_passed:true,
  non_target_bytes_preserved:true,instrumentation:'fixed_test_copy_only'}));
