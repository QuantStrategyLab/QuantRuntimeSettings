import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectModule, probe } from '../scripts/console_active_module_probe.mjs';

const version = '01234567-89ab-cdef-0123-456789abcdef';
const deployment = '11234567-89ab-cdef-0123-456789abcdef';
const active = () => ({ deployments: [{ id: deployment, strategy: 'percentage', versions: [{ version_id: version, percentage: 100 }] }] });
const moduleVersion = (text = 'const trailingGap = hasGap(daily.at(-1), { date: input.today });') => ({
  id: version, modules: [{ name: 'worker.js', content_type: 'application/javascript+module', content_base64: Buffer.from(text).toString('base64') }],
});

test('reports only bounded structure and boolean markers, not code or identifiers', () => {
  const result = inspectModule(moduleVersion(), version);
  assert.equal(result.single_javascript_module, true);
  assert.equal(result.markers.trailing_gap_new, true);
  assert.equal(result.markers_unique.trailing_gap_new, true);
  const repeated = inspectModule(moduleVersion('var trailingGap = hasGap(daily.at(-1), { date: input.today });\nvar trailingGap = hasGap(daily.at(-1), { date: input.today });'), version);
  assert.equal(repeated.markers.trailing_gap_new, true);
  assert.equal(repeated.markers_unique.trailing_gap_new, false);
  assert.equal(result.markers.trailing_gap_old, false);
  assert.doesNotMatch(JSON.stringify(result), /01234567|const trailingGap/);
});
test('rejects missing, multiple, noncanonical or invalid module content', () => {
  for (const obj of [
    {...moduleVersion(), id: deployment},
    {...moduleVersion(), modules: []},
    {...moduleVersion(), modules: [...moduleVersion().modules, ...moduleVersion().modules]},
    {...moduleVersion(), modules: [{...moduleVersion().modules[0], content_base64: '!!!'}]},
    {...moduleVersion(), modules: [{...moduleVersion().modules[0], content_base64: '/w=='}]},
  ]) assert.throws(() => inspectModule(obj, version));
});
test('returns fixed categories for unsupported module shapes without exposing the name', () => {
  assert.throws(() => inspectModule({...moduleVersion(), modules: []}, version), {message: 'active_module_schema'});
  assert.throws(() => inspectModule({...moduleVersion(), modules: [{...moduleVersion().modules[0], name: 'private-name'}]}, version), {message: 'unsupported_module_name'});
  assert.throws(() => inspectModule({...moduleVersion(), modules: [{...moduleVersion().modules[0], content_type: 'private-type'}]}, version), {message: 'unsupported_module_type'});
  assert.throws(() => inspectModule({...moduleVersion(), modules: [{...moduleVersion().modules[0], content_base64: '!!!!'}]}, version), {message: 'encoding_invalid'});
});
test('accepts a five MiB module without regex stack exhaustion', () => {
  assert.equal(inspectModule(moduleVersion('a'.repeat(5 * 1024 * 1024)), version).single_javascript_module, true);
});
test('only performs two active deployment reads and one version-pinned module read', async () => {
  const calls = [];
  const result = await probe(async (path, beta) => {
    calls.push([path, beta]);
    return path.startsWith('/deployments') ? active() : moduleVersion();
  });
  assert.deepEqual(calls, [
    ['/deployments?page=1&per_page=10', false],
    [`/versions/${version}?include=modules`, true],
    ['/deployments?page=1&per_page=10', false],
  ]);
  assert.equal(result.active_observations_match, true);
  assert.doesNotMatch(JSON.stringify(result), /01234567|const trailingGap/);
});
test('stops on split traffic or deployment drift', async () => {
  let count = 0;
  await assert.rejects(probe(async path => path.startsWith('/deployments')
    ? (++count === 1 ? active() : { deployments: [{...active().deployments[0], id: version}] })
    : moduleVersion()), {message: 'observation_changed'});
  await assert.rejects(probe(async () => ({deployments: [{...active().deployments[0], versions: [{version_id: version, percentage: 50}]}]})));
});
