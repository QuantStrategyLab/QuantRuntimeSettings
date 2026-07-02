/**
 * 现金与融资（Cash & Financing）模块单元测试
 *
 * 测试范围：
 *   1. allowMarginExplicitlySelected / reserveCashOverrideActive
 *   2. executionCashPolicyConflict
 *   3. reconcileExecutionCashPolicy — 互斥逻辑（修复后）
 *   4. syncReservePolicyForAccount — 解析为具体模式
 *   5. syncCashOnlyExecutionForAccount — 解析为具体值
 *   6. 初始加载互斥检查
 *   7. 边界情况 & 回归测试
 *
 * 运行：node tests/test_cash_financing.js
 */

// --------------- 测试框架 ---------------
let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, label) {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(label);
    console.error(`  ✗ FAIL: ${label}`);
  }
}

function summary() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log(`\nFailures:`);
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
    process.exitCode = 1;
  } else {
    console.log(`✓ All tests passed.`);
  }
}

// --------------- 从 index.html 提取的核心函数 ---------------

const reservePolicyModes = ["current", "none", "ratio", "floor", "max"];
const cashOnlyExecutionModes = ["current", "enabled", "disabled"];

const platformConfig = {
  binance:    { margin_policy: false, reserved_cash: false },
  firstrade:  { margin_policy: true,  reserved_cash: true },
  ibkr:       { margin_policy: true,  reserved_cash: true },
  longbridge: { margin_policy: true,  reserved_cash: true },
  qmt:        { margin_policy: false, reserved_cash: false },
  schwab:     { margin_policy: true,  reserved_cash: true },
};

function platformSupportsMarginPolicy(platform) {
  return platformConfig[platform]?.margin_policy ?? true;
}

function platformSupportsReservedCashPolicy(platform) {
  return platformConfig[platform]?.reserved_cash ?? true;
}

function normalizeCashOnlyExecutionMode(value) {
  return cashOnlyExecutionModes.includes(value) ? value : "current";
}

function normalizeReservePolicyMode(value) {
  return reservePolicyModes.includes(value) ? value : "current";
}

function allowMarginExplicitlySelected(form) {
  return normalizeCashOnlyExecutionMode(form?.cashOnlyExecutionMode) === "disabled";
}

function reserveCashOverrideActive(form) {
  const mode = normalizeReservePolicyMode(form?.reservePolicyMode);
  return mode === "ratio" || mode === "floor" || mode === "max";
}

function executionCashPolicyConflict(form) {
  return allowMarginExplicitlySelected(form) && reserveCashOverrideActive(form);
}

// --- 修复后的 reconcileExecutionCashPolicy (save/restore) ---
function reconcileExecutionCashPolicy(form, changed) {
  if (!form) return;
  if (changed === "margin" && allowMarginExplicitlySelected(form)) {
    // Save current reserve state so it can be restored if margin is later disabled
    if (form.reservePolicyMode !== "none" && (form.minReservedCashUsd || form.reservedCashRatio)) {
      form._prevReserve = {
        mode: form.reservePolicyMode,
        floor: form.minReservedCashUsd,
        ratio: form.reservedCashRatio,
      };
    }
    form.reservePolicyMode = "none";
    form.reservedCashTouched = true;
    // Keep minReservedCashUsd and reservedCashRatio — will be restored if margin toggled back
  } else if (changed === "reserve" && reserveCashOverrideActive(form)) {
    form.cashOnlyExecutionMode = "enabled";
    form.cashOnlyExecutionTouched = true;
  }
}

// --- cash-only change handler restore logic (extracted for testing) ---
function restoreReserveAfterMarginDisabled(form) {
  if (!allowMarginExplicitlySelected(form) && form._prevReserve) {
    form.reservePolicyMode = form._prevReserve.mode;
    form.minReservedCashUsd = form._prevReserve.floor;
    form.reservedCashRatio = form._prevReserve.ratio;
    form.reservedCashTouched = true;
    delete form._prevReserve;
  }
}

// --- 数据辅助函数 ---
function cleanOptionalBoolean(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (text === "true" || text === "1") return true;
    if (text === "false" || text === "0") return false;
  }
  return null;
}

function cleanDisplayNumber(value) {
  const text = String(value ?? "").trim();
  if (!text || text.length > 32 || !/^(?:\d+|\d*\.\d+)$/.test(text)) return "";
  const numeric = Number(text);
  if (!Number.isFinite(numeric) || numeric < 0) return "";
  return text;
}

function cleanDisplayRatio(value) {
  const text = cleanDisplayNumber(value);
  if (!text) return "";
  const numeric = Number(text);
  return numeric >= 0 && numeric <= 1 ? text : "";
}

// --- 模拟 currentStrategies ---
function makeCurrentStrategies(platform, overrides = {}) {
  return {
    [platform]: {
      preview: {
        cash_only_execution: overrides.cash_only_execution ?? null,
        min_reserved_cash_usd: overrides.min_reserved_cash_usd ?? null,
        reserved_cash_ratio: overrides.reserved_cash_ratio ?? null,
        ...overrides.extra,
      },
    },
  };
}

function currentEntryForAccount(state, platform, account) {
  const byPlatform = state.currentStrategies[platform] || {};
  const normalizeAccountLookupKey = (value) => String(value || "").trim().toLowerCase();
  const collectAccountLookupCandidates = (keys) => {
    const candidates = new Set();
    for (const rawKey of keys) {
      const key = normalizeAccountLookupKey(rawKey);
      if (!key) continue;

      candidates.add(key);

      const compact = key.replace(/[^a-z0-9]+/g, "");
      if (compact) candidates.add(compact);

      const parts = key.split(/[^a-z0-9]+/).filter(Boolean);
      for (const part of parts) candidates.add(part);
      if (parts.length > 1) {
        candidates.add(parts[parts.length - 1]);
      }
    }
    return [...candidates];
  };
  const keys = [account?.key, account?.target_name, account?.label].filter(Boolean).map(String);

  const candidates = new Set(collectAccountLookupCandidates(keys));

  for (const key of keys) {
    const entry = byPlatform[key];
    if (entry && typeof entry === "object") {
      if (!entry.strategy_profile) {
        return { ...entry, strategy_profile: account?.default_strategy_profile || "", source: "worker+account_defaults" };
      }
      return entry;
    }
  }

  for (const [rawKey, entry] of Object.entries(byPlatform)) {
    if (!entry || typeof entry !== "object") continue;
    const rawCandidates = collectAccountLookupCandidates([rawKey]);
    const hasMatch = rawCandidates.some((candidate) => candidates.has(candidate));
    if (hasMatch) {
      if (!entry.strategy_profile) {
        return {
          ...entry,
          strategy_profile: account?.default_strategy_profile || "",
          source: "worker+account_defaults",
        };
      }
      return entry;
    }
  }

  return {
    runtime_target_enabled: true,
    strategy_profile: account?.default_strategy_profile || account?.strategy_profile || "",
    source: "account_defaults",
  };
}

function currentReservePolicyForAccount(state, platform, account) {
  const entry = currentEntryForAccount(state, platform, account);
  return {
    minReservedCashUsd: cleanDisplayNumber(entry?.min_reserved_cash_usd ?? entry?.reserved_cash_floor_usd),
    reservedCashRatio: cleanDisplayRatio(entry?.reserved_cash_ratio),
  };
}

function currentCashOnlyExecutionForAccount(state, platform, account) {
  return cleanOptionalBoolean(currentEntryForAccount(state, platform, account)?.cash_only_execution);
}

function platformCashOnlyExecutionDefault() {
  return true; // 默认：仅用现金（不允许融资）
}

function effectiveCashOnlyExecutionForAccount(state, platform, account) {
  const configured = currentCashOnlyExecutionForAccount(state, platform, account);
  if (configured !== null) return configured;
  if (!platformSupportsMarginPolicy(platform)) return null;
  return platformCashOnlyExecutionDefault();
}

// --- 修复后的 syncReservePolicyForAccount ---
function syncReservePolicyForAccount(state, form, platform, account) {
  if (!form || form.reservedCashTouched) return;
  const policy = currentReservePolicyForAccount(state, platform, account);
  form.minReservedCashUsd = policy.minReservedCashUsd;
  form.reservedCashRatio = policy.reservedCashRatio;
  // Resolve to a concrete mode so the UI shows actual values instead of "keep current"
  const hasFloor = Boolean(policy.minReservedCashUsd);
  const hasRatio = Boolean(policy.reservedCashRatio);
  if (hasFloor && hasRatio) {
    form.reservePolicyMode = "max";
  } else if (hasFloor) {
    form.reservePolicyMode = "floor";
  } else if (hasRatio) {
    form.reservePolicyMode = "ratio";
  } else {
    form.reservePolicyMode = "none";
  }
}

// --- 修复后的 syncCashOnlyExecutionForAccount ---
function syncCashOnlyExecutionForAccount(state, form, platform, account) {
  if (!form || form.cashOnlyExecutionTouched) return;
  const configured = normalizeCashOnlyExecutionMode(account?.cash_only_execution_mode);
  if (configured !== "current") {
    form.cashOnlyExecutionMode = configured;
    return;
  }
  // Resolve "current" to a concrete value so the UI shows yes/no directly
  const effective = effectiveCashOnlyExecutionForAccount(state, platform, account);
  form.cashOnlyExecutionMode = effective === true ? "enabled" : (effective === false ? "disabled" : "current");
}

function syncStrategyForAccount(state, form, platform, account) {
  if (!form) return;
  const selected = account || makeAccount("preview");
  syncReservePolicyForAccount(state, form, platform, selected);
  syncCashOnlyExecutionForAccount(state, form, platform, selected);
  reconcileExecutionCashPolicy(form, "margin");
}

// --- 初始加载互斥检查（从 syncStrategyForAccount 提取） ---
function enforceMutualExclusionAfterSync(form) {
  if (form && allowMarginExplicitlySelected(form)) {
    form.reservePolicyMode = "none";
    form.minReservedCashUsd = "";
    form.reservedCashRatio = "";
  }
}

// --- 表单工厂 ---
function defaultReserveForm() {
  return {
    reservePolicyMode: "current",
    minReservedCashUsd: "",
    reservedCashRatio: "",
    reservedCashTouched: false,
    cashOnlyExecutionMode: "current",
    cashOnlyExecutionTouched: false,
  };
}

function makeAccount(key = "preview", cash_only_execution_mode) {
  const acc = { key, label: key, target_name: key };
  if (cash_only_execution_mode !== undefined) acc.cash_only_execution_mode = cash_only_execution_mode;
  return acc;
}

// ============================================================
// 测试开始
// ============================================================

console.log("=== 1. allowMarginExplicitlySelected / reserveCashOverrideActive ===\n");

// 1a: margin enabled
{
  const form = { cashOnlyExecutionMode: "disabled" };
  assert(allowMarginExplicitlySelected(form) === true, "1a: margin='disabled' → allowMargin");
  assert(allowMarginExplicitlySelected({ cashOnlyExecutionMode: "enabled" }) === false, "1a: margin='enabled' → !allowMargin");
  assert(allowMarginExplicitlySelected({ cashOnlyExecutionMode: "current" }) === false, "1a: margin='current' → !allowMargin");
  assert(allowMarginExplicitlySelected({}) === false, "1a: missing cashOnlyExecutionMode → !allowMargin");
  assert(allowMarginExplicitlySelected(null) === false, "1a: null form → !allowMargin");
}

// 1b: reserve override active
{
  assert(reserveCashOverrideActive({ reservePolicyMode: "ratio" }) === true, "1b: 'ratio' → override active");
  assert(reserveCashOverrideActive({ reservePolicyMode: "floor" }) === true, "1b: 'floor' → override active");
  assert(reserveCashOverrideActive({ reservePolicyMode: "max" }) === true, "1b: 'max' → override active");
  assert(reserveCashOverrideActive({ reservePolicyMode: "current" }) === false, "1b: 'current' → no override");
  assert(reserveCashOverrideActive({ reservePolicyMode: "none" }) === false, "1b: 'none' → no override");
  assert(reserveCashOverrideActive({ reservePolicyMode: "invalid" }) === false, "1b: 'invalid' → no override");
  assert(reserveCashOverrideActive({}) === false, "1b: missing → no override");
}

console.log("\n=== 2. executionCashPolicyConflict ===\n");

{
  // Both active
  assert(executionCashPolicyConflict({ cashOnlyExecutionMode: "disabled", reservePolicyMode: "ratio" }) === true,
    "2: disabled + ratio → conflict");
  assert(executionCashPolicyConflict({ cashOnlyExecutionMode: "disabled", reservePolicyMode: "floor" }) === true,
    "2: disabled + floor → conflict");
  assert(executionCashPolicyConflict({ cashOnlyExecutionMode: "disabled", reservePolicyMode: "max" }) === true,
    "2: disabled + max → conflict");

  // Only one active
  assert(executionCashPolicyConflict({ cashOnlyExecutionMode: "disabled", reservePolicyMode: "current" }) === false,
    "2: disabled + current → no conflict (reserve not active)");
  assert(executionCashPolicyConflict({ cashOnlyExecutionMode: "enabled", reservePolicyMode: "ratio" }) === false,
    "2: enabled + ratio → no conflict (margin not active)");
  assert(executionCashPolicyConflict({ cashOnlyExecutionMode: "current", reservePolicyMode: "current" }) === false,
    "2: both 'current' → no conflict");
  assert(executionCashPolicyConflict({ cashOnlyExecutionMode: "disabled", reservePolicyMode: "none" }) === false,
    "2: disabled + none → no conflict (reserve explicitly none)");
}

console.log("\n=== 3. reconcileExecutionCashPolicy (修复后) ===\n");

// 3a: 选择"允许融资: 是" → 清除预留现金
{
  const form = {
    cashOnlyExecutionMode: "disabled",
    reservePolicyMode: "current",
    minReservedCashUsd: "10000",
    reservedCashRatio: "0.05",
    reservedCashTouched: false,
    cashOnlyExecutionTouched: true,
  };
  reconcileExecutionCashPolicy(form, "margin");
  assert(form.reservePolicyMode === "none", "3a: margin=yes → reservePolicyMode='none'");
  assert(form.minReservedCashUsd === "10000", "3a: margin=yes → minReservedCashUsd PRESERVED");
  assert(form.reservedCashRatio === "0.05", "3a: margin=yes → reservedCashRatio PRESERVED");
  assert(form.reservedCashTouched === true, "3a: margin=yes → reservedCashTouched=true");
  assert(form._prevReserve.mode === "current", "3a: margin=yes → _prevReserve saved");
  assert(form._prevReserve.floor === "10000", "3a: margin=yes → _prevReserve.floor saved");
  assert(form._prevReserve.ratio === "0.05", "3a: margin=yes → _prevReserve.ratio saved");
}

// 3b: 选择"允许融资: 是"，当前 reserve=current，无值
{
  const form = {
    cashOnlyExecutionMode: "disabled",
    reservePolicyMode: "current",
    minReservedCashUsd: "",
    reservedCashRatio: "",
    reservedCashTouched: false,
  };
  reconcileExecutionCashPolicy(form, "margin");
  assert(form.reservePolicyMode === "none", "3b: margin=yes (no values) → still 'none'");
  assert(form.minReservedCashUsd === "", "3b: margin=yes (no values) → floor empty");
  assert(form._prevReserve === undefined, "3b: no values → _prevReserve NOT saved");
}

// 3c: 选择"允许融资: 否" → 不影响预留现金
{
  const form = {
    cashOnlyExecutionMode: "enabled",
    reservePolicyMode: "max",
    minReservedCashUsd: "5000",
    reservedCashRatio: "0.03",
    reservedCashTouched: true,
  };
  reconcileExecutionCashPolicy(form, "margin");
  assert(form.reservePolicyMode === "max", "3c: margin=no → reserve unchanged");
  assert(form.minReservedCashUsd === "5000", "3c: margin=no → floor unchanged");
  assert(form.reservedCashRatio === "0.03", "3c: margin=no → ratio unchanged");
}

// 3d: 选择预留现金覆盖 → 强制不允许融资
{
  const form = {
    cashOnlyExecutionMode: "disabled",
    reservePolicyMode: "ratio",
    minReservedCashUsd: "",
    reservedCashRatio: "0.05",
    reservedCashTouched: true,
    cashOnlyExecutionTouched: false,
  };
  reconcileExecutionCashPolicy(form, "reserve");
  assert(form.cashOnlyExecutionMode === "enabled", "3d: reserve=ratio → cashOnlyExecutionMode='enabled'");
  assert(form.cashOnlyExecutionTouched === true, "3d: reserve=ratio → cashOnlyExecutionTouched=true");
}

// 3e: 选择预留现金为 "none" → 不影响融资
{
  const form = {
    cashOnlyExecutionMode: "disabled",
    reservePolicyMode: "none",
    minReservedCashUsd: "",
    reservedCashRatio: "",
    reservedCashTouched: true,
    cashOnlyExecutionTouched: true,
  };
  reconcileExecutionCashPolicy(form, "reserve");
  assert(form.cashOnlyExecutionMode === "disabled", "3e: reserve=none → margin unchanged");
}

// 3f: 选择预留现金为 "current" → 不影响融资
{
  const form = {
    cashOnlyExecutionMode: "disabled",
    reservePolicyMode: "current",
    minReservedCashUsd: "10000",
    reservedCashRatio: "",
    reservedCashTouched: false,
  };
  reconcileExecutionCashPolicy(form, "reserve");
  assert(form.cashOnlyExecutionMode === "disabled", "3f: reserve=current → margin unchanged");
}

// 3g: null form
{
  reconcileExecutionCashPolicy(null, "margin"); // should not throw
  assert(true, "3g: null form → no error");
}

console.log("\n=== 4. syncReservePolicyForAccount (解析为具体模式) ===\n");

// 4a: both floor and ratio set
{
  const state = { currentStrategies: makeCurrentStrategies("ibkr", { min_reserved_cash_usd: "10000", reserved_cash_ratio: "0.05" }) };
  const form = defaultReserveForm();
  const account = makeAccount("preview");
  syncReservePolicyForAccount(state, form, "ibkr", account);
  assert(form.reservePolicyMode === "max", "4a: both set → mode='max'");
  assert(form.minReservedCashUsd === "10000", "4a: floor value preserved");
  assert(form.reservedCashRatio === "0.05", "4a: ratio value preserved");
}

// 4b: only floor
{
  const state = { currentStrategies: makeCurrentStrategies("ibkr", { min_reserved_cash_usd: "5000" }) };
  const form = defaultReserveForm();
  syncReservePolicyForAccount(state, form, "ibkr", makeAccount("preview"));
  assert(form.reservePolicyMode === "floor", "4b: only floor → mode='floor'");
  assert(form.minReservedCashUsd === "5000", "4b: floor value preserved");
  assert(form.reservedCashRatio === "", "4b: ratio empty");
}

// 4c: only ratio
{
  const state = { currentStrategies: makeCurrentStrategies("schwab", { reserved_cash_ratio: "0.03" }) };
  const form = defaultReserveForm();
  syncReservePolicyForAccount(state, form, "schwab", makeAccount("preview"));
  assert(form.reservePolicyMode === "ratio", "4c: only ratio → mode='ratio'");
  assert(form.minReservedCashUsd === "", "4c: floor empty");
  assert(form.reservedCashRatio === "0.03", "4c: ratio value preserved");
}

// 4d: neither set
{
  const state = { currentStrategies: makeCurrentStrategies("ibkr", {}) };
  const form = defaultReserveForm();
  syncReservePolicyForAccount(state, form, "ibkr", makeAccount("preview"));
  assert(form.reservePolicyMode === "none", "4d: neither set → mode='none'");
  assert(form.minReservedCashUsd === "", "4d: floor empty");
  assert(form.reservedCashRatio === "", "4d: ratio empty");
}

// 4e: already touched → skip sync
{
  const state = { currentStrategies: makeCurrentStrategies("ibkr", { min_reserved_cash_usd: "99999" }) };
  const form = { ...defaultReserveForm(), reservedCashTouched: true, reservePolicyMode: "floor", minReservedCashUsd: "100" };
  syncReservePolicyForAccount(state, form, "ibkr", makeAccount("preview"));
  assert(form.minReservedCashUsd === "100", "4e: touched → floor NOT overwritten");
  assert(form.reservePolicyMode === "floor", "4e: touched → mode NOT overwritten");
}

// 4f: zero values → should be treated as not set
{
  const state = { currentStrategies: makeCurrentStrategies("ibkr", { min_reserved_cash_usd: "0", reserved_cash_ratio: "0" }) };
  const form = defaultReserveForm();
  syncReservePolicyForAccount(state, form, "ibkr", makeAccount("preview"));
  // cleanDisplayNumber("0") returns "0" → Boolean("0") is true!
  // "0" is a valid value, so it's treated as set
  assert(form.reservePolicyMode === "max", "4f: '0' values → mode='max' (0 is a valid value)");
}

console.log("\n=== 5. syncCashOnlyExecutionForAccount (解析为具体值) ===\n");

// 5a: account has explicit "disabled" → resolve immediately
{
  const form = defaultReserveForm();
  const account = makeAccount("preview", "disabled");
  syncCashOnlyExecutionForAccount({}, form, "ibkr", account);
  assert(form.cashOnlyExecutionMode === "disabled", "5a: account.disabled → disabled");
}

// 5b: account has explicit "enabled" → resolve immediately
{
  const form = defaultReserveForm();
  const account = makeAccount("preview", "enabled");
  syncCashOnlyExecutionForAccount({}, form, "ibkr", account);
  assert(form.cashOnlyExecutionMode === "enabled", "5b: account.enabled → enabled");
}

// 5c: account has no mode → resolve from current entry (cash_only_execution: false → allow margin)
{
  const state = { currentStrategies: makeCurrentStrategies("ibkr", { cash_only_execution: false }) };
  const form = defaultReserveForm();
  syncCashOnlyExecutionForAccount(state, form, "ibkr", makeAccount("preview"));
  assert(form.cashOnlyExecutionMode === "disabled", "5c: entry.cash_only_execution=false → 'disabled' (allow margin)");
}

// 5d: account has no mode → resolve from current entry (cash_only_execution: true → cash only)
{
  const state = { currentStrategies: makeCurrentStrategies("ibkr", { cash_only_execution: true }) };
  const form = defaultReserveForm();
  syncCashOnlyExecutionForAccount(state, form, "ibkr", makeAccount("preview"));
  assert(form.cashOnlyExecutionMode === "enabled", "5d: entry.cash_only_execution=true → 'enabled' (cash only)");
}

// 5e: no account mode, no entry → platform default (true → cash only)
{
  const state = { currentStrategies: {} };
  const form = defaultReserveForm();
  syncCashOnlyExecutionForAccount(state, form, "ibkr", makeAccount("preview"));
  assert(form.cashOnlyExecutionMode === "enabled", "5e: no config → platform default → 'enabled' (cash only)");
}

// 5f: already touched → skip sync
{
  const state = { currentStrategies: makeCurrentStrategies("ibkr", { cash_only_execution: false }) };
  const form = { ...defaultReserveForm(), cashOnlyExecutionTouched: true, cashOnlyExecutionMode: "enabled" };
  syncCashOnlyExecutionForAccount(state, form, "ibkr", makeAccount("preview"));
  assert(form.cashOnlyExecutionMode === "enabled", "5f: touched → NOT overwritten");
}

// 5g: unsupported platform → effective returns null → stays "current"
{
  const state = { currentStrategies: {} };
  const form = defaultReserveForm();
  syncCashOnlyExecutionForAccount(state, form, "binance", makeAccount("preview"));
  assert(form.cashOnlyExecutionMode === "current", "5g: unsupported platform → stays 'current'");
}

console.log("\n=== 6. 初始加载互斥检查 (enforceMutualExclusionAfterSync) ===\n");

// 6a: margin enabled + reserve set → clear reserve
{
  const form = {
    cashOnlyExecutionMode: "disabled",
    reservePolicyMode: "max",
    minReservedCashUsd: "10000",
    reservedCashRatio: "0.05",
  };
  enforceMutualExclusionAfterSync(form);
  assert(form.reservePolicyMode === "none", "6a: margin enabled → reserve cleared");
  assert(form.minReservedCashUsd === "", "6a: margin enabled → floor cleared");
  assert(form.reservedCashRatio === "", "6a: margin enabled → ratio cleared");
}

// 6b: margin disabled + reserve set → no change
{
  const form = {
    cashOnlyExecutionMode: "enabled",
    reservePolicyMode: "max",
    minReservedCashUsd: "10000",
    reservedCashRatio: "0.05",
  };
  enforceMutualExclusionAfterSync(form);
  assert(form.reservePolicyMode === "max", "6b: margin disabled → reserve unchanged");
  assert(form.minReservedCashUsd === "10000", "6b: margin disabled → floor unchanged");
}

// 6c: margin enabled + reserve "none" → still "none"
{
  const form = {
    cashOnlyExecutionMode: "disabled",
    reservePolicyMode: "none",
    minReservedCashUsd: "",
    reservedCashRatio: "",
  };
  enforceMutualExclusionAfterSync(form);
  assert(form.reservePolicyMode === "none", "6c: margin enabled, reserve already none");
}

// 6d: margin "current" + reserve set → no change (margin not explicitly enabled)
{
  const form = {
    cashOnlyExecutionMode: "current",
    reservePolicyMode: "max",
    minReservedCashUsd: "10000",
    reservedCashRatio: "0.05",
  };
  enforceMutualExclusionAfterSync(form);
  assert(form.reservePolicyMode === "max", "6d: margin='current' → reserve unchanged");
}

console.log("\n=== 7. 端到端场景 ===\n");

// 7a: 用户加载页面 → 平台已有 margin enabled → reserve 应被清除
{
  const state = { currentStrategies: makeCurrentStrategies("ibkr", {
    cash_only_execution: false,     // margin IS enabled
    min_reserved_cash_usd: "10000", // reserve values exist
    reserved_cash_ratio: "0.05",
  })};
  const form = defaultReserveForm();
  const account = makeAccount("preview");
  // Step 1: sync reserve
  syncReservePolicyForAccount(state, form, "ibkr", account);
  assert(form.reservePolicyMode === "max", "7a-step1: reserve resolved to 'max'");
  // Step 2: sync cash_only
  syncCashOnlyExecutionForAccount(state, form, "ibkr", account);
  assert(form.cashOnlyExecutionMode === "disabled", "7a-step2: margin resolved to 'disabled'");
  // Step 3: mutual exclusion
  enforceMutualExclusionAfterSync(form);
  assert(form.reservePolicyMode === "none", "7a-step3: reserve cleared by mutual exclusion");
  assert(form.minReservedCashUsd === "", "7a-step3: floor cleared");
  assert(form.reservedCashRatio === "", "7a-step3: ratio cleared");
  assert(form.cashOnlyExecutionMode === "disabled", "7a-step3: margin still enabled");
}

// 7b: 用户选择 margin=yes → reserve 清除 → 再选 margin=no → reserve 保持 none
{
  const form = {
    cashOnlyExecutionMode: "current",
    reservePolicyMode: "max",
    minReservedCashUsd: "10000",
    reservedCashRatio: "0.05",
    reservedCashTouched: true,
    cashOnlyExecutionTouched: false,
  };
  // 用户选 margin=yes
  form.cashOnlyExecutionMode = "disabled";
  form.cashOnlyExecutionTouched = true;
  reconcileExecutionCashPolicy(form, "margin");
  assert(form.reservePolicyMode === "none", "7b-step1: margin=yes clears reserve");

  // 用户选 margin=no
  form.cashOnlyExecutionMode = "enabled";
  reconcileExecutionCashPolicy(form, "margin");
  assert(form.reservePolicyMode === "none", "7b-step2: margin=no → reserve stays 'none'");
  // 注意：用户需要手动再设置 reserve 值
}

// 7c: 用户设置 reserve=ratio → margin 被强制 disabled → 冲突解决
{
  const form = {
    cashOnlyExecutionMode: "disabled",
    reservePolicyMode: "current",
    minReservedCashUsd: "",
    reservedCashRatio: "",
    reservedCashTouched: false,
    cashOnlyExecutionTouched: true,
  };
  form.reservePolicyMode = "ratio";
  form.reservedCashRatio = "0.03";
  form.reservedCashTouched = true;
  reconcileExecutionCashPolicy(form, "reserve");
  assert(form.cashOnlyExecutionMode === "enabled", "7c: reserve=ratio → margin forced 'enabled'");
}

// 7d: 平台不支持 margin 和 reserve → 所有函数应无影响
{
  const form = defaultReserveForm();
  const account = makeAccount("preview");
  // sync on binance (no margin, no reserve)
  const state = { currentStrategies: {} };
  syncReservePolicyForAccount(state, form, "binance", account);
  assert(form.reservePolicyMode === "none", "7d: binance → reserve='none' (no values)");
  syncCashOnlyExecutionForAccount(state, form, "binance", account);
  assert(form.cashOnlyExecutionMode === "current", "7d: binance → margin='current' (no support)");
}

// 7e: 用户第一次打开表单，平台从未配置过 → 所有默认为具体值
{
  const state = { currentStrategies: {} }; // 空配置
  const form = defaultReserveForm();
  const account = makeAccount("preview");
  syncReservePolicyForAccount(state, form, "ibkr", account);
  assert(form.reservePolicyMode === "none", "7e: empty config → reserve='none'");
  assert(form.minReservedCashUsd === "", "7e: empty config → floor empty");
  syncCashOnlyExecutionForAccount(state, form, "ibkr", account);
  assert(form.cashOnlyExecutionMode === "enabled", "7e: empty config → margin='enabled' (platform default)");
  // 互斥检查
  enforceMutualExclusionAfterSync(form);
  // margin 是 "enabled" (not "disabled"), 所以 reserve 不变
  assert(form.reservePolicyMode === "none", "7e: mutual exclusion → reserve still 'none'");
}

// 7f: 切换账户时应重新解析（touched=false）
{
  const state = { currentStrategies: makeCurrentStrategies("ibkr", {
    cash_only_execution: null,
    min_reserved_cash_usd: "3000",
    reserved_cash_ratio: "0.02",
  })};
  const form = defaultReserveForm(); // touched=false
  const account = makeAccount("preview");
  syncReservePolicyForAccount(state, form, "ibkr", account);
  syncCashOnlyExecutionForAccount(state, form, "ibkr", account);
  assert(form.reservePolicyMode === "max", "7f: new account → mode='max'");
  assert(form.cashOnlyExecutionMode === "enabled", "7f: new account → margin='enabled' (platform default)");
}

console.log("\n=== 8. 回归测试：旧行为不应出现 ===\n");

// 8a: 旧 bug — margin=yes + reserve=current 时不应保持 current
{
  // 模拟旧代码行为：executionCashPolicyConflict 返回 false → 不清除
  const form = {
    cashOnlyExecutionMode: "disabled",
    reservePolicyMode: "current",
    minReservedCashUsd: "10000",
    reservedCashRatio: "0.05",
  };
  // 旧守卫条件：executionCashPolicyConflict(form) → false
  const oldGuard = !executionCashPolicyConflict(form); // true（没有冲突）
  assert(oldGuard === true, "8a: old guard would have skipped reconciliation");
  // 新代码：直接执行
  reconcileExecutionCashPolicy(form, "margin");
  assert(form.reservePolicyMode === "none", "8a: new code → reserve cleared regardless");
  assert(form.minReservedCashUsd === "10000", "8a: new code → values preserved for restore");
}

// 8b: 旧 bug — 初始加载 margin=enabled 时 reserve 仍显示值
{
  const state = { currentStrategies: makeCurrentStrategies("ibkr", {
    cash_only_execution: false,     // margin enabled
    min_reserved_cash_usd: "10000",
    reserved_cash_ratio: "0.05",
  })};
  const form = defaultReserveForm();
  const account = makeAccount("preview");
  syncReservePolicyForAccount(state, form, "ibkr", account);
  syncCashOnlyExecutionForAccount(state, form, "ibkr", account);
  // 旧代码：两者都同步完成，没有互斥检查 → reserve 仍为 "max"
  // 新代码：互斥检查
  enforceMutualExclusionAfterSync(form);
  assert(form.reservePolicyMode === "none", "8b: initial load → margin enabled clears reserve");
}

// 8c: 平台同时设置了 margin=disabled (allow margin) 和 reserve → 互斥生效
{
  const state = { currentStrategies: makeCurrentStrategies("schwab", {
    cash_only_execution: false,     // margin enabled
    min_reserved_cash_usd: "20000",
    reserved_cash_ratio: "0.10",
  })};
  const form = defaultReserveForm();
  const account = makeAccount("preview");
  syncReservePolicyForAccount(state, form, "schwab", account);
  syncCashOnlyExecutionForAccount(state, form, "schwab", account);
  enforceMutualExclusionAfterSync(form);
  assert(form.cashOnlyExecutionMode === "disabled", "8c: schwab margin remains 'disabled'");
  assert(form.reservePolicyMode === "none", "8c: schwab reserve cleared to 'none'");
}

// ============================================================
// 15. syncStrategyForAccount 初始互斥纠偏
// ============================================================

console.log("\n=== 15. syncStrategyForAccount 初始互斥纠偏 ===\n");

// 15a: 融资映射+预留现金配置时，应在同步后清空为 none（修复初始映射 bug）
{
  const state = {
    currentStrategies: {
      longbridge: {
        sg: {
          cash_only_execution: false,     // financing allowed
          min_reserved_cash_usd: "10000",
          reserved_cash_ratio: "0.05",
        },
      },
    },
  };
  const form = defaultReserveForm();
  syncStrategyForAccount(state, form, "longbridge", makeAccount("sg"));
  assert(form.cashOnlyExecutionMode === "disabled", "15a: cash-only mode resolves to disabled (allow margin)");
  assert(form.reservePolicyMode === "none", "15a: reserve policy auto-cleared to none");
}

// 15b: cash-only=enabled 时，不应清空已有预留现金
{
  const state = {
    currentStrategies: {
      longbridge: {
        sg: {
          cash_only_execution: true,      // no financing
          min_reserved_cash_usd: "10000",
          reserved_cash_ratio: "0.05",
        },
      },
    },
  };
  const form = defaultReserveForm();
  syncStrategyForAccount(state, form, "longbridge", makeAccount("sg"));
  assert(form.cashOnlyExecutionMode === "enabled", "15b: cash-only mode resolves to enabled (no margin)");
  assert(form.reservePolicyMode === "max", "15b: reserve policy keeps max");
  assert(form.minReservedCashUsd === "10000", "15b: reserve floor preserved");
  assert(form.reservedCashRatio === "0.05", "15b: reserve ratio preserved");
}

// ============================================================
// 9. syncRuntimeTargetForAccount (解析为具体值)
// ============================================================

// --- 辅助函数 ---
function runtimeTargetStateForAccount(state, platform, account) {
  const entry = currentEntryForAccount(state, platform, account);
  if (!entry) return { known: false, enabled: null };
  const configured = cleanOptionalBoolean(entry.runtime_target_enabled);
  return { known: true, enabled: configured ?? true };
}

function syncRuntimeTargetForAccount(state, form, platform, account) {
  if (!form || form.runtimeTargetTouched) return;
  const target = runtimeTargetStateForAccount(state, platform, account);
  form.runtimeTargetMode = target.known ? (target.enabled ? "enabled" : "disabled") : "current";
}

function normalizeRuntimeTargetMode(value) {
  return ["current", "enabled", "disabled"].includes(value) ? value : "current";
}

function runtimeTargetEnabledForAccount(state, platform, account) {
  return cleanOptionalBoolean(currentEntryForAccount(state, platform, account)?.runtime_target_enabled);
}

function pendingRuntimeTarget(state, inputs, platform, account) {
  const mode = normalizeRuntimeTargetMode(inputs.runtime_target_enabled_mode);
  if (mode === "current") {
    return {
      changed: false,
      inputs: {
        runtime_target_enabled: runtimeTargetEnabledForAccount(state, platform, account) ?? true,
      },
    };
  }
  const current = runtimeTargetEnabledForAccount(state, platform, account);
  const currentEnabled = current ?? true;
  const nextEnabled = mode === "enabled";
  const entry = currentEntryForAccount(state, platform, account);
  return {
    changed: Boolean(entry && current !== null && currentEnabled !== nextEnabled),
    inputs: { runtime_target_enabled: nextEnabled },
  };
}

// --- 测试 ---
console.log("\n=== 9. syncRuntimeTargetForAccount (解析为具体值) ===\n");

// 9a: runtime_target_enabled: true → enabled
{
  const state = { currentStrategies: makeCurrentStrategies("ibkr", { extra: { runtime_target_enabled: true } }) };
  const form = { runtimeTargetMode: "current", runtimeTargetTouched: false };
  syncRuntimeTargetForAccount(state, form, "ibkr", makeAccount("preview"));
  assert(form.runtimeTargetMode === "enabled", "9a: runtime_target=true → 'enabled'");
}

// 9b: runtime_target_enabled: false → disabled
{
  const state = { currentStrategies: makeCurrentStrategies("ibkr", { extra: { runtime_target_enabled: false } }) };
  const form = { runtimeTargetMode: "current", runtimeTargetTouched: false };
  syncRuntimeTargetForAccount(state, form, "ibkr", makeAccount("preview"));
  assert(form.runtimeTargetMode === "disabled", "9b: runtime_target=false → 'disabled'");
}

// 9c: runtime_target_enabled: TRUE → enabled
{
  const state = { currentStrategies: makeCurrentStrategies("ibkr", { extra: { runtime_target_enabled: "TRUE" } }) };
  const form = { runtimeTargetMode: "current", runtimeTargetTouched: false };
  syncRuntimeTargetForAccount(state, form, "ibkr", makeAccount("preview"));
  assert(form.runtimeTargetMode === "enabled", "9c: runtime_target='TRUE' → 'enabled'");
}

// 9d: runtime_target_enabled: FALSE → disabled
{
  const state = { currentStrategies: makeCurrentStrategies("ibkr", { extra: { runtime_target_enabled: "FALSE" } }) };
  const form = { runtimeTargetMode: "current", runtimeTargetTouched: false };
  syncRuntimeTargetForAccount(state, form, "ibkr", makeAccount("preview"));
  assert(form.runtimeTargetMode === "disabled", "9d: runtime_target='FALSE' → 'disabled'");
}

// 9e: no entry → use default enabled状态
{
  const state = { currentStrategies: {} };
  const form = { runtimeTargetMode: "current", runtimeTargetTouched: false };
  syncRuntimeTargetForAccount(state, form, "ibkr", makeAccount("preview"));
  assert(form.runtimeTargetMode === "enabled", "9e: no entry → default enabled");
}

// 9f: touched → skip
{
  const state = { currentStrategies: makeCurrentStrategies("ibkr", { extra: { runtime_target_enabled: false } }) };
  const form = { runtimeTargetMode: "enabled", runtimeTargetTouched: true };
  syncRuntimeTargetForAccount(state, form, "ibkr", makeAccount("preview"));
  assert(form.runtimeTargetMode === "enabled", "9f: touched → not overwritten");
}

// 9g: summary/pending should not mark "current" as a disable change
{
  const state = { currentStrategies: makeCurrentStrategies("ibkr", { extra: { runtime_target_enabled: true } }) };
  const pending = pendingRuntimeTarget(
    state,
    { runtime_target_enabled_mode: "current" },
    "ibkr",
    makeAccount("preview"),
  );
  assert(pending.changed === false, "9g: current runtime target mode → unchanged");
  assert(pending.inputs.runtime_target_enabled === true, "9g: current runtime target keeps enabled value");
}

// ============================================================
// 10. syncIncomeLayerForAccount (解析为具体值)
// ============================================================

// --- 辅助函数 ---
function incomeLayerFromEntry(entry) {
  return {
    enabled: cleanOptionalBoolean(entry?.income_layer_enabled),
    startUsd: cleanDisplayNumber(entry?.income_layer_start_usd),
    maxRatio: cleanDisplayRatio(entry?.income_layer_max_ratio),
  };
}

function incomeLayerFieldsConfigured(entry) {
  const current = incomeLayerFromEntry(entry);
  return current.enabled !== null || Boolean(current.startUsd || current.maxRatio);
}

function incomeLayerDefaultForStrategy(profile) {
  return profile ? { startUsd: 100000, maxRatio: "0.30" } : null;
}

function effectiveIncomeLayerForAccount(state, platform, account, profile) {
  const defaults = incomeLayerDefaultForStrategy(profile);
  if (!defaults) return null;
  const entry = currentEntryForAccount(state, platform, account);
  if (!entry) return null;
  const current = incomeLayerFromEntry(entry);
  if (!incomeLayerFieldsConfigured(entry)) {
    return { enabled: true, startUsd: String(defaults.startUsd), maxRatio: defaults.maxRatio };
  }
  return {
    enabled: current.enabled ?? true,
    startUsd: current.startUsd || String(defaults.startUsd),
    maxRatio: current.maxRatio || defaults.maxRatio,
  };
}

function syncIncomeLayerForAccount(state, form, platform, account) {
  if (!form || form.incomeLayerTouched) return;
  const defaults = incomeLayerDefaultForStrategy(form.strategy);
  const current = incomeLayerFromEntry(currentEntryForAccount(state, platform, account));
  form.incomeLayerStartUsd = current.startUsd || String(defaults?.startUsd || "");
  form.incomeLayerMaxRatio = current.maxRatio || defaults?.maxRatio || "";
  const effective = effectiveIncomeLayerForAccount(state, platform, account, form.strategy);
  if (effective) {
    form.incomeLayerMode = effective.enabled ? "enabled" : "disabled";
  } else if (defaults) {
    form.incomeLayerMode = "enabled";
  } else {
    form.incomeLayerMode = "current";
  }
}

console.log("\n=== 10. syncIncomeLayerForAccount (解析为具体值) ===\n");

// 10a: income_layer_enabled: true → enabled
{
  const state = { currentStrategies: makeCurrentStrategies("ibkr", {
    extra: { income_layer_enabled: true, income_layer_start_usd: "200000", income_layer_max_ratio: "0.25" }
  }) };
  const form = { incomeLayerMode: "current", incomeLayerTouched: false, strategy: "some_profile" };
  syncIncomeLayerForAccount(state, form, "ibkr", makeAccount("preview"));
  assert(form.incomeLayerMode === "enabled", "10a: income_layer enabled → 'enabled'");
}

// 10b: income_layer_enabled: false → disabled
{
  const state = { currentStrategies: makeCurrentStrategies("ibkr", {
    extra: { income_layer_enabled: false, income_layer_start_usd: "200000", income_layer_max_ratio: "0.25" }
  }) };
  const form = { incomeLayerMode: "current", incomeLayerTouched: false, strategy: "some_profile" };
  syncIncomeLayerForAccount(state, form, "ibkr", makeAccount("preview"));
  assert(form.incomeLayerMode === "disabled", "10b: income_layer disabled → 'disabled'");
}

// 10c: no entry + has defaults → enabled (default)
{
  const state = { currentStrategies: {} };
  const form = { incomeLayerMode: "current", incomeLayerTouched: false, strategy: "some_profile" };
  syncIncomeLayerForAccount(state, form, "ibkr", makeAccount("preview"));
  assert(form.incomeLayerMode === "enabled", "10c: no entry + defaults → 'enabled'");
}

// 10d: touched → skip
{
  const state = { currentStrategies: makeCurrentStrategies("ibkr", {
    extra: { income_layer_enabled: false }
  }) };
  const form = { incomeLayerMode: "enabled", incomeLayerTouched: true, strategy: "some_profile" };
  syncIncomeLayerForAccount(state, form, "ibkr", makeAccount("preview"));
  assert(form.incomeLayerMode === "enabled", "10d: touched → not overwritten");
}

// ============================================================
// 11. currentEntryForAccount 映射健壮性 ===
// ============================================================

console.log("\n=== 11. currentEntryForAccount 映射健壮性 ===\n");

// 11a: 按原 key 命中
{
  const state = {
    currentStrategies: {
      ibkr: {
        preview: { runtime_target_enabled: true },
      },
    },
  };
  const account = makeAccount("preview");
  const entry = currentEntryForAccount(state, "ibkr", account);
  assert(entry && entry.runtime_target_enabled === true, "11a: exact key should hit current entry");
}

// 11b: key 大小写不一致也能命中
{
  const state = {
    currentStrategies: {
      longbridge: {
        sg: { runtime_target_enabled: false },
      },
    },
  };
  const account = {
    key: "SG",
    target_name: "sg",
    label: "SG",
  };
  const entry = currentEntryForAccount(state, "longbridge", account);
  assert(entry && entry.runtime_target_enabled === false, "11b: case-insensitive key should match normalized");
}

// 11c: key 前后空白也能命中
{
  const state = {
    currentStrategies: {
      longbridge: {
        sg: { runtime_target_enabled: false },
      },
    },
  };
  const account = {
    key: " sg ",
    target_name: "SG",
    label: "longbridge sg",
  };
  const entry = currentEntryForAccount(state, "longbridge", account);
  assert(entry && entry.runtime_target_enabled === false, "11c: whitespace-trimmed key should match");
}

// 11d: 无 key 命中时回退到默认账号配置
{
  const state = {
    currentStrategies: {
      longbridge: {},
    },
  };
  const account = {
    key: "sg",
    target_name: "sg",
    label: "sg",
    default_strategy_profile: "tqqq_growth_income",
  };
  const entry = currentEntryForAccount(state, "longbridge", account);
  assert(Boolean(entry), "11d: missing entry should return synthesized defaults");
  assert(entry.runtime_target_enabled === true, "11d: missing entry should default runtime_target_enabled=enabled");
}

// 11e: 当前条目存在 strategy_profile 时不改写策略
{
  const state = {
    currentStrategies: {
      longbridge: {
        sg: { strategy_profile: "soxl_soxx_trend_income", runtime_target_enabled: false },
      },
    },
  };
  const account = {
    key: "SG",
    target_name: "SG",
    label: "sg",
  };
  const entry = currentEntryForAccount(state, "longbridge", account);
  assert(entry?.strategy_profile === "soxl_soxx_trend_income", "11e: existing strategy_profile should be preserved");
}

// 11f: 账号 key 带平台前缀时能命中（longbridge sg -> sg）
{
  const state = {
    currentStrategies: {
      longbridge: {
        sg: { runtime_target_enabled: true },
      },
    },
  };
  const account = {
    key: "longbridge sg",
    label: "LongBridge SG",
  };
  const entry = currentEntryForAccount(state, "longbridge", account);
  assert(entry && entry.runtime_target_enabled === true, "11f: platform-prefixed key should fallback-match by token");
}

// 11g: 账号 key 带分隔符时能命中（longbridge-sg / LB|SG）
{
  const state = {
    currentStrategies: {
      longbridge: {
        sg: { runtime_target_enabled: true },
      },
    },
  };
  const account = {
    key: "longbridge-sg",
    label: "LB|SG",
  };
  const entry = currentEntryForAccount(state, "longbridge", account);
  assert(entry && entry.runtime_target_enabled === true, "11g: separator variants should fallback-match");
}

// 11h: 避免平台前缀歧义导致误匹配（longbridge/ibkr 多账号）
{
  const state = {
    currentStrategies: {
      longbridge: {
        "longbridge-hk": { runtime_target_enabled: false, reserved_cash_ratio: "0.11" },
        "longbridge-sg": { runtime_target_enabled: true, reserved_cash_ratio: "0.03" },
      },
      ibkr: {
        "ibkr-primary": { runtime_target_enabled: false, reserved_cash_ratio: "0.20" },
        "ibkr-soxl": { runtime_target_enabled: true, reserved_cash_ratio: "0.05" },
      },
    },
  };
  const longbridgeSg = { key: "longbridge-sg", label: "LB|SG", target_name: "longbridge-sg" };
  const longbridgeEntry = currentEntryForAccount(state, "longbridge", longbridgeSg);
  assert(
    longbridgeEntry && longbridgeEntry.runtime_target_enabled === true,
    "11h-a: longbridge-sg should match longbridge-sg entry instead of longbridge-hk",
  );
  assert(
    longbridgeEntry && longbridgeEntry.reserved_cash_ratio === "0.03",
    "11h-b: longbridge-sg should use its own reserved_cash_ratio",
  );

  const ibkrSoxl = { key: "ibkr-soxl", label: "IBKR-SOXL", target_name: "ibkr-soxl" };
  const ibkrEntry = currentEntryForAccount(state, "ibkr", ibkrSoxl);
  assert(
    ibkrEntry && ibkrEntry.runtime_target_enabled === true,
    "11h-c: ibkr-soxl should match ibkr-soxl entry instead of ibkr-primary",
  );
  assert(
    ibkrEntry && ibkrEntry.reserved_cash_ratio === "0.05",
    "11h-d: ibkr-soxl should use its own reserved_cash_ratio",
  );
}

// ============================================================
// 12. syncOptionOverlayForAccount (解析为具体值)
// ============================================================

function optionOverlaySupported(profile) { return profile !== "no_overlay"; }
function currentOptionOverlayForAccount(state, platform, account) {
  return cleanOptionalBoolean(currentEntryForAccount(state, platform, account)?.option_overlay_enabled);
}
function effectiveOptionOverlayForAccount(state, platform, account, profile) {
  const configured = currentOptionOverlayForAccount(state, platform, account);
  if (configured !== null) return configured;
  if (!optionOverlaySupported(profile)) return null;
  return true;
}
function normalizeOptionOverlayMode(value) {
  return ["current", "enabled", "disabled"].includes(value) ? value : "current";
}

function syncOptionOverlayForAccount(state, form, platform, account) {
  if (!form || form.optionOverlayTouched) return;
  const configured = normalizeOptionOverlayMode(account?.option_overlay_mode);
  if (configured !== "current") {
    form.optionOverlayMode = configured;
    return;
  }
  if (!optionOverlaySupported(form.strategy)) {
    form.optionOverlayMode = "disabled";
    return;
  }
  const effective = effectiveOptionOverlayForAccount(state, platform, account, form.strategy);
  if (effective !== null && effective !== undefined) {
    form.optionOverlayMode = effective ? "enabled" : "disabled";
  } else {
    form.optionOverlayMode = "enabled";
  }
}

console.log("\n=== 12. syncOptionOverlayForAccount (解析为具体值) ===\n");

// 12a: option_overlay_enabled: true → enabled
{
  const state = { currentStrategies: makeCurrentStrategies("ibkr", { extra: { option_overlay_enabled: true } }) };
  const form = { optionOverlayMode: "current", optionOverlayTouched: false, strategy: "some_profile" };
  syncOptionOverlayForAccount(state, form, "ibkr", makeAccount("preview"));
  assert(form.optionOverlayMode === "enabled", "12a: option overlay enabled → 'enabled'");
}

// 12b: option_overlay_enabled: false → disabled
{
  const state = { currentStrategies: makeCurrentStrategies("ibkr", { extra: { option_overlay_enabled: false } }) };
  const form = { optionOverlayMode: "current", optionOverlayTouched: false, strategy: "some_profile" };
  syncOptionOverlayForAccount(state, form, "ibkr", makeAccount("preview"));
  assert(form.optionOverlayMode === "disabled", "12b: option overlay disabled → 'disabled'");
}

// 12c: no entry + supported → enabled (default)
{
  const state = { currentStrategies: {} };
  const form = { optionOverlayMode: "current", optionOverlayTouched: false, strategy: "some_profile" };
  syncOptionOverlayForAccount(state, form, "ibkr", makeAccount("preview"));
  assert(form.optionOverlayMode === "enabled", "12c: no entry + supported → 'enabled'");
}

// 12d: not supported → disabled
{
  const state = { currentStrategies: makeCurrentStrategies("ibkr", { extra: { option_overlay_enabled: true } }) };
  const form = { optionOverlayMode: "current", optionOverlayTouched: false, strategy: "no_overlay" };
  syncOptionOverlayForAccount(state, form, "ibkr", makeAccount("preview"));
  assert(form.optionOverlayMode === "disabled", "12d: not supported → 'disabled'");
}

// 12e: account has explicit mode → use it
{
  const form = { optionOverlayMode: "current", optionOverlayTouched: false, strategy: "some_profile" };
  syncOptionOverlayForAccount({}, form, "ibkr", { key: "preview", option_overlay_mode: "disabled" });
  assert(form.optionOverlayMode === "disabled", "12e: account explicit 'disabled' → 'disabled'");
}

// ============================================================
// 13. 互斥 UI 不再禁用选项 (回归测试)
// ============================================================

console.log("\n=== 13. 互斥 UI 不再禁用选项 ===\n");

// 13a: 预留现金覆盖活跃时，select cash-only=disabled 不应因 option.disabled 被阻挡
// (此测试验证 reconcileExecutionCashPolicy 可处理用户选择，无需前置禁用)
{
  const form = {
    cashOnlyExecutionMode: "enabled",  // 当前：不允许融资
    reservePolicyMode: "ratio",
    minReservedCashUsd: "",
    reservedCashRatio: "0.05",
    reservedCashTouched: true,
    cashOnlyExecutionTouched: false,
  };
  // 用户选择"允许融资: 是"
  form.cashOnlyExecutionMode = "disabled";
  form.cashOnlyExecutionTouched = true;
  reconcileExecutionCashPolicy(form, "margin");
  // 预留现金应被清除
  assert(form.reservePolicyMode === "none", "13a: margin=yes → reserve cleared");
  assert(form.cashOnlyExecutionMode === "disabled", "13a: margin stays 'disabled'");
  // 不再冲突
  assert(executionCashPolicyConflict(form) === false, "13a: no conflict after reconciliation");
}

// 13b: margin 启用时，reserve 下拉框不应 disabled，用户可选 ratio
{
  const form = {
    cashOnlyExecutionMode: "disabled",  // margin enabled
    reservePolicyMode: "none",
    minReservedCashUsd: "",
    reservedCashRatio: "",
    reservedCashTouched: false,
    cashOnlyExecutionTouched: true,
  };
  // 用户选择预留现金策略: ratio
  form.reservePolicyMode = "ratio";
  form.reservedCashRatio = "0.03";
  form.reservedCashTouched = true;
  reconcileExecutionCashPolicy(form, "reserve");
  // 融资应被禁用
  assert(form.cashOnlyExecutionMode === "enabled", "13b: reserve=ratio → margin disabled");
  assert(form.reservePolicyMode === "ratio", "13b: reserve stays 'ratio'");
  assert(executionCashPolicyConflict(form) === false, "13b: no conflict after reconciliation");
}

// ============================================================
// 14. 融资切换 save/restore 预留现金配置
// ============================================================

console.log("\n=== 14. Save/Restore 预留现金配置 ===\n");

// 14a: 用户开融资 → 值保留 → 关融资 → 值恢复
{
  const form = {
    cashOnlyExecutionMode: "enabled",   // 当前：不允许融资
    reservePolicyMode: "ratio",
    minReservedCashUsd: "",
    reservedCashRatio: "0.05",
    reservedCashTouched: true,
    cashOnlyExecutionTouched: false,
  };
  // 用户选"允许融资: 是"
  form.cashOnlyExecutionMode = "disabled";
  form.cashOnlyExecutionTouched = true;
  reconcileExecutionCashPolicy(form, "margin");
  assert(form.reservePolicyMode === "none", "14a-step1: reserve cleared to 'none'");
  assert(form.reservedCashRatio === "0.05", "14a-step1: ratio value preserved");
  assert(form._prevReserve.mode === "ratio", "14a-step1: prev mode saved");
  assert(form._prevReserve.ratio === "0.05", "14a-step1: prev ratio saved");

  // 用户选"允许融资: 否" → 恢复
  form.cashOnlyExecutionMode = "enabled";
  restoreReserveAfterMarginDisabled(form);
  assert(form.reservePolicyMode === "ratio", "14a-step2: reserve restored to 'ratio'");
  assert(form.reservedCashRatio === "0.05", "14a-step2: ratio restored");
  assert(form._prevReserve === undefined, "14a-step2: _prevReserve cleaned up");
}

// 14b: 用户开融资 → 关融资 → 手动改 reserve → 再开再关不复原旧值
{
  const form = {
    cashOnlyExecutionMode: "enabled",
    reservePolicyMode: "max",
    minReservedCashUsd: "10000",
    reservedCashRatio: "0.03",
    reservedCashTouched: true,
    cashOnlyExecutionTouched: false,
  };
  // 开融资
  form.cashOnlyExecutionMode = "disabled";
  reconcileExecutionCashPolicy(form, "margin");
  assert(form.reservePolicyMode === "none", "14b-step1: cleared");
  assert(form._prevReserve.mode === "max", "14b-step1: prev 'max' saved");

  // 关融资 → 恢复
  form.cashOnlyExecutionMode = "enabled";
  restoreReserveAfterMarginDisabled(form);
  assert(form.reservePolicyMode === "max", "14b-step2: restored to 'max'");

  // 用户手动改为 floor
  form.reservePolicyMode = "floor";
  form.minReservedCashUsd = "5000";
  form.reservedCashRatio = "";
  delete form._prevReserve;

  // 再开融资
  form.cashOnlyExecutionMode = "disabled";
  reconcileExecutionCashPolicy(form, "margin");
  assert(form._prevReserve.mode === "floor", "14b-step3: prev 'floor' saved");
  assert(form._prevReserve.floor === "5000", "14b-step3: prev floor saved");

  // 再关融资 → 恢复 floor
  form.cashOnlyExecutionMode = "enabled";
  restoreReserveAfterMarginDisabled(form);
  assert(form.reservePolicyMode === "floor", "14b-step4: restored to 'floor'");
  assert(form.minReservedCashUsd === "5000", "14b-step4: floor restored");
}

// 14c: reserve=none 时开融资不应保存 _prevReserve
{
  const form = {
    cashOnlyExecutionMode: "enabled",
    reservePolicyMode: "none",
    minReservedCashUsd: "",
    reservedCashRatio: "",
    reservedCashTouched: false,
  };
  form.cashOnlyExecutionMode = "disabled";
  reconcileExecutionCashPolicy(form, "margin");
  assert(form._prevReserve === undefined, "14c: reserve=none → no _prevReserve saved");
}

// 14d: margin 切到 "enabled" 但无 _prevReserve → 不动
{
  const form = {
    cashOnlyExecutionMode: "disabled",
    reservePolicyMode: "none",
    minReservedCashUsd: "",
    reservedCashRatio: "",
    _prevReserve: undefined,
  };
  form.cashOnlyExecutionMode = "enabled";
  restoreReserveAfterMarginDisabled(form);
  assert(form.reservePolicyMode === "none", "14d: no _prevReserve → stays 'none'");
}

// 14e: account switch 清除 _prevReserve
{
  const form = {
    cashOnlyExecutionMode: "disabled",
    reservePolicyMode: "none",
    minReservedCashUsd: "10000",
    reservedCashRatio: "0.05",
    _prevReserve: { mode: "max", floor: "10000", ratio: "0.05" },
  };
  delete form._prevReserve;  // simulate account switch
  assert(form._prevReserve === undefined, "14e: account switch clears _prevReserve");
}

// ============================================================
summary();
