import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js';

const root = new URL('../web/strategy-switch-console/frontend/', import.meta.url).pathname;
const dir = await mkdtemp(join(tmpdir(), 'runtime-control-ui-'));
try {
  const outfile = join(dir, 'render.cjs');
  await build({ stdin: { resolveDir: root, contents: `
    import { createElement as h } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { I18nProvider } from './src/i18n';
    import { ControlsTab } from './src/pages/accounts/ControlsTab';
    export function render(language, control, platform = 'ibkr') {
      const account = {platform, account_alias:'synthetic'};
      const actions = Object.fromEntries(['enable','stop','resume','approve_application'].map(k => [k, {enabled:true}]));
      globalThis.__controlState = {phase:'ready', data:{...account, actions, runtime_control:control}};
      return renderToStaticMarkup(h(I18nProvider,{language},h(ControlsTab,{account, config:null, confirm:async()=>false})));
    }` }, bundle:true, platform:'node', format:'cjs', outfile, jsx:'automatic',
    loader:{'.css':'empty'}, define:{'import.meta.env':'{}'}, plugins:[{name:'mock-api',setup(b) {
      b.onLoad({filter:/\/lib\/hooks\.ts$/}, () => ({contents:'export const useApi = () => ({...globalThis.__controlState, reload() {}});', loader:'js'}));
    }}] });
  const {render} = createRequire(import.meta.url)(outfile);
  for (const [action, expected] of [['enable','已启用'],['disable','已停用']]) {
    assert.match(render('zh', {phase:'applied', action, platform_applied:true}), new RegExp(`>${expected}<`));
  }
  assert.match(render('en', {phase:'applied', action:'enable', platform_applied:true}), />Enabled</);
  assert.match(render('en', {phase:'applied', action:'disable', platform_applied:true}), />Disabled</);
  for (const control of [null, {phase:'applied',action:'enable',platform_applied:false},
    {phase:'applied',action:null,platform_applied:true}, {phase:'unknown',action:'enable',platform_applied:true},
    {phase:'protected',action:'enable',platform_applied:true}]) {
    assert.doesNotMatch(render('zh', control), />已(?:启用|停用)</);
  }
  assert.doesNotMatch(render('zh', {phase:'applied',action:'enable',platform_applied:true}, 'longbridge'), />已启用</);
  console.log('console_runtime_control_result_ui_validation: PASS');
} finally { await rm(dir, {recursive:true,force:true}); }
