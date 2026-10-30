import {test} from 'node:test';
import assert from 'node:assert/strict';
import {replaceExact,verify946} from '../scripts/console_946_patch.mjs';

test('replacement is exact, reversible, and preserves surrounding text', () => {
  const old='prefix old-one middle old-two suffix';
  const changes=[{oldText:'old-one',newText:'new-one'}, {oldText:'old-two',newText:'new-two-long'}];
  const actual=replaceExact(old,changes);
  assert.equal(actual,'prefix new-one middle new-two-long suffix');
  assert.equal(replaceExact(actual,changes.map(x=>({oldText:x.newText,newText:x.oldText}))),old);
});
test('missing, duplicate, empty and overlapping replacements fail closed', () => {
  for (const [s,p] of [
    ['abc',[{oldText:'z',newText:'x'}]],
    ['abcabc',[{oldText:'abc',newText:'x'}]],
    ['abc',[{oldText:'',newText:'x'}]],
    ['abcdef',[{oldText:'bcd',newText:'x'},{oldText:'cde',newText:'y'}]],
  ]) assert.throws(()=>replaceExact(s,p));
});
test('unapproved bundle hashes cannot enter the verifier', () => {
  assert.throws(()=>verify946(null,null,Buffer.from('old'),Buffer.from('new'),Buffer.from('active'),null,null),/unapproved_synthetic_bundles/);
});
