// QSL Desk formatters: exact decimal handling, unknown never printed as zero, server-clock offset.
// All values are synthetic.
import assert from "node:assert/strict";
import * as fmt from "../web/strategy-switch-console/frontend/src/desk/format.ts";
import * as copy from "../web/strategy-switch-console/frontend/src/i18n/pages/desk.ts";

const tFor = table => (key, params = {}) => table[key].replace(/\{(\w+)\}/g, (_, name) => String(params[name]));
const tEn = tFor(copy.en);
const tZh = tFor(copy.zh);

// Money: decimal strings, grouping, half-away-from-zero rounding, currency prefix.
assert.equal(fmt.formatMoney("412380.55", "USD"), "$412,381");
assert.equal(fmt.formatMoney("412380.55", "USD", { digits: 2 }), "$412,380.55");
assert.equal(fmt.formatMoney("0.005", "USD", { digits: 2 }), "$0.01");
assert.equal(fmt.formatMoney("-0.004", "USD", { digits: 2 }), "$0.00", "rounds to zero without a minus sign");
assert.equal(fmt.formatMoney("-4318.5", "USD"), "-$4,319");
assert.equal(fmt.formatMoney("7588.00", "USD", { signed: true }), "+$7,588");
assert.equal(fmt.formatMoney("0.00", "USD", { signed: true }), "$0");
assert.equal(fmt.formatMoney("1113000.00", "HKD"), "HK$1,113,000");
assert.equal(fmt.formatMoney("99999999999999999999.99", "USDT", { digits: 2 }), "USDT 99,999,999,999,999,999,999.99", "no float precision loss");
assert.equal(fmt.formatMoney("999.5", "CNY"), "¥1,000");

// Unknown or malformed input is null, never "0".
for (const bad of [null, undefined, "", "abc", "1e5", "1,000", 5, NaN, {}]) {
  assert.equal(fmt.formatMoney(bad, "USD"), null, `money ${String(bad)}`);
  assert.equal(fmt.formatRatio(bad), null, `ratio ${String(bad)}`);
  assert.equal(fmt.formatNumber(bad), null, `number ${String(bad)}`);
}
assert.equal(fmt.formatMoney("1", ""), null, "currency is required");
assert.equal(fmt.formatMoney("1", null), null);

// Ratios are moved by two places as text, with direction glyphs.
assert.deepEqual(fmt.formatRatio("0.0184"), { text: "1.84%", direction: "up", glyph: "▲" });
assert.deepEqual(fmt.formatRatio("-0.062"), { text: "-6.20%", direction: "down", glyph: "▼" });
assert.deepEqual(fmt.formatRatio("0"), { text: "0.00%", direction: "flat", glyph: "–" });
assert.deepEqual(fmt.formatRatio("-0.000"), { text: "0.00%", direction: "flat", glyph: "–" });
assert.deepEqual(fmt.formatRatio("-0.00001"), { text: "0.00%", direction: "flat", glyph: "–" }, "rounds to flat, no negative zero");
assert.equal(fmt.formatRatio("1.2345").text, "123.45%");
assert.equal(fmt.formatRatio("0.12345", 1).text, "12.3%");
assert.equal(fmt.formatRatio("-0.149", 1).text, "-14.9%");
assert.equal(fmt.formatSignedRatio("0.0094"), "+0.94%");
assert.equal(fmt.formatSignedRatio("-0.0094"), "-0.94%");
assert.equal(fmt.formatSignedRatio("0.0000"), "0.00%");
assert.equal(fmt.formatSignedRatio(null), null);
assert.equal(fmt.formatNumber("1189800.005"), "1,189,800.01");

// Ages use the language table; negative or non-number ages are rejected.
assert.equal(fmt.formatAge(22320, tEn), "6h 12m");
assert.equal(fmt.formatAge(22320, tZh), "6小时12分");
assert.equal(fmt.formatAge(183840, tEn), "2d 03h");
assert.equal(fmt.formatAge(360, tEn), "6m");
assert.equal(fmt.formatAge(45.9, tEn), "45s");
assert.equal(fmt.formatAge(0, tEn), "0s");
for (const bad of [-1, NaN, Infinity, "10", null, undefined]) assert.equal(fmt.formatAge(bad, tEn), null);

// UTC times accept only canonical Z instants.
assert.equal(fmt.formatUtcHm("2026-11-02T14:26:00Z"), "14:26");
assert.equal(fmt.formatUtcHms("2026-11-02T14:32:07Z"), "14:32:07");
assert.equal(fmt.formatUtcDate("2026-11-02T23:59:59Z"), "2026-11-02");
for (const bad of ["2026-11-02", "2026-11-02T14:26:00+08:00", "2026-13-40T14:26:00Z", "", null, 0]) {
  assert.equal(fmt.formatUtcHm(bad), null, String(bad));
}

// Header clock follows the server, not the browser.
const clientNow = Date.parse("2026-11-02T14:20:00Z");
const offset = fmt.clockOffsetMs("2026-11-02T14:32:07Z", clientNow);
assert.equal(offset, 12 * 60_000 + 7_000);
assert.equal(fmt.serverNowIso(offset, clientNow + 3_000), "2026-11-02T14:32:10Z");
assert.equal(fmt.serverNowIso(null, clientNow), "2026-11-02T14:20:00Z", "no offset falls back to the client clock");
assert.equal(fmt.clockOffsetMs("garbage", clientNow), null);
assert.equal(fmt.secondsBetween("2026-11-02T14:00:00Z", "2026-11-02T14:06:00Z"), 360);
assert.equal(fmt.secondsBetween("x", "2026-11-02T14:06:00Z"), null);

// zh-CN is primary: both languages carry exactly the same desk keys.
assert.deepEqual(Object.keys(copy.zh).sort(), Object.keys(copy.en).sort());

console.log("console_desk_format_validation: PASS");
