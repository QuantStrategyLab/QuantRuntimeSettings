import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js";

// Fictional fixtures only. This covers the three review findings that are
// structural rather than financial: tab-strip reveal geometry, the open scope
// panel's long-name wrapping, and localized degraded-source labels.
const root = new URL("../web/strategy-switch-console/frontend/", import.meta.url).pathname;
const directory = await mkdtemp(join(tmpdir(), "tabs-scope-sources-"));
try {
  const outfile = join(directory, "render.cjs");
  await build({ stdin: { resolveDir: root, contents: `
    import { createElement as h } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { I18nProvider, translate } from './src/i18n';
    import { Tabs, revealDelta } from './src/components/Tabs';
    import { sourceLabelKey } from './src/pages/decisions/sources';
    import { AccountDirectoryContext, ScopeContext } from './src/app/context';
    import { AppShell } from './src/app/AppShell';
    export { revealDelta, sourceLabelKey, translate };
    export const tabs = (language, items, active) => renderToStaticMarkup(h(I18nProvider, { language }, h(Tabs, { id: 'demo', items, active, onChange() {} })));
    export const shell = (language, synthetic) => renderToStaticMarkup(h(I18nProvider, { language },
      h(AccountDirectoryContext.Provider, { value: null },
        h(ScopeContext.Provider, { value: { scope: 'all', options: [], setScope: () => {}, status: 'ready', retry: () => {} } },
          h(AppShell, { page: 'overview', todoCount: null, synthetic, login: null, updatedAt: null, onLogout: () => {}, children: 'x' })))));
  ` }, bundle: true, platform: "node", format: "cjs", outfile, jsx: "automatic", loader: { ".css": "empty" }, define: { "import.meta.env": "{}" }, logLevel: "silent" });
  const ui = createRequire(import.meta.url)(outfile);

  // --- Tab strip reveal geometry -------------------------------------------
  // tabLeft is container-relative, which is the whole point: the old code used
  // offsetLeft, so a strip that starts away from x=0 compared a page-relative
  // number against scrollLeft and scrolled a visible tab out of view.
  assert.equal(ui.revealDelta(0, 80, 300), 0, "first tab at the left edge needs no scroll");
  assert.equal(ui.revealDelta(20, 80, 300), 0, "a fully visible middle tab needs no scroll");
  assert.equal(ui.revealDelta(220, 80, 300), 0, "a tab flush with the right edge needs no scroll");
  assert.equal(ui.revealDelta(260, 80, 300), 40, "last tab reveals exactly the overflow");
  assert.equal(ui.revealDelta(-30, 80, 300), -30, "a tab scrolled off the left reveals by its offset");
  assert.equal(ui.revealDelta(0, 400, 300), 0, "a tab wider than the strip aligns its left edge");
  assert.equal(ui.revealDelta(-12, 400, 300), -12, "an oversized tab still returns to its left edge");
  // A strip that begins at page x=200 presents its first tab as 0 here; the
  // helper never sees the page offset, so the result cannot drift with it.
  for (const pageOffset of [0, 120, 640]) {
    assert.equal(ui.revealDelta(0, 80, 300) + pageOffset - pageOffset, 0,
      `strip page offset ${pageOffset} does not change the reveal`);
  }

  // --- Tabs markup keeps keyboard navigation --------------------------------
  const items = [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }];
  for (const language of ["zh", "en"]) {
    const html = ui.tabs(language, items, "c");
    assert.match(html, /role="tablist"/);
    assert.equal((html.match(/role="tab"/g) ?? []).length, 3);
    assert.match(html, /aria-selected="true"[^>]*tabindex="0"|tabindex="0"[^>]*aria-selected="true"/,
      "the selected tab is the single tab stop");
    assert.equal((html.match(/tabindex="-1"/g) ?? []).length, 2, "other tabs stay reachable by arrow keys only");
    assert.match(html, /id="demo-tab-c"[^>]*aria-controls="demo-panel"/);
  }

  // --- Degraded source labels ----------------------------------------------
  // The four existing inbox sources reuse the category labels already shown in
  // the filter row; anything else falls back to an honest localized phrase.
  const expected = {
    owner: "category.owner_decision",
    promotion: "category.strategy_promotion",
    recovery: "category.reconciliation_recovery",
    credential: "category.credential_maintenance",
  };
  for (const [source, key] of Object.entries(expected)) {
    assert.equal(ui.sourceLabelKey(source), key, `${source} reuses its category label`);
  }
  for (const unknown of ["mystery", "", "OWNER", "promotions"]) {
    assert.equal(ui.sourceLabelKey(unknown), "decisions.unknown_source", `"${unknown}" falls back honestly`);
  }

  // Resolve through the production translate() so the check covers the real
  // dictionary lookup (core keys plus page fragments), not a re-parse of it.
  for (const key of [...Object.values(expected), "decisions.unknown_source"]) {
    const zhText = ui.translate("zh", key);
    const enText = ui.translate("en", key);
    assert.ok(zhText && zhText !== key, `${key} has Chinese copy`);
    assert.ok(enText && enText !== key, `${key} has English copy`);
    assert.notEqual(zhText, enText, `${key} is actually translated`);
    // A raw source code is diagnostic data, never the user-facing label.
    for (const code of Object.keys(expected)) {
      assert.notEqual(zhText, code, `${key} does not fall back to the raw source code`);
      assert.notEqual(enText, code, `${key} does not fall back to the raw source code`);
    }
  }
  assert.notEqual(ui.translate("zh", "decisions.unknown_source"), ui.translate("zh", "category.owner_decision"),
    "the fallback is distinct from the known labels");

  // --- Open scope panel wraps instead of overflowing -----------------------
  const css = await readFile(join(root, "src/app/app.css"), "utf8");
  const rule = selector => {
    const at = css.indexOf(`${selector} {`);
    assert.ok(at >= 0, `${selector} rule exists`);
    return css.slice(at, css.indexOf("}", at));
  };
  const label = rule(".scope-option-label");
  assert.match(label, /min-width:\s*0/, "the option label may shrink below its text width");
  assert.match(label, /overflow-wrap:\s*anywhere/, "a long unbroken account name wraps");
  assert.match(label, /white-space:\s*normal/, "the label is allowed to wrap at all");
  assert.match(rule(".scope-option .badge"), /flex:\s*none/, "the paper badge never shrinks away");
  assert.match(rule(".scope-option"), /min-width:\s*0/, "the option itself may shrink inside the panel");
  assert.match(rule(".scope-panel"), /overflow:\s*auto/, "the panel scrolls rather than overflowing");

  const switcher = await readFile(join(root, "src/components/ScopeSwitcher.tsx"), "utf8");
  assert.match(switcher, /className="scope-option-label"/, "the option uses the wrapping class");
  assert.doesNotMatch(switcher, /style=\{\{\s*flex:\s*1\s*\}\}/, "no inline flex:1 without a min-width rule");
  // Outside clicks close without stealing focus; Escape and selection return it.
  assert.match(switcher, /closeReason\.current !== "outside"/, "an outside click keeps focus on the clicked control");
  assert.match(switcher, /close\("escape"\)/);
  assert.match(switcher, /close\("select"\)/);

  // --- Calendar width is solved by layout, never by shortening numbers ------
  // The strict rule: every real percentage keeps formatPercent's two decimals.
  // The narrow-screen grid must therefore size columns to their content and
  // scroll inside its own box, with no letter-spacing squeeze.
  const perfCss = await readFile(join(root, "src/pages/performance/performance.css"), "utf8");
  assert.ok(perfCss.includes("minmax(auto, 1fr)"), "narrow-screen columns size to their content");
  assert.ok(!perfCss.includes("repeat(7, minmax(0, 1fr))"), "no zero-min column squeeze");
  const perfRule = selector => {
    const at = perfCss.indexOf(`${selector} {`);
    assert.ok(at >= 0, `${selector} rule exists in performance.css`);
    return perfCss.slice(at, perfCss.indexOf("}", at));
  };
  assert.match(perfRule(".calendar-scroll"), /overflow-x:\s*auto/, "the month grid scrolls inside its own box");
  const calendarValue = perfRule(".calendar-cell .cell-value");
  assert.match(calendarValue, /white-space:\s*nowrap/, "a percentage never wraps mid-number");
  assert.doesNotMatch(calendarValue, /letter-spacing/, "no negative letter-spacing squeeze");

  const heatmap = await readFile(join(root, "src/charts/CalendarHeatmap.tsx"), "utf8");
  assert.doesNotMatch(heatmap, /compactValueText/, "the compacting helper is gone");
  assert.doesNotMatch(heatmap, /Number\.isInteger\(percent \* 100\)/, "no rescaled-integer rounding of percentage points");
  assert.match(heatmap, /className="calendar-scroll"/, "the grid is wrapped in its scroll container");

  // --- Phone topbar: scope touch target and the synthetic badge -------------
  // A 360px topbar cannot hold an unshrinkable badge and a usable scope trigger
  // at once, so the badge steps onto its own row instead of the trigger
  // collapsing to a sliver. Only the CSS contract is checkable here; the
  // 360/390/430 pixel result still needs a browser.
  // Several blocks share the same breakpoint, so the one that matters is the
  // one that actually carries the selector under test.
  const mediaBlock = (source, query, mustContain) => {
    let from = 0;
    while (from < source.length) {
      const at = source.indexOf(`@media ${query} {`, from);
      if (at < 0) break;
      let depth = 0;
      let index = source.indexOf("{", at);
      const start = index;
      for (; index < source.length; index += 1) {
        if (source[index] === "{") depth += 1;
        else if (source[index] === "}") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      const block = source.slice(start, index + 1);
      if (block.includes(mustContain)) return block;
      from = index + 1;
    }
    assert.fail(`@media ${query} containing ${mustContain} exists`);
  };
  const ruleIn = (block, selector) => {
    const at = block.indexOf(`${selector} {`);
    assert.ok(at >= 0, `${selector} rule exists in the block`);
    return block.slice(at, block.indexOf("}", at));
  };
  const phone = mediaBlock(css, "(max-width: 768px)", ".topbar .scope-trigger");
  const phoneTrigger = ruleIn(phone, ".topbar .scope-trigger");
  assert.match(phoneTrigger, /min-height:\s*44px/, "the phone scope trigger is at least 44px tall");
  assert.match(phoneTrigger, /min-width:\s*44px/, "the phone scope trigger is at least 44px wide");
  assert.match(phoneTrigger, /\{\s*width:\s*100%/, "the trigger fills the width its row leaves it");
  assert.match(ruleIn(phone, ".topbar .scope-switcher"), /min-width:\s*44px/,
    "the switcher box cannot be squeezed below the touch target");
  // A later duplicate block must not undo it: the last rule wins in CSS.
  assert.doesNotMatch(css, /\.topbar \.scope-switcher\s*\{[^}]*min-width:\s*0[;\s}]/,
    "no later rule shrinks the switcher back to zero");
  // The truncation itself is unchanged: the label still ellipsizes.
  assert.match(rule(".scope-trigger-label"), /text-overflow:\s*ellipsis/,
    "a long account name is still shortened inside the trigger");

  const narrow = mediaBlock(css, "(max-width: 430px)", ".topbar-synthetic");
  assert.match(narrow, /\.topbar:has\(> \.scope-switcher\):has\(> \.topbar-synthetic\)[^{]*\{[^}]*flex-wrap:\s*wrap/,
    "the topbar only wraps when both the scope and the synthetic badge are present");
  assert.match(narrow, /> \.topbar-synthetic\s*\{[^}]*order:\s*10/,
    "the badge is moved after the controls, onto its own row");
  assert.match(narrow, /> \.topbar-synthetic\s*\{[^}]*flex:\s*1 1 100%/,
    "the badge row claims the full width instead of shrinking the trigger");
  // Hiding the badge is not an acceptable fix, and production has no badge.
  assert.doesNotMatch(css, /\.topbar-synthetic[^{}]*\{[^}]*display:\s*none/,
    "the synthetic badge is never hidden");
  assert.doesNotMatch(narrow, /\.topbar\s*\{[^}]*flex-wrap:\s*wrap/,
    "the wrap is gated on the badge, so a production topbar keeps one row");

  const shell = await readFile(join(root, "src/app/AppShell.tsx"), "utf8");
  assert.match(shell, /className="topbar-synthetic"/, "the badge carries its own layout class");
  assert.match(shell, /\{synthetic && \(/, "the badge is still conditional on the synthetic flag");
  assert.match(shell, /<span className="badge badge-accent">\{t\("common\.synthetic_badge"\)\}<\/span>/,
    "the badge itself keeps its normal size and copy");
  assert.match(shell, /\{page !== "health" && <ScopeSwitcher \/>\}/,
    "the health topbar still has no scope switcher");

  // Rendered markup, so the wrapper is proven rather than assumed: the badge is
  // present and visible with the synthetic flag, and absent without it.
  for (const language of ["zh", "en"]) {
    const badge = language === "zh" ? "合成演示" : "Synthetic demo";
    const withBadge = ui.shell(language, true);
    assert.match(withBadge, /class="topbar-synthetic"><span class="badge badge-accent">/,
      `${language}: the badge sits in its own layout wrapper`);
    assert.equal(withBadge.split(badge).length - 1, 1, `${language}: the badge copy stays visible exactly once`);
    assert.match(withBadge, /class="scope-switcher"/, `${language}: the scope switcher is still rendered next to it`);
    const withoutBadge = ui.shell(language, false);
    assert.ok(!withoutBadge.includes("topbar-synthetic"), `${language}: a production topbar has no badge wrapper`);
    assert.ok(!withoutBadge.includes(badge), `${language}: no badge copy without the synthetic flag`);
    assert.match(withoutBadge, /class="scope-switcher"/, `${language}: the production topbar still has its scope`);
  }

  console.log("console_tabs_scope_sources_ui_validation: PASS (container-relative tab reveal incl. first/last and offset strips, keyboard tab semantics, localized degraded-source labels with honest fallback, open scope option wraps without inline flex, calendar keeps two-decimal precision via internal grid scroll instead of compacting, phone topbar keeps a 44px scope trigger and moves the synthetic badge onto its own row only when both are present; synthetic only)");
} finally { await rm(directory, { recursive: true, force: true }); }
