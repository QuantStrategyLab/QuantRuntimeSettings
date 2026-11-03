import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const html = await read('scripts/offline_reconciliation/index.html');
const script = await read('scripts/offline_reconciliation/view.js');
const fixtureText = await read('tests/fixtures/forward_reconciliation/sample-account-facts.json');
const fixture = JSON.parse(fixtureText);

function loadLedger() {
  const sandbox = { console, URLSearchParams };
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox, { filename: 'view.js' });
  return { ledger: vm.runInContext('ObservationLedger', sandbox), sandbox };
}

function element(id = '') {
  const attributes = {};
  return {
    id, textContent: '', innerHTML: '', hidden: false, title: '', dataset: {},
    classList: { contains() { return false; }, add() {}, remove() {} },
    setAttribute(name, value) { attributes[name] = value; this[name] = value; },
    getAttribute(name) { return Object.hasOwn(attributes, name) ? attributes[name] : null; },
    append() {}, addEventListener() {},
  };
}

function makeDocument() {
  const elements = new Map();
  const language = ['zh-CN', 'en'].map(value => {
    const button = element(`lang-${value}`);
    button.dataset.v = value;
    button.classList = { contains: name => name === 'js-l' };
    return button;
  });
  const theme = ['light', 'dark'].map(value => {
    const button = element(`theme-${value}`);
    button.dataset.v = value;
    button.classList = { contains: name => name === 'js-t' };
    return button;
  });
  const document = {
    title: '',
    documentElement: { lang: '', dataset: {} },
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element(id));
      return elements.get(id);
    },
    createElement(tag) { return element(tag); },
    querySelectorAll(selector) {
      if (selector === '.js-l') return language;
      if (selector === '.js-t') return theme;
      if (selector === '.js-l, .js-t') return [...language, ...theme];
      return [];
    },
  };
  return { document, elements, buttons: { language, theme } };
}

function makeWindow() {
  const stored = new Map();
  return {
    navigator: { language: 'en', languages: ['en'] },
    localStorage: {
      getItem(key) { return stored.has(key) ? stored.get(key) : null; },
      setItem(key, value) { stored.set(key, value); },
    },
    matchMedia() { return { matches: false }; },
    stored,
  };
}

const now = Date.parse('2026-11-03T12:00:00Z');
const { ledger } = loadLedger();
assert.ok(ledger, 'view exports the ObservationLedger API');
assert.deepEqual(Object.keys(ledger.LOCALES['zh-CN']).sort(), Object.keys(ledger.LOCALES.en).sort(),
  'locale key sets must be identical');
for (const locale of ['zh-CN', 'en']) {
  for (const [key, value] of Object.entries(ledger.LOCALES[locale])) {
    assert.equal(typeof value, 'string', `${locale}.${key} must be a string`);
    assert.ok(value.length > 0, `${locale}.${key} must not be empty`);
  }
}
assert.deepEqual(JSON.parse(JSON.stringify(ledger.SAMPLE_ACCOUNTS)), fixture.accounts,
  'inline sample must match the checked-in synthetic fixture');

// Honest cell mapping: missing/unknown never becomes Reconciled or Mismatch.
assert.equal(ledger.cellStatus(null, 'positions'), 'open');
assert.equal(ledger.cellStatus(null, 'opening'), 'open');
assert.equal(ledger.cellStatus({ baseline_status: 'missing' }, 'opening'), 'open');
assert.equal(ledger.cellStatus({ baseline_status: 'present' }, 'opening'), 'np');
assert.equal(ledger.cellStatus({ dimensions: { positions: 'UNRECONCILED' } }, 'positions'), 'open');
assert.equal(ledger.cellStatus({ dimensions: {} }, 'cash'), 'open');
assert.equal(ledger.cellStatus({ dimensions: { events: 'RECONCILED' } }, 'events'), 'np');
assert.equal(ledger.cellStatus({ dimensions: { events: 'MATCHED' } }, 'events'), 'np');
assert.equal(ledger.cellStatus({ dimensions: { events: 'UNRECONCILED' } }, 'fills'), 'np');
assert.equal(ledger.cellStatus({ dimensions: { events: 'UNRECONCILED' } }, 'fees'), 'np');

const rows = ledger.buildRows(fixture.accounts);
const tally = ledger.buildTally(rows);
assert.equal(tally.ok, 0, 'this contract cannot supply a reconciled cell');
assert.equal(tally.bad, 0, 'this contract cannot supply a mismatch cell');
assert.ok(tally.open > 0 && tally.np > 0, 'fixture exercises unreconciled and not-proven cells');
assert.equal(tally.ok + tally.bad + tally.open + tally.np, rows.length * ledger.DIMS.length,
  'tally sum must equal the number of cells');

// No mutating controls in the static page.
assert.doesNotMatch(html, /<form\b/i);
assert.doesNotMatch(html, /method\s*=\s*["']post/i);
for (const match of html.matchAll(/<button\b([^>]*)>/gi)) {
  assert.match(match[1], /type="button"/, 'every button must be an inert type=button');
  assert.match(match[1], /class="js-(?:l|t)"/, 'buttons are limited to display toggles');
}
assert.match(html, /<script type="module" src="\/offline-reconciliation\.js">/);
assert.match(html, /<link rel="stylesheet" href="\/offline-reconciliation\.css">/);
assert.doesNotMatch(script, /method\s*:\s*['"]POST['"]/i);
assert.doesNotMatch(script, /\/api\/(?:switch|runtime-stop|reconciliation-recovery-confirmations)/);

// Synthetic fixture identifiers only; the page never renders account_key values.
for (const account of fixture.accounts) {
  assert.match(account.account_key, /^acct-\d{4}$/, 'fixtures use fake account keys');
}
assert.doesNotMatch(fixtureText, /@|token|secret|password|api[_-]?key/i);

// Successful sample render.
{
  const { document, elements } = makeDocument();
  const win = makeWindow();
  let fetched = false;
  const result = await ledger.main({
    document, window: win, search: '?sample=1&lang=en&theme=dark', now,
    fetchImpl: async () => { fetched = true; throw new Error('sample mode must not fetch'); },
  });
  assert.equal(fetched, false);
  assert.equal(result.error, false);
  assert.equal(result.errorCode, null);
  assert.equal(document.documentElement.lang, 'en');
  assert.equal(document.documentElement.dataset.theme, 'dark');
  assert.equal(document.title, 'The Observation Ledger');
  const matrix = elements.get('mx').innerHTML;
  assert.match(matrix, /<th scope="col">Platform<\/th>/);
  assert.match(matrix, /<th scope="row" class="pf">/);
  assert.match(matrix, /aria-label="Unreconciled"/);
  assert.match(matrix, /aria-label="Not proven"/);
  assert.doesNotMatch(matrix, /acct-0001|acct-0002|acct-0003|acct-0004|acct-0005/);
  assert.doesNotMatch(matrix, /account_key/);
  assert.match(elements.get('cards').innerHTML, /Account 1/);
  assert.match(elements.get('ev').innerHTML, /<th scope="col">Source<\/th>/);
  assert.match(elements.get('ev').innerHTML, /Stale/);
  assert.match(elements.get('ev').innerHTML, /Confirmed/);
  assert.match(elements.get('ev').innerHTML, /2026-11-03T00:35:00\+08:00/);
  assert.match(elements.get('entry-body').innerHTML, /No mismatch evidence/);
  assert.doesNotMatch(elements.get('entry-body').innerHTML, /\b25\b/);
  const total = Number(elements.get('n-ok').textContent) + Number(elements.get('n-bad').textContent)
    + Number(elements.get('n-open').textContent) + Number(elements.get('n-np').textContent);
  assert.equal(total, fixture.accounts.length * ledger.DIMS.length);
  assert.equal(elements.get('tally').hidden, false);
}

// Toggle wiring is exercised through the registered click handler.
{
  const { document, buttons } = makeDocument();
  const win = makeWindow();
  const handlers = new Map();
  for (const button of [...buttons.language, ...buttons.theme]) {
    button.addEventListener = (_type, handler) => handlers.set(button, handler);
  }
  await ledger.main({
    document, window: win, search: '?sample=1&lang=en&theme=light', now,
    fetchImpl: async () => { throw new Error('sample mode must not fetch'); },
  });
  handlers.get(buttons.language.find(button => button.dataset.v === 'zh-CN'))();
  assert.equal(document.documentElement.lang, 'zh-CN');
  assert.equal(win.stored.get('ol-lang'), 'zh-CN');
  handlers.get(buttons.theme.find(button => button.dataset.v === 'dark'))();
  assert.equal(document.documentElement.dataset.theme, 'dark');
  assert.equal(win.stored.get('ol-theme'), 'dark');
}

// Default locale/theme come from the browser when no override is supplied.
{
  const { document } = makeDocument();
  const win = makeWindow();
  win.navigator.language = 'zh-CN';
  win.matchMedia = () => ({ matches: true });
  await ledger.main({
    document, window: win, search: '', now,
    fetchImpl: async () => ({ ok: true, json: async () => fixture }),
  });
  assert.equal(document.documentElement.lang, 'zh-CN');
  assert.equal(document.documentElement.dataset.theme, 'dark');
}

// Relative source override loads a fixture without fetching an absolute URL.
{
  const { document, elements } = makeDocument();
  const win = makeWindow();
  let requested = null;
  const result = await ledger.main({
    document, window: win, search: '?source=tests/fixtures/forward_reconciliation/sample-account-facts.json', now,
    fetchImpl: async url => { requested = url; return { ok: true, json: async () => fixture }; },
  });
  assert.equal(result.error, false);
  assert.equal(requested, 'tests/fixtures/forward_reconciliation/sample-account-facts.json');
  assert.match(elements.get('mx').innerHTML, /<th scope="col">Platform<\/th>/);
}

// Absolute source URLs are rejected before any fetch.
{
  const { document, elements } = makeDocument();
  const win = makeWindow();
  let fetched = false;
  const result = await ledger.main({
    document, window: win, search: '?source=https%3A%2F%2Fexample.invalid%2Ffacts.json', now,
    fetchImpl: async () => { fetched = true; return { ok: true, json: async () => fixture }; },
  });
  assert.equal(result.error, true);
  assert.equal(result.errorCode, 'source_rejected');
  assert.equal(fetched, false);
  assert.equal(elements.get('error-banner').hidden, false);
}

// Unknown platform metadata must not expose an arbitrary account label.
{
  const { document, elements } = makeDocument();
  const payload = structuredClone(fixture);
  payload.accounts[0].platform = 'acct-9999';
  await ledger.main({
    document, window: makeWindow(), search: '', now,
    fetchImpl: async () => ({ ok: true, json: async () => payload }),
  });
  for (const id of ['mx', 'cards', 'ev']) {
    assert.doesNotMatch(elements.get(id).innerHTML, /acct-9999/i,
      'unknown platform labels must remain neutral');
  }
}

// WHATWG URL normalization must not turn a relative override into an external URL.
for (const source of ['\\example.invalid/facts.json', '/\\example.invalid/facts.json',
  '\thttps://example.invalid/facts.json', 'ht\ntps://example.invalid/facts.json']) {
  const { document } = makeDocument();
  let fetched = false;
  const result = await ledger.main({
    document, window: makeWindow(), search: `?source=${encodeURIComponent(source)}`, now,
    fetchImpl: async () => { fetched = true; return { ok: true, json: async () => fixture }; },
  });
  assert.equal(fetched, false, 'ambiguous or external source must be rejected before fetch');
  assert.equal(result.error, true);
  assert.equal(result.errorCode, 'source_rejected');
}

// API error shows a page-level banner and clears the previous tally/table.
{
  const { document, elements } = makeDocument();
  const win = makeWindow();
  await ledger.main({
    document, window: win, search: '?sample=1', now,
    fetchImpl: async () => { throw new Error('sample mode must not fetch'); },
  });
  assert.equal(elements.get('tally').hidden, false);
  assert.notEqual(elements.get('mx').innerHTML, '');
  const result = await ledger.main({
    document, window: win, search: '', now,
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
  });
  assert.equal(result.error, true);
  assert.equal(elements.get('error-banner').hidden, false);
  assert.equal(elements.get('tally').hidden, true);
  assert.equal(elements.get('n-ok').textContent, '—');
  assert.equal(elements.get('n-bad').textContent, '—');
  assert.equal(elements.get('n-open').textContent, '—');
  assert.equal(elements.get('n-np').textContent, '—');
  assert.equal(elements.get('mx').innerHTML, '');
  assert.equal(elements.get('cards').innerHTML, '');
  assert.equal(elements.get('ev').innerHTML, '');
  assert.equal(elements.get('entry-body').innerHTML, '');
}

// Invalid payload shapes also fail closed.
for (const payload of [null, {}, { ok: false, accounts: [] }, { ok: true, accounts: 'nope' }]) {
  const { document, elements } = makeDocument();
  const win = makeWindow();
  const result = await ledger.main({
    document, window: win, search: '', now,
    fetchImpl: async () => ({ ok: true, json: async () => payload }),
  });
  assert.equal(result.error, true);
  assert.equal(elements.get('error-banner').hidden, false);
  assert.equal(elements.get('mx').innerHTML, '');
}

// Imported metadata must satisfy the same nested read contract before rendering.
const invalidEvidence = [
  f => { f.source_status = 'present'; },
  f => { f.source_status = 'stale'; },
  f => { f.baseline_status = 'present'; f.baseline_reason = null; },
  f => { f.baseline_reason = null; },
  f => { f.notification.status = 'confirmed'; },
  f => { f.notification.status = 'pending'; },
  f => { f.notification.requested_at = '2026-11-03T00:00:00Z'; },
  f => { f.forward_start_date = 'invalid-date'; },
  f => { f.forward_start_date = '2026-11-04'; },
  f => { f.dimensions.cash = 'RECONCILED'; },
  f => { f.later_anchor = {}; },
  f => { f.generated_at = '2026-02-30T00:00:00Z'; },
  f => { f.source = structuredClone(fixture.accounts[2].forward_reconciliation.source); },
  f => { f.source_status = 'present'; f.source = { source_as_of: 'invalid' }; },
  f => { f.notification = { status: 'confirmed', requested_at: '2026-11-03T02:00:00Z',
    confirmed_at: '2026-11-03T01:00:00Z' }; },
];
for (const mutate of invalidEvidence) {
  const { document, elements } = makeDocument();
  await ledger.main({ document, window: makeWindow(), search: '?sample=1', now });
  const payload = structuredClone({ ok: true, accounts: [fixture.accounts[0]] });
  mutate(payload.accounts[0].forward_reconciliation);
  const result = await ledger.main({ document, window: makeWindow(), search: '', now,
    fetchImpl: async () => ({ ok: true, json: async () => payload }) });
  assert.equal(result.error, true, 'inconsistent evidence must fail closed');
  assert.equal(result.rows, null);
  assert.equal(elements.get('error-banner').hidden, false);
  assert.equal(elements.get('tally').hidden, true);
  for (const id of ['mx', 'cards', 'ev', 'entry-body', 'days', 'note-source', 'note-baseline', 'note-notice']) {
    assert.equal(elements.get(id).innerHTML, '', 'invalid input clears previous metadata');
  }
}

// Even an unexpected rendering exception must clear already populated tables.
{
  const { document, elements } = makeDocument();
  const days = document.getElementById('days');
  Object.defineProperty(days, 'innerHTML', {
    get: () => '', set(value) { if (value) throw new Error('synthetic acct-9999 render failure'); },
  });
  const result = await ledger.main({ document, window: makeWindow(), search: '?sample=1', now });
  assert.equal(result.error, true);
  assert.equal(result.rows, null);
  assert.equal(elements.get('error-banner').hidden, false);
  assert.equal(elements.get('tally').hidden, true);
  for (const id of ['mx', 'cards', 'ev', 'entry-body']) assert.equal(elements.get(id).innerHTML, '');
  assert.doesNotMatch(elements.get('error-detail').textContent, /acct-9999|synthetic render failure/);
}

// At mobile widths the replacement cards retain localized dimension/status groups.
for (const lang of ['zh-CN', 'en']) {
  const { document, elements } = makeDocument();
  await ledger.main({ document, window: makeWindow(), search: `?sample=1&lang=${lang}`, now });
  const cards = elements.get('cards').innerHTML;
  for (const key of ['col_opening', 'col_positions', 'col_cash', 'col_fills', 'col_events', 'col_fees']) {
    const label = ledger.LOCALES[lang][key];
    assert.ok(cards.includes(`role="group" aria-label="${label}"`));
    assert.ok(cards.includes(`>${label}</span>`));
  }
}

console.log('observation_ledger_validation: PASS (honest states, tally identity, error banner, i18n parity, read-only)');
