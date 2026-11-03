// Desk (Meridian) formatters and zh-CN/en copy tables. Synthetic values only.
import assert from "node:assert/strict";
import {
  formatMoney, moneyParts, formatDecimal, formatRatio, limitUsedPercent, formatAge, formatAgo,
  formatUtcHm, formatUtcHms, formatUtcDayLabel, clockOffsetMs, serverNowIso, secondsBetween,
} from "../web/strategy-switch-console/frontend/src/desk/format.ts";
import { DESK_MESSAGES, deskTranslate, resolveDeskLanguage, readReasonKey } from "../web/strategy-switch-console/frontend/src/desk/i18n/index.ts";

// Money: exact decimal strings, grouped, no float drift, missing input is null (never "$0.00").
assert.equal(formatMoney("1189800", "USD"), "$1,189,800.00");
assert.equal(formatMoney("412380.555", "USD"), "$412,380.56", "half away from zero");
assert.equal(formatMoney("0.1", "USD", { digits: 2 }), "$0.10");
assert.equal(formatMoney("11120.00", "USD", { signed: true }), "+$11,120.00");
assert.equal(formatMoney("-1256.00", "USD", { signed: true }), "−$1,256.00");
assert.equal(formatMoney("-0.004", "USD", { signed: true }), "$0.00", "no negative zero");
assert.equal(formatMoney("1113000.00", "HKD", { digits: 0 }), "HK$1,113,000");
assert.equal(formatMoney("78070.12", "USDT"), "USDT 78,070.12");
assert.equal(formatMoney("9007199254740993.01", "USD"), "$9,007,199,254,740,993.01", "beyond float precision");
for (const bad of [null, undefined, 5, "", "1e5", "1,000", "abc", "-", "1."]) assert.equal(formatMoney(bad, "USD"), null, String(bad));
assert.equal(formatMoney("1", "usd"), null);
assert.equal(formatMoney("1", null), null);
assert.deepEqual(moneyParts("1189800.00", "USD"), { sign: "", symbol: "$", whole: "1,189,800", cents: ".00" });
assert.equal(moneyParts(null, "USD"), null);
assert.equal(formatDecimal("18200"), "18,200");
assert.equal(formatDecimal("007.5", 1), "7.5");

// Ratios: x100 by moving the point; direction has a glyph, not colour alone.
assert.deepEqual(formatRatio("0.0184"), { text: "+1.84%", direction: "up", glyph: "▲" });
assert.deepEqual(formatRatio("-0.0088"), { text: "−0.88%", direction: "down", glyph: "▼" });
assert.deepEqual(formatRatio("0"), { text: "0.00%", direction: "flat", glyph: "–" });
assert.deepEqual(formatRatio("-0.00004"), { text: "0.00%", direction: "flat", glyph: "–" }, "rounds to flat, no −0.00%");
assert.equal(formatRatio("0.964", 0, false).text, "96%");
assert.equal(formatRatio("1.5", 1).text, "+150.0%");
assert.equal(formatRatio("-0.049", 1).text, "−4.9%");
for (const bad of [null, 0.01, "", "1%", "NaN"]) assert.equal(formatRatio(bad), null, String(bad));

// Drawdown ring: share of the limit used, clamped.
assert.equal(limitUsedPercent("-0.062", "-0.15"), 41);
assert.equal(limitUsedPercent("-0.141", "-0.15"), 94);
assert.equal(limitUsedPercent("-0.3", "-0.15"), 100);
assert.equal(limitUsedPercent("0", "-0.15"), 0);
assert.equal(limitUsedPercent("-0.1", "0"), null, "no limit, no ring");
assert.equal(limitUsedPercent(null, "-0.15"), null);

// Ages in both languages; negative ages mean a bad clock and are rejected.
assert.equal(formatAge(45, "zh"), "45 秒");
assert.equal(formatAge(45, "en"), "45 s");
assert.equal(formatAge(367, "zh"), "6 分钟");
assert.equal(formatAge(367, "en"), "6 min");
assert.equal(formatAge(11040, "zh"), "3 小时 04 分");
assert.equal(formatAge(11040, "en"), "3 h 04 m");
assert.equal(formatAge(183780, "zh"), "2 天 03 小时");
assert.equal(formatAge(183780, "en"), "2 d 03 h");
assert.equal(formatAgo(367, "zh"), "6 分钟前");
assert.equal(formatAgo(367, "en"), "6 min ago");
for (const bad of [-1, Number.NaN, Infinity, null, "60"]) assert.equal(formatAge(bad, "en"), null, String(bad));
assert.equal(formatAgo(null, "zh"), null);

// UTC clock and dates; non-UTC or malformed instants are rejected.
assert.equal(formatUtcHm("2026-11-02T14:26:00Z"), "14:26");
assert.equal(formatUtcHms("2026-11-02T14:32:07Z"), "14:32:07");
assert.equal(formatUtcHm("2026-11-02T14:26:00+08:00"), null);
assert.equal(formatUtcHm("yesterday"), null);
assert.equal(formatUtcDayLabel("2026-11-02T14:32:07Z", "zh"), "11月2日 周一");
assert.equal(formatUtcDayLabel("2026-11-02T14:32:07Z", "en"), "Mon 2 Nov");
assert.equal(formatUtcDayLabel(null, "en"), null);
const client = Date.parse("2026-11-02T14:30:07Z");
assert.equal(clockOffsetMs("2026-11-02T14:32:07Z", client), 120000);
assert.equal(clockOffsetMs("bad", client), null);
assert.equal(serverNowIso(120000, client), "2026-11-02T14:32:07Z");
assert.equal(serverNowIso(null, client), "2026-11-02T14:30:07Z");
assert.equal(secondsBetween("2026-11-02T14:26:00Z", "2026-11-02T14:32:07Z"), 367);
assert.equal(secondsBetween("2026-11-02T14:26:00Z", null), null);

// Language: zh-CN first for the desk.
assert.equal(resolveDeskLanguage(null, []), "zh");
assert.equal(resolveDeskLanguage(null, ["fr-FR", "de"]), "zh");
assert.equal(resolveDeskLanguage(null, ["en-US"]), "en");
assert.equal(resolveDeskLanguage("en", ["zh-CN"]), "en");
assert.equal(resolveDeskLanguage("zh-CN", ["en-US"]), "zh");
assert.equal(readReasonKey("read_failed"), "read.reason.read_failed");
assert.equal(readReasonKey("brand_new_reason"), "read.reason.other", "new codes never show raw");
assert.equal(deskTranslate("zh", "config.drift", { count: 2 }), "偏离 · 2 项");
assert.equal(deskTranslate("en", "freshness.ready", { age: "6 min" }), "All feeds fresh · 6 min ago");

// Copy tables: same keys, same placeholders, en has no CJK, zh is actually Chinese.
const { zh, en } = DESK_MESSAGES;
assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
const LANGUAGE_NEUTRAL = new Set(["read.unknown_mark", "clock.utc", "shell.brand"]);
for (const key of Object.keys(zh)) {
  assert.deepEqual(placeholders(en[key]), placeholders(zh[key]), `placeholders ${key}`);
  assert.doesNotMatch(en[key], /[㐀-鿿]/, `en ${key}`);
  if (!LANGUAGE_NEUTRAL.has(key) && !/^(age|date)\./.test(key)) assert.match(zh[key], /[㐀-鿿]/, `zh ${key}`);
  for (const value of [zh[key], en[key]]) assert.doesNotMatch(value, /审计|核对|证据|门禁|\baudit\b|\bevidence\b|\bgates?\b/i, `wording ${key}`);
}
// "Unknown" copy must never read as stopped/zero.
for (const language of ["zh", "en"]) {
  assert.notEqual(DESK_MESSAGES[language]["runtime.unknown"], DESK_MESSAGES[language]["runtime.stopped"]);
  assert.doesNotMatch(DESK_MESSAGES[language]["read.unknown"], /0|停止|stopped/i);
}
console.log(`console_desk_format_validation: PASS (${Object.keys(zh).length} zh/en keys; synthetic only)`);
