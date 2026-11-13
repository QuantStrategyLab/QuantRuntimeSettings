import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { bootsLegacyConsole } from '../web/strategy-switch-console/frontend/src/desk/router.ts';
const source = readFileSync('web/strategy-switch-console/frontend/src/main.tsx', 'utf8')
  .replace(/^import .*;\n/gm, '')
  .replace('import("./desk/DeskApp")', 'loadDesk()')
  .replace('<App />', '"old-app"');
function boot(hash, search = '') {
  let reloads = 0, oldMounts = 0, deskMounts = 0;
  const listeners = {};
  const window = { location: { hash, search, reload() { reloads++; } }, addEventListener(event, fn) { listeners[event] = fn; } };
  vm.runInNewContext(source, { window, document: { documentElement: { dataset: {} }, getElementById: () => ({}) },
    loadPreferences: () => ({ theme: 'light', language: 'zh' }), resolveTheme: () => 'light', bootsLegacyConsole,
    createRoot: () => ({ render() { oldMounts++; } }), loadDesk: async () => ({ mountDesk() { deskMounts++; } }) });
  return { window, change(next) { window.location.hash = next; listeners.hashchange?.(); },
    counts: () => ({ reloads, oldMounts, deskMounts }) };
}
// Official root: "/" with an empty hash mounts the Desk, not the old console.
const root = boot('');
await Promise.resolve();
assert.deepEqual(root.counts(), { reloads: 0, oldMounts: 0, deskMounts: 1 }, 'empty hash mounts Desk');
root.change('#/desk/alerts'); assert.equal(root.counts().reloads, 0, 'Desk navigation stays within application');
root.change(''); assert.equal(root.counts().reloads, 0, 'clearing the hash stays in Desk');
root.change('#/overview'); assert.equal(root.counts().reloads, 0, 'unknown hash stays in Desk');
for (const [hash, search] of [['#', ''], ['#/desktop', ''], ['#/deskx', ''], ['#desk', ''], ['#/overview', ''], ['', '?page=overview'], ['', '?page=nope'], ['', '?lang=en']]) {
  const entry = boot(hash, search);
  await Promise.resolve();
  assert.deepEqual(entry.counts(), { reloads: 0, oldMounts: 0, deskMounts: 1 }, `${search}${hash} mounts Desk`);
}
const desk = boot('#/desk/alerts');
await Promise.resolve();
assert.equal(desk.counts().deskMounts, 1, 'first hash load mounts Desk');
desk.change('#/desk/accounts'); assert.equal(desk.counts().reloads, 0);
// Explicit legacy deep links (the Worker's credential-rotation link) still open the old console.
const legacy = boot('#credential-rotation', '?page=health');
await Promise.resolve();
assert.deepEqual(legacy.counts(), { reloads: 0, oldMounts: 1, deskMounts: 0 }, 'legacy deep link mounts old console');
legacy.change(''); assert.equal(legacy.counts().reloads, 0, 'old console keeps its own hash changes');
legacy.change('#/desk/alerts'); assert.equal(legacy.counts().reloads, 1, 'legacy console to Desk switches application');
const legacyDesk = boot('#/desk/accounts', '?page=decisions');
await Promise.resolve();
assert.equal(legacyDesk.counts().deskMounts, 1, '#/desk wins over a legacy query');
legacyDesk.change('#/overview'); assert.equal(legacyDesk.counts().reloads, 1, 'leaving #/desk with a legacy query returns to the old console');
for (const search of ['?page=decisions', '?page=accounts', '?page=performance', '?page=strategies', '?workspace=research']) {
  assert.equal(boot('', search).counts().oldMounts, 1, search);
}
const html = readFileSync('web/strategy-switch-console/frontend/index.html', 'utf8');
assert.doesNotMatch(html, /<title>总览/, 'static title is not the old overview');
console.log('PASS: Desk default entry, Desk navigation, legacy deep links, static title');
