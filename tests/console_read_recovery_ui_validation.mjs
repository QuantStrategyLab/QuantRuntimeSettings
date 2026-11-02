import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { build } from '../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js';
import React from '../web/strategy-switch-console/frontend/node_modules/react/index.js';
import { renderToStaticMarkup } from '../web/strategy-switch-console/frontend/node_modules/react-dom/server.node.js';

// Renders the live InboxReadFailed component (the unreadable-inbox state used by the
// decisions/inbox surface). Dropped with the legacy tree, no live equivalent to SSR:
// - AccountsPage "暂无账户" / "账户清单暂不可用": live AccountsPage takes only route
//   params and loads through useApi, so its directory-unavailable prop state no longer exists.
// - Legacy DecisionsPage props (blocked/sources/retrying) partial-source and busy states:
//   the live page self-loads; its partial notice is covered in promotion_queue_partial_validation.
const frontend = new URL('../web/strategy-switch-console/frontend/', import.meta.url).pathname;
const temporary = await mkdtemp(frontend + 'node_modules/.read-recovery-');
try {
  const compiled = await build({
    stdin: { contents: 'export { InboxReadFailed } from "./components/InboxReadFailed"; export { I18nProvider } from "./i18n"; export { HttpError, AccessError } from "./api/client";', resolveDir: frontend + 'src', loader: 'tsx' },
    bundle: true, platform: 'node', format: 'esm', packages: 'external', write: false, jsx: 'automatic',
  });
  const file = temporary + '/components.mjs';
  await writeFile(file, compiled.outputFiles[0].text);
  const { InboxReadFailed, I18nProvider, HttpError, AccessError } = await import(pathToFileURL(file));
  const render = (props, language = 'zh') => renderToStaticMarkup(React.createElement(I18nProvider, { language }, React.createElement(InboxReadFailed, props)));

  const retry = () => {};
  const unknown = render({ error: new Error('boom'), onRetry: retry });
  assert.match(unknown, /role="alert"/);
  assert.match(unknown, /data-state="unknown"/);
  assert.match(unknown, /待办暂时无法读取/);
  assert.match(unknown, /待办与审批数量暂时无法确认/, 'unread sources are never shown as a zero count');
  assert.match(unknown, /重新读取待办/);
  assert.doesNotMatch(unknown, /暂无需要你决定的事项/, 'unread sources are not a confirmed empty queue');

  const noRetry = render({ error: new Error('boom') });
  assert.doesNotMatch(noRetry, /<button/);

  const incomplete = render({ data: { error_state: 'index_incomplete', directory: { complete: false, retry_at: Date.parse('2026-10-15T08:00:00Z') } }, onRetry: retry });
  assert.match(incomplete, /data-state="index_incomplete"/);
  assert.match(incomplete, /待办列表尚未更新完成/);
  assert.match(incomplete, /最早重试时间/);
  assert.match(incomplete, /重新读取待办/);

  const denied = render({ error: new AccessError(401), onRetry: retry });
  assert.match(denied, /data-state="unauthorized"/);
  assert.match(denied, /待办访问受限/);
  assert.match(denied, /重新登录/);
  assert.doesNotMatch(denied, /<button/, 'unauthorized is not retryable');

  const en = render({ error: new Error('boom'), onRetry: retry }, 'en');
  assert.match(en, /Todos could not be read/);
  assert.match(en, /Read todos again/);
  console.log('console_read_recovery_ui_validation: PASS (live InboxReadFailed unknown, incomplete, unauthorized, no-retry and English states)');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
