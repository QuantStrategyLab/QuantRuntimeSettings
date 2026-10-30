import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// Synthetic payloads only. The producer marks its current day (2026-10-26) as
// snapshot_pending while the browser clock is still on the previous local day
// (2026-10-25 23:30), which is the timezone skew that used to paint pending
// cells as future and drop their title.
const frontend = fileURLToPath(new URL("../web/strategy-switch-console/frontend/", import.meta.url));
const require = createRequire(join(frontend, "package.json"));
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { buildSync } = require("esbuild");

const bundled = buildSync({
  stdin: {
    contents: 'export { CalendarHeatmap } from "./charts/CalendarHeatmap"; export { LanguageContext } from "./i18n"; export { PrefsContext } from "./app/context";',
    resolveDir: join(frontend, "src"),
    loader: "tsx",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  jsx: "automatic",
  external: ["react", "react-dom", "react/jsx-runtime"],
  write: false,
  logLevel: "silent",
}).outputFiles[0].text;
const component = { exports: {} };
new Function("require", "module", "exports", bundled)(require, component, component.exports);
const { CalendarHeatmap, LanguageContext, PrefsContext } = component.exports;

const RealDate = Date;
const browserNow = new RealDate(2026, 9, 25, 23, 30).getTime();
class BrowserClock extends RealDate {
  constructor(...args) { super(...(args.length ? args : [browserNow])); }
  static now() { return browserNow; }
}

const cell = (date, { returnPercent = null, amount = null, status = "ok", reason = null } = {}) => ({
  date, amount, return_percent: returnPercent, currency: "USD", status,
  value_kind: "asset_change", unavailable_reason: reason,
});

const render = (props, language = "zh", hideAmounts = false) => renderToStaticMarkup(
  React.createElement(LanguageContext.Provider, { value: language },
    React.createElement(PrefsContext.Provider, {
      value: {
        prefs: { theme: "light", language, upDown: "green-up", hideAmounts, defaultRange: "YTD" },
        resolvedTheme: "light",
        setPrefs() {},
      },
    }, React.createElement(CalendarHeatmap, props))),
);

const monthCell = (html, day) => {
  const marker = `<span class="cell-date num">${day}</span>`;
  const at = html.indexOf(marker);
  assert.ok(at >= 0, `calendar day ${day} renders`);
  const start = html.lastIndexOf('<div class="calendar-cell', at);
  const next = html.indexOf('<div class="calendar-cell', at);
  return html.slice(start, next === -1 ? html.length : next);
};

const yearCell = (html, month) => {
  const marker = `<span class="cell-date">${month}</span>`;
  const at = html.indexOf(marker);
  assert.ok(at >= 0, `calendar month ${month} renders`);
  const start = html.lastIndexOf('<button', at);
  const end = html.indexOf('</button>', at);
  assert.ok(start >= 0 && end > at, `calendar month ${month} is inside its button`);
  return html.slice(start, end + '</button>'.length);
};

const monthProps = {
  year: 2026,
  month: 10,
  cells: [
    cell("2026-10-20", { reason: "snapshot_missing", status: "partial" }),
    cell("2026-10-22", { returnPercent: 0, amount: 0 }),
    cell("2026-10-23", { amount: 123456789 }),
    cell("2026-10-26", { reason: "snapshot_pending", status: "partial" }),
    cell("2026-10-27", { reason: "future_date", status: "no_data" }),
    cell("2026-10-28", { status: "no_data" }),
  ],
  onNavigate() {},
};

globalThis.Date = BrowserClock;
try {
  const monthView = render(monthProps);

  // Pending wins over the lagging local clock and keeps its hover/assistive text.
  const pending = monthCell(monthView, 26);
  assert.match(pending, /class="calendar-cell cell-pending/, "pending gets its own state, not future");
  assert.doesNotMatch(pending, /cell-future/, "a lagging browser clock never makes pending future");
  assert.match(pending, /title="今日数据待更新"/, "pending keeps the existing Chinese reason");
  assert.match(pending, /tabindex="0"/, "pending is keyboard focusable");
  assert.match(pending, /class="sr-only">今日数据待更新/, "pending is announced to screen readers");
  assert.doesNotMatch(pending, /cell-value (?:up|down|flat)/, "pending invents no value or tone");

  // An explicit future day stays blank, neutral and titleless.
  const future = monthCell(monthView, 27);
  assert.match(future, /cell-future/);
  assert.doesNotMatch(future, /cell-pending/);
  assert.doesNotMatch(future, /title=/, "future stays blank without a reason title");
  assert.doesNotMatch(future, /%/, "future renders no percentage");
  assert.doesNotMatch(future, /cell-value (?:up|down|flat)/, "future keeps a neutral tone");

  // Older payloads without a reason still fall back to the local date comparison.
  const legacyFuture = monthCell(monthView, 28);
  assert.match(legacyFuture, /cell-future/);
  assert.doesNotMatch(legacyFuture, /title=/);

  // A genuinely missing past snapshot keeps its existing missing state and title.
  const missing = monthCell(monthView, 20);
  assert.match(missing, /cell-empty/);
  assert.doesNotMatch(missing, /cell-pending|cell-future/, "historical gaps are not relabeled pending");
  assert.match(missing, /title="缺少资产快照"/);
  assert.doesNotMatch(missing, /cell-value/);

  // A real 0% stays a value (and a flat tone), never a missing or pending cell.
  const zero = monthCell(monthView, 22);
  assert.match(zero, /cell-value flat">0\.00%/);
  assert.doesNotMatch(zero, /cell-pending|cell-future|cell-empty/);

  // Hidden amounts stay masked; the same cell shows the number when not hidden.
  assert.match(monthCell(monthView, 23), /123456789/);
  const hiddenView = render(monthProps, "zh", true);
  const hidden = monthCell(hiddenView, 23);
  assert.match(hidden, /•••/);
  assert.doesNotMatch(hidden, /123456789/, "hidden amounts never leak through the calendar");

  // English keeps the same behavior and translations.
  const english = render({
    year: 2026,
    month: 10,
    cells: [cell("2026-10-26", { reason: "snapshot_pending", status: "partial" })],
    onNavigate() {},
  }, "en");
  const englishPending = monthCell(english, 26);
  assert.match(englishPending, /cell-pending/);
  assert.doesNotMatch(englishPending, /cell-future/);
  assert.match(englishPending, /title="Today/);
  assert.match(englishPending, /data is pending update/);
  assert.match(englishPending, /class="sr-only">Today/);

  // Year view applies the same precedence: a pending month ahead of the local
  // month is not future, while future_date stays neutral and missing stays missing.
  const yearView = render({
    year: 2026,
    month: null,
    cells: [
      { ...cell(undefined, { returnPercent: 0, amount: 0 }), month: "2026-07" },
      { ...cell(undefined, { returnPercent: 1.23 }), month: "2026-05" },
      { ...cell(undefined, { reason: "snapshot_missing" }), month: "2026-08" },
      { ...cell(undefined, { reason: "snapshot_pending" }), month: "2026-11" },
      { ...cell(undefined, { reason: "future_date", status: "no_data" }), month: "2026-12" },
    ],
    onNavigate() {},
  });
  const yearPending = yearCell(yearView, "2026-11");
  assert.match(yearPending, /cell-pending/);
  assert.doesNotMatch(yearPending, /cell-future/);
  assert.match(yearPending, /title="今日数据待更新"/);
  assert.match(yearPending, /class="sr-only">今日数据待更新/);
  const yearFuture = yearCell(yearView, "2026-12");
  assert.match(yearFuture, /cell-future/);
  assert.doesNotMatch(yearFuture, /cell-pending/);
  assert.doesNotMatch(yearFuture, /title=/);
  const yearMissing = yearCell(yearView, "2026-08");
  assert.match(yearMissing, /title="缺少资产快照"/);
  assert.doesNotMatch(yearMissing, /cell-pending|cell-future/);
  assert.match(yearCell(yearView, "2026-07"), /cell-value flat">0\.00%/);
  // The year view shares the same formatter, so a fractional month keeps its
  // exact digits there too instead of collapsing to "+1%".
  assert.ok(yearCell(yearView, "2026-05").includes(">+1.23%</span>"));

  // Percentage precision. return_percent is already in percentage points and
  // formatPercent does not rescale it. The strict rule is that a narrow cell
  // never loses precision: every real percentage renders at the shared
  // two-decimal form, and width is solved by layout (the grid scrolls), not by
  // shortening the number. An earlier attempt rounded to a bare integer and
  // rendered 0.05 as "+0%", 1.23 as "+1%" and -0.25 as "-0%": a false zero with
  // the sign still attached. Every case is checked in both languages.
  const precisionView = language => render({
    year: 2026,
    month: 10,
    cells: [
      cell("2026-10-01", { returnPercent: 0.05 }),
      cell("2026-10-02", { returnPercent: -0.25 }),
      cell("2026-10-03", { returnPercent: 1.23 }),
      cell("2026-10-04", { returnPercent: 1.2 }),
      cell("2026-10-05", { returnPercent: 0 }),
      cell("2026-10-06", { returnPercent: -12.34 }),
      cell("2026-10-07", { returnPercent: null, amount: null, status: "no_data" }),
    ],
    onNavigate() {},
  }, language);
  // [day, exact value, tone]
  const precision = [
    [1, "+0.05%", "up"],
    [2, "-0.25%", "down"],
    [3, "+1.23%", "up"],
    [4, "+1.20%", "up"],
    [5, "0.00%", "flat"],
    [6, "-12.34%", "down"],
  ];
  for (const language of ["zh", "en"]) {
    const view = precisionView(language);
    for (const [day, exact, tone] of precision) {
      const html = monthCell(view, day);
      assert.ok(html.includes(`class="cell-value ${tone}"`), `${language} day ${day} keeps the ${tone} tone`);
      assert.ok(html.includes(`>${exact}</span>`), `${language} day ${day} shows the full ${exact}`);
      // Exactly one statement of the value: no shortened glyphs plus a hidden
      // duplicate for assistive tech.
      assert.equal(html.replace(/title="[^"]*"/g, "").split(exact).length - 1, 1,
        `${language} day ${day} states ${exact} exactly once`);
      assert.ok(!html.includes('aria-hidden="true"'), `${language} day ${day} hides no duplicate value`);
      assert.ok(!/<span class="sr-only">[+-]?[\d.,]+%/.test(html), `${language} day ${day} adds no duplicate percentage`);
      // No value may collapse into a rounded zero or a truncated integer.
      for (const wrong of ["+0%", "-0%", "+1%", "-1%", "+12%", "-12%", ">0%<"]) {
        assert.ok(!html.includes(`>${wrong}<`), `${language} day ${day} never renders ${wrong}`);
      }
    }
    const absent = monthCell(view, 7);
    assert.doesNotMatch(absent, /cell-value/, `${language} day 7 without a value invents no percentage`);
    assert.match(absent, /cell-empty/);
  }
  // Width is solved by layout, not by shortening numbers: the month grid lives
  // in its own scroll box so a 360px screen scrolls the grid, not the page.
  assert.match(monthView, /class="calendar-scroll"/, "the month grid has its own scroll container");
  assert.ok(monthView.indexOf('class="calendar-scroll"') < monthView.indexOf('class="calendar-month-grid"'),
    "the scroll container wraps the grid");
} finally {
  globalThis.Date = RealDate;
}
console.log("console_calendar_pending_ui_validation: PASS (producer snapshot_pending beats a lagging browser clock in month and year views, future_date stays blank/neutral, past snapshot_missing stays missing, real 0% keeps its value, hidden amounts stay masked, zh/en; synthetic only)");
