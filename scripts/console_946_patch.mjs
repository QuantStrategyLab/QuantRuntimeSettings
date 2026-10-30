// Fixed #946 synthetic bundle verifier. No network, deploy or secret handling.
// The caller owns all buffers and must never log the active or candidate code.
import {createHash} from 'node:crypto';

const approved = Object.freeze({
  old: 'f7ee5a3f6d660d048ec2a3d7eab9298a022aff971a64c139a4604e9ca647a02a',
  new: '67939ee3b30e5c6c0ad036f943d5214c6c70cd717b5acbbb9207c15612dae30b',
});
const names = Object.freeze(['applyNativeDailyReturns', 'accountFactsHistoryResponse', 'accountFactsHistoryResponse2']);
const assetNames = new Set(['V2_BUILD_ID', 'V2_PAGE_HTML', 'V2_ASSETS']);
const limit = 10 * 1024 * 1024;
const fail = code => { throw Error(code); };
const mismatch = (count, types) => { const error=Error('active_dependency_or_wiring_mismatch'); error.mismatch_count=count; error.statement_types=types; throw error; };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function decode(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > limit) fail('invalid_bundle');
  let text;
  try { text = new TextDecoder('utf-8', {fatal:true}).decode(bytes); } catch { fail('invalid_bundle'); }
  if (!Buffer.from(text, 'utf8').equals(bytes)) fail('invalid_bundle');
  return text;
}
function uniqueOffset(text, piece) {
  if (!piece) fail('empty_patch_region');
  const start = text.indexOf(piece);
  if (start < 0 || text.indexOf(piece, start + 1) !== -1) fail('nonunique_patch_region');
  return start;
}
// Exported for synthetic tests; this helper alone is not release verification.
export function replaceExact(text, replacements) {
  const spans = replacements.map(({oldText,newText}) => ({start:uniqueOffset(text, oldText), oldText, newText}));
  spans.sort((a,b) => a.start - b.start);
  for (let i=1;i<spans.length;i++) if (spans[i].start < spans[i-1].start + spans[i-1].oldText.length) fail('overlapping_regions');
  let output = text;
  for (const item of spans.reverse()) output = output.slice(0,item.start) + item.newText + output.slice(item.start + item.oldText.length);
  return output;
}

function classify(ts, statement, source) {
  if (ts.isFunctionDeclaration(statement) && statement.name && names.includes(statement.name.text))
    return {kind:'target', name:statement.name.text};
  if (!ts.isVariableStatement(statement) || statement.declarationList.declarations.length !== 1) return {kind:'ordinary'};
  const declaration=statement.declarationList.declarations[0];
  if (!ts.isIdentifier(declaration.name) || !assetNames.has(declaration.name.text)) return {kind:'ordinary'};
  const name=declaration.name.text, value=declaration.initializer;
  if (!value) fail('asset_shape_invalid');
  if (name !== 'V2_ASSETS') {
    if (!ts.isStringLiteral(value)) fail('asset_shape_invalid');
  } else {
    if (!ts.isCallExpression(value) || !ts.isPropertyAccessExpression(value.expression)
      || !ts.isIdentifier(value.expression.expression) || value.expression.expression.text !== 'Object'
      || value.expression.name.text !== 'freeze' || value.arguments.length !== 1
      || !ts.isObjectLiteralExpression(value.arguments[0]) || value.arguments[0].properties.length > 1024) fail('asset_shape_invalid');
    const seen=new Set();
    for (const prop of value.arguments[0].properties) {
      if (!ts.isPropertyAssignment(prop) || !ts.isStringLiteral(prop.name) || seen.has(prop.name.text)
        || !ts.isObjectLiteralExpression(prop.initializer) || prop.initializer.properties.length !== 2) fail('asset_shape_invalid');
      seen.add(prop.name.text);
      const fields=new Set();
      for (const field of prop.initializer.properties) {
        if (!ts.isPropertyAssignment(field) || !(ts.isIdentifier(field.name) || ts.isStringLiteral(field.name))
          || !['contentType','base64'].includes(field.name.text) || fields.has(field.name.text)
          || !ts.isStringLiteral(field.initializer)) fail('asset_shape_invalid');
        fields.add(field.name.text);
      }
    }
  }
  return {kind:'asset',name};
}
function inspect(ts, text) {
  const sf=ts.createSourceFile('worker.js',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  if (sf.parseDiagnostics.length) fail('bundle_parse_failed');
  const functions=new Map(), assets=new Set(), sequence=[], kinds=[];
  for (const statement of sf.statements) {
    const type=classify(ts,statement,sf);
    const code=text.slice(statement.getStart(sf),statement.end);
    const kind=ts.SyntaxKind[statement.kind];
    kinds.push(['FunctionDeclaration','VariableStatement','ExpressionStatement','ImportDeclaration','ExportDeclaration'].includes(kind) ? kind : 'other');
    if (type.kind === 'target') {
      if (functions.has(type.name)) fail('duplicate_target');
      functions.set(type.name, {code, statement});
      sequence.push(`target:${type.name}`);
    } else if (type.kind === 'asset') {
      if (assets.has(type.name)) fail('duplicate_asset');
      assets.add(type.name);
      sequence.push(`asset:${type.name}`);
    } else sequence.push(`code:${code}`);
  }
  if (names.some(name=>!functions.has(name)) || [...assetNames].some(name=>!assets.has(name))) fail('required_statement_missing');
  return {sf,functions,sequence,kinds};
}
function checkSourceMap(ts, trace, map, result) {
  if (!map || map.version !== 3 || !Array.isArray(map.sources) || typeof map.mappings !== 'string') fail('invalid_source_map');
  const expected={applyNativeDailyReturns:'application/console_api/native_daily_returns.js',
    accountFactsHistoryResponse:'application/account_facts/read.js',accountFactsHistoryResponse2:'worker.js'};
  const traced=new trace.TraceMap(map);
  for (const name of names) {
    const node=result.functions.get(name).statement;
    const loc=ts.getLineAndCharacterOfPosition(result.sf,node.getStart(result.sf));
    const found=trace.originalPositionFor(traced,{line:loc.line+1,column:loc.character});
    if (typeof found.source !== 'string' || !found.source.replaceAll('\\','/').endsWith(expected[name]) || !Number.isInteger(found.line)) fail('source_map_target_mismatch');
  }
}

export function verify946(ts, trace, oldBytes, newBytes, activeBytes, oldMap, newMap) {
  if (digest(oldBytes) !== approved.old || digest(newBytes) !== approved.new) fail('unapproved_synthetic_bundles');
  const old=decode(oldBytes), next=decode(newBytes), active=decode(activeBytes);
  const before=inspect(ts,old), after=inspect(ts,next), live=inspect(ts,active);
  checkSourceMap(ts,trace,oldMap,before); checkSourceMap(ts,trace,newMap,after);
  // All top-level bindings, helper definitions and route wiring must be the
  // same as the fixed old build. Only data-only frontend asset declarations may
  // differ; this intentionally rejects unrelated backend changes.
  const differences=[];
  for (let i=0;i<Math.max(before.sequence.length,live.sequence.length);i++) {
    if (before.sequence[i]!==live.sequence[i]) differences.push(i);
  }
  if (differences.length) mismatch(differences.length, [...new Set(differences.slice(0,32).map(i => live.kinds[i] ?? 'missing'))]);
  // A matching byte sequence in a comment or unrelated literal is not an AST
  // match. Require the exact top-level function and the same unique offset.
  for (const name of names) {
    const expected=before.functions.get(name).code, actual=live.functions.get(name);
    if (actual.code !== expected) fail('active_target_mismatch');
    if (uniqueOffset(active,expected) !== actual.statement.getStart(live.sf)) fail('active_target_offset_mismatch');
  }
  const edits=names.map(name=>({oldText:before.functions.get(name).code,newText:after.functions.get(name).code}));
  if (edits.some(x=>x.oldText===x.newText)) fail('missing_reviewed_change');
  if (replaceExact(old,edits)!==next) fail('synthetic_diff_not_exact');
  const candidate=replaceExact(active,edits);
  if (replaceExact(candidate,edits.map(x=>({oldText:x.newText,newText:x.oldText})))!==active) fail('reverse_mismatch');
  // Reparse the exact candidate, reject malformed JS and changes to AST layout.
  const parsed=inspect(ts,candidate);
  if (parsed.sequence.length!==live.sequence.length || parsed.sequence.some((v,i)=>v!==live.sequence[i])) fail('candidate_layout_mismatch');
  for (const name of names) {
    const expected=after.functions.get(name).code, actual=parsed.functions.get(name);
    if (actual.code!==expected) fail('candidate_target_mismatch');
    if (uniqueOffset(candidate,expected)!==actual.statement.getStart(parsed.sf)) fail('candidate_target_offset_mismatch');
  }
  return Buffer.from(candidate,'utf8');
}
