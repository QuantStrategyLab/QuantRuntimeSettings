import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { build } from '../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js';
import React from '../web/strategy-switch-console/frontend/node_modules/react/index.js';
import { renderToStaticMarkup } from '../web/strategy-switch-console/frontend/node_modules/react-dom/server.node.js';

const frontend = new URL('../web/strategy-switch-console/frontend/', import.meta.url).pathname;
const temporary = await mkdtemp(frontend + 'node_modules/.read-recovery-');
try {
  const compiled = await build({
    stdin: { contents: 'export { AccountsPage } from "./AccountsPage"; export { DecisionsPage } from "./DecisionsPage"; export { LocaleContext } from "./locales";', resolveDir: frontend + 'src', loader: 'tsx' },
    bundle: true, platform: 'node', format: 'esm', packages: 'external', write: false,
  });
  const file = temporary + '/components.mjs';
  await writeFile(file, compiled.outputFiles[0].text);
  const { AccountsPage, DecisionsPage, LocaleContext } = await import(pathToFileURL(file));
  const render = (component, props, language = 'zh') => renderToStaticMarkup(React.createElement(LocaleContext.Provider, { value: language }, React.createElement(component, props)));
  const accountProps = { rows: [], selectedId: '', unresolvedSaves: new Map(), detailOpen: false, settingsEpoch: 0, refreshToken: 0, stopAllowed: false, stopLabel: '', stopRefreshVisible: false, resumeVisible: false, onSelect() {}, onBack() {}, onDirty() {}, onStop() {}, onRefreshStop() {}, onResume() {}, onSettingsRead() {}, resolveStrategy: () => ({ name: '', note: '' }) };
  const empty = render(AccountsPage, accountProps);
  assert.match(empty, /暂无账户/);
  assert.doesNotMatch(empty, /<table/);
  const failed = render(AccountsPage, { ...accountProps, directoryUnavailable: true });
  assert.match(failed, /账户清单暂不可用/);
  assert.doesNotMatch(failed, /暂无账户/);
  assert.match(render(AccountsPage, { ...accountProps, directoryUnavailable: true }, 'en'), /Account list unavailable/);
  const decisionProps = { blocked: true, items: [], sources: { promotions: 'ready', owners: 'stale', recovery: 'ready' }, admin: false, busy: false, selectedAccountId: '', onSelectAccount() {}, onDecide() {}, onRetry() {} };
  assert.match(render(DecisionsPage, decisionProps), /重新读取待办/);
  assert.doesNotMatch(render(DecisionsPage, decisionProps), /暂无需要你决定的事项/, 'unread sources are not a confirmed empty queue');
  const item = { id: 'synthetic-1', kind: 'promotion', title: 'Synthetic proposal', kicker: '新策略方案', question: '是否采用这项方案？', currentName: '当前策略', proposedName: 'Synthetic proposal', accountLine: '', accountChoices: [], materialNotes: [], reference: 'synthetic-1', technical: '{}', impact: '采用只记录你的意向，账户策略和交易权限保持不变。', canAdopt: false, canReject: false };
  const partial = render(DecisionsPage, { ...decisionProps, items: [item], sources: { ...decisionProps.sources, owners: 'failed' } });
  assert.match(partial, /部分待办暂时无法读取/);
  assert.match(partial, /重新读取待办/);
  assert.match(partial, /Synthetic proposal/);
  assert.doesNotMatch(partial, /暂无需要你决定的事项/);
  assert.match(render(DecisionsPage, { ...decisionProps, retrying: true }), /disabled=""[^>]*>正在读取…/);
  assert.doesNotMatch(render(DecisionsPage, { ...decisionProps, blocked: false, sources: { promotions: 'ready', owners: 'ready', recovery: 'ready' } }), /重新读取待办/);
  console.log('console_read_recovery_ui_validation: PASS (actual React empty, failed, partial, busy and English states)');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
