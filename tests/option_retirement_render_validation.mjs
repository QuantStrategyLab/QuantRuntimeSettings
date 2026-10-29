import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {build} from '../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js';
import React from '../web/strategy-switch-console/frontend/node_modules/react/index.js';
import {renderToStaticMarkup} from '../web/strategy-switch-console/frontend/node_modules/react-dom/server.node.js';
const frontend=new URL('../web/strategy-switch-console/frontend/',import.meta.url).pathname;
const temporary=await mkdtemp(frontend+'node_modules/.retired-option-');
try {
  const compiled=await build({stdin:{contents:'export { DiffSummary } from "./pages/accounts/StrategyTab";',resolveDir:frontend+'src',loader:'tsx'},bundle:true,platform:'node',format:'esm',packages:'external',write:false});
  const file=temporary+'/component.mjs';await writeFile(file,compiled.outputFiles[0].text);
  const {DiffSummary}=await import(pathToFileURL(file));
  const rows=[{section:'income_layer',field:'income_layer_enabled',current:true,current_status:'known',overridden:true,draft:false},
    {section:'options_layer',field:'option_overlay_enabled',current:true,current_status:'known',overridden:true,draft:true}];
  const html=renderToStaticMarkup(React.createElement(DiffSummary,{rows,t:key=>key}));
  assert.match(html,/accounts\.section\.income_layer/);
  assert.doesNotMatch(html,/accounts\.section\.options_layer|option_overlay_enabled/);
  assert.equal(rows[1].draft,true);
  console.log('option retirement UI: actual account summary retains income and hides retired options');
} finally { await rm(temporary,{recursive:true,force:true}); }
