// Bounded named-handler comparison shared by diagnostics and fixed resume.
import {createHash} from 'node:crypto';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const plainObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const canonical = x => JSON.stringify(x,(_k,v)=>plainObject(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const shape = x => x === undefined ? 'missing' : x === null ? 'null' : Array.isArray(x) ? 'array' : typeof x;
const publicExports=['RuntimeInstances','__test','default'];
const publicHandlers=['fetch','scheduled','researchNativeDailyReturns','effectiveAccountSettings','dispatchAccountDiagnosis'];
function delta(a,b) {
  const counts=xs=>{const m=new Map();for(const x of xs)m.set(x,(m.get(x)||0)+1);return m;};
  const left=counts(a),right=counts(b);let added=0,removed=0;
  for(const k of new Set([...left.keys(),...right.keys()])){const d=(right.get(k)||0)-(left.get(k)||0);if(d>0)added+=d;else removed-=d;}
  return {added,removed};
}
function inspectNamed(x) {
  if(!Array.isArray(x)||x.length>128)throw Error('invalid_named_handlers');
  for(const item of x) {
    if(!plainObject(item)||typeof item.name!=='string'||!item.name.length||item.name.length>128||
       (item.handlers!==undefined&&(!Array.isArray(item.handlers)||item.handlers.length>128||item.handlers.some(h=>typeof h!=='string'||!h.length||h.length>256)))||
       Object.keys(item).length>16||Buffer.byteLength(canonical(item))>8192)throw Error('invalid_named_handlers');
  }
  return x;
}
// Only fixed public names and aggregate counts leave this function.
export function describeNamedHandlers(active,staged) {
  const a=inspectNamed(active),b=inspectNamed(staged),names=x=>x.map(v=>v.name);
  const lexical=(left,right)=>left<right?-1:left>right?1:0;
  const fingerprint=x=>sha(Buffer.from(canonical(x.map(v=>({name:v.name,...(Object.hasOwn(v,'handlers')?{handlers:v.handlers}:{})}))
    .sort((left,right)=>lexical(left.name,right.name)||lexical(canonical(left),canonical(right)))), 'utf8'));
  const duplicates=x=>new Set(x).size!==x.length;
  const unknownNames=x=>names(x).filter(n=>!publicExports.includes(n));
  const unknownDelta=delta(unknownNames(a),unknownNames(b));
  const out={active_sha256:fingerprint(a),staged_sha256:fingerprint(b),active_count:a.length,staged_count:b.length,active_duplicate_names:duplicates(names(a)),staged_duplicate_names:duplicates(names(b)),
    unknown_names_added:unknownDelta.added,unknown_names_removed:unknownDelta.removed,exports:{}};
  const unknownMatched=new Set(unknownNames(a).filter(n=>unknownNames(b).includes(n)));
  let changed=0,complete=true;
  for(const name of unknownMatched){const aa=a.filter(x=>x.name===name),bb=b.filter(x=>x.name===name);
    if(aa.length!==1||bb.length!==1){complete=false;continue;}if(canonical(aa[0])!==canonical(bb[0]))changed++;}
  out.unknown_matched_entries_changed=changed;out.unknown_matched_comparison_complete=complete;
  for(const name of publicExports){
    const aa=a.filter(x=>x.name===name),bb=b.filter(x=>x.name===name);
    const entry={active_count:aa.length,staged_count:bb.length,active_duplicate:aa.length>1,staged_duplicate:bb.length>1};
    if(aa.length<=1&&bb.length<=1&&(aa.length||bb.length)){
      const x=aa[0]??{name},y=bb[0]??{name},h=x.handlers,k=y.handlers;
      const bothArrays=Array.isArray(h)&&Array.isArray(k);
      const u=bothArrays?delta(h.filter(v=>!publicHandlers.includes(v)),k.filter(v=>!publicHandlers.includes(v))):null;
      const other=v=>Object.fromEntries(Object.entries(v).filter(([key])=>!['name','handlers'].includes(key)));
      Object.assign(entry,{active_handler_count:Array.isArray(h)?h.length:null,staged_handler_count:Array.isArray(k)?k.length:null,
        active_duplicate_handlers:Array.isArray(h)?duplicates(h):null,staged_duplicate_handlers:Array.isArray(k)?duplicates(k):null,
        active_name_shape:aa.length?'string':'missing',staged_name_shape:bb.length?'string':'missing',
        active_handlers_shape:shape(h),staged_handlers_shape:shape(k),
        ordered_equal:aa.length&&bb.length?canonical(h)===canonical(k):null,multiset_equal:bothArrays?canonical([...h].sort())===canonical([...k].sort()):null,
        active_unknown_keys:Object.keys(other(x)).length>0,staged_unknown_keys:Object.keys(other(y)).length>0,
        other_key_shape_equal:canonical(Object.keys(other(x)).sort())===canonical(Object.keys(other(y)).sort()),other_fields_equal:canonical(other(x))===canonical(other(y)),
        unknown_handlers_added:u?.added??null,unknown_handlers_removed:u?.removed??null,handlers:{}});
      for(const method of publicHandlers)entry.handlers[method]={active_count:Array.isArray(h)?h.filter(v=>v===method).length:null,staged_count:Array.isArray(k)?k.filter(v=>v===method).length:null};
    }
    out.exports[name]=entry;
  }
  return out;
}
