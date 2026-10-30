import assert from 'node:assert/strict';
import {test} from 'node:test';
import {classify946Readonly} from '../scripts/console_946_readonly_state.mjs';
const original=Buffer.from('synthetic-reference'),candidate=Buffer.from('synthetic-approved-candidate');
test('reports original and already-applied modules distinctly',()=>{
  assert.deepEqual(classify946Readonly(original,original,candidate),{patch_ready:true,already_applied:false});
  assert.deepEqual(classify946Readonly(candidate,original,candidate),{patch_ready:false,already_applied:true});
});
test('rejects every other byte sequence, including matching prefix or extra trailer',()=>{
  for(const input of [Buffer.from('synthetic-reference!'),Buffer.from('synthetic-approved-candidate\n'),
    Buffer.from('synthetic-approved-candidat'),Buffer.from('other')])
    assert.throws(()=>classify946Readonly(input,original,candidate),/active_54e_bytes_mismatch/);
});
test('rejects invalid or indistinguishable reference and candidate',()=>{
  assert.throws(()=>classify946Readonly(original,original,original),/readonly_baseline_invalid/);
  assert.throws(()=>classify946Readonly(original,Buffer.alloc(0),candidate),/readonly_baseline_invalid/);
  assert.throws(()=>classify946Readonly('not bytes',original,candidate),/readonly_baseline_invalid/);
});
