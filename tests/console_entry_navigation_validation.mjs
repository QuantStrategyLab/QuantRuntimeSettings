import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync('web/strategy-switch-console/frontend/src/main.tsx', 'utf8')
  .replace(/^import .*;\n/gm, '')
  .replace('import("./desk/DeskApp")', 'loadDesk()')
  .replace('<App />', '"old-app"');
function boot(hash) {
  let reloads = 0, oldMounts = 0, deskMounts = 0;
  const listeners = {};
  const window = { location: { hash, reload() { reloads++; } }, addEventListener(event, fn) { listeners[event] = fn; } };
  vm.runInNewContext(source, { window, document: { documentElement: { dataset: {} }, getElementById: () => ({}) },
    loadPreferences: () => ({ theme: 'light', language: 'zh' }), resolveTheme: () => 'light',
    createRoot: () => ({ render() { oldMounts++; } }), loadDesk: async () => ({ mountDesk() { deskMounts++; } }) });
  return { window, change(next) { window.location.hash = next; listeners.hashchange?.(); },
    counts: () => ({ reloads, oldMounts, deskMounts }) };
}
const old = boot('');
assert.equal(old.counts().oldMounts, 1);
old.change('#/overview'); assert.equal(old.counts().reloads, 0);
old.change('#/desk/alerts'); assert.equal(old.counts().reloads, 1, 'old home to Desk must switch application');
const desk = boot('#/desk/alerts');
await Promise.resolve();
assert.equal(desk.counts().deskMounts, 1, 'first hash load mounts Desk');
desk.change('#/desk/accounts'); assert.equal(desk.counts().reloads, 0, 'Desk navigation stays within application');
desk.change('#/overview'); assert.equal(desk.counts().reloads, 1, 'return to old home switches application');
for (const hash of ['#/desktop', '#/deskx', '#desk']) assert.equal(boot(hash).counts().oldMounts, 1);
console.log('PASS: first hash load, old-home to Desk, Desk navigation, old-home regression');
