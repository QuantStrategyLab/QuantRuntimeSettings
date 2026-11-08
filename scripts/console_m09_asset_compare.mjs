// Compare compiled asset declarations without evaluating either Worker.
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const names=['V2_BUILD_ID','V2_PAGE_HTML','V2_ASSETS'];
const require=createRequire(new URL('../web/strategy-switch-console/frontend/package.json',import.meta.url));

function declarations(ts,bytes) {
  if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>10*1024*1024)throw Error('invalid_module');
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  if(!Buffer.from(text,'utf8').equals(bytes))throw Error('invalid_module');
  const source=ts.createSourceFile('worker.js',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  if(source.parseDiagnostics.length)throw Error('invalid_module');

  const result=new Map();
  for(const statement of source.statements) {
    if(!ts.isVariableStatement(statement)) {
      if(statement.name&&ts.isIdentifier(statement.name)&&names.includes(statement.name.text))throw Error('unsupported_declaration');
      continue;
    }
    for(const entry of statement.declarationList.declarations) {
      if(!ts.isIdentifier(entry.name)||!names.includes(entry.name.text))continue;
      const name=entry.name.text;
      if(result.has(name)||statement.declarationList.declarations.length!==1||!entry.initializer)
        throw Error('ambiguous_declaration');
      const value=entry.initializer;
      if(name==='V2_ASSETS') {
        if(!ts.isCallExpression(value)||!ts.isPropertyAccessExpression(value.expression)||
           !ts.isIdentifier(value.expression.expression)||value.expression.expression.text!=='Object'||
           value.expression.name.text!=='freeze'||value.arguments.length!==1||
           !ts.isObjectLiteralExpression(value.arguments[0]))throw Error('unsupported_declaration');
      } else if(!ts.isStringLiteral(value)) {
        throw Error('unsupported_declaration');
      }
      result.set(name,text.slice(statement.getStart(source),statement.end));
    }
  }
  if(result.size!==names.length)throw Error('missing_declaration');
  return result;
}

export function compareAssetDeclarations(active,candidate,ts=require('typescript')) {
  try {
    const before=declarations(ts,active);
    const after=declarations(ts,candidate);
    const equal=Object.fromEntries(names.map(name=>[name,before.get(name)===after.get(name)]));
    const matches=Object.values(equal).every(Boolean);
    return {ok:matches,equal,reason:matches?'asset_declarations_equal':'asset_declarations_differ'};
  } catch(error) {
    const known=['invalid_module','ambiguous_declaration','unsupported_declaration','missing_declaration'];
    return {ok:false,reason:known.includes(error?.message)?error.message:'invalid_module'};
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  let result={ok:false,reason:'input_unavailable'};
  try {
    if(process.argv.length===4) {
      const [active,candidate]=await Promise.all(process.argv.slice(2).map(path=>readFile(path)));
      result=compareAssetDeclarations(active,candidate);
    }
  } catch {}
  console.log(JSON.stringify(result));
  if(!result.ok)process.exitCode=1;
}
