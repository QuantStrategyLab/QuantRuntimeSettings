import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../web/strategy-switch-console/package.json", import.meta.url));
const Ajv2020 = require("ajv/dist/2020").default;
const addFormats = require("ajv-formats");

const loadJson = (relPath) => JSON.parse(readFileSync(new URL(relPath, import.meta.url), "utf8"));

const deployableCapitalSchema = loadJson("../schemas/qsl-deployable-capital-sizing.v1.schema.json");
const pinnedCalendar = loadJson("./fixtures/sa1/csa22_pinned_vectors_2025.json");
const matrix = loadJson("./fixtures/sa2/sa2_q21_matrix.json");

const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false });
addFormats(ajv);
const validateSchema = ajv.compile(deployableCapitalSchema);

const PRIVATE_LOCATOR_RE = new RegExp(
  "(?:source_ref|kv_key|do_key|kv://|do://|/" + "Users/|/" + "home/|broker_account_hash|broker_account_id)",
);

// Verify pure leaf boundary (zero Worker/runtime_support/storage/network imports)
const stripJsComments = (src) => src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
const moduleSource = stripJsComments(
  readFileSync(new URL("../web/strategy-switch-console/application/sizing_unit/deployable_capital.js", import.meta.url), "utf8"),
);
assert.equal(/runtime_support|worker\.js|\bfetch\s*\(/.test(moduleSource), false);

const {
  DEPLOYABLE_CAPITAL_SCHEMA,
  evaluateDeployableCapitalSizing,
  evaluateWorkableBankrollBminTier,
} = await import("../web/strategy-switch-console/application/sizing_unit/deployable_capital.js");
const { evaluateSizingUnitNav } = await import(
  "../web/strategy-switch-console/application/sizing_unit/nav.js"
);
const { createPinnedCalendarProvider } = await import(
  "../web/strategy-switch-console/application/sizing_unit/freshness.js"
);
const { evaluateAuthoritativeOrdersAndFills } = await import(
  "../web/strategy-switch-console/application/orders_fills/helpers.js"
);

assert.equal(DEPLOYABLE_CAPITAL_SCHEMA, "qsl.deployable_capital_sizing.v1");

// 1. Negative raw avail clamped to 0 + zero-cash blocks buy but not reduction
{
  const spec = matrix.cases.negative_raw_avail_clamped;
  const res = evaluateDeployableCapitalSizing(spec.input);
  assert.ok(validateSchema(res), ajv.errorsText(validateSchema.errors));
  assert.equal(res.status, spec.expected.status);
  assert.equal(res.capital.c_inv_usd, spec.expected.c_inv_usd);
  assert.equal(res.capital.raw_deployable_cash_usd, spec.expected.raw_deployable_cash_usd);
  assert.equal(res.capital.c_avail_usd, spec.expected.c_avail_usd);
  assert.equal(res.orders.find((o) => o.symbol === "TQQQ").delta_q_buy, spec.expected.tqqq_delta_q_buy);
  assert.equal(res.orders.find((o) => o.symbol === "SOXL").delta_q_sell, spec.expected.soxl_delta_q_sell);
}

// 2. Portfolio-level concurrent buy budget allocation with collar + fees
{
  const spec = matrix.cases.portfolio_concurrent_buy_budget;
  const res = evaluateDeployableCapitalSizing(spec.input);
  assert.ok(validateSchema(res), ajv.errorsText(validateSchema.errors));
  assert.equal(res.status, spec.expected.status);
  assert.equal(res.capital.c_avail_usd, spec.expected.c_avail_usd);
  const tqqq = res.orders.find((o) => o.symbol === "TQQQ");
  const soxl = res.orders.find((o) => o.symbol === "SOXL");
  assert.equal(tqqq.delta_q_buy, spec.expected.tqqq_delta_q_buy);
  assert.equal(soxl.delta_q_buy, spec.expected.soxl_delta_q_buy);
  assert.equal(res.capital.total_buy_commit_usd, spec.expected.total_buy_commit_usd);
  assert.equal(res.capital.remaining_deployable_cash_usd, spec.expected.remaining_deployable_cash_usd);
  assert.equal(tqqq.rho_order.value, spec.expected.tqqq_rho_order_value);
  assert.equal(tqqq.rho_order.threshold, spec.expected.tqqq_rho_order_threshold);
}

// 3. 1 share + min fee > C_avail yields 0 shares
{
  const spec = matrix.cases.one_share_exceeds_budget;
  const res = evaluateDeployableCapitalSizing(spec.input);
  assert.ok(validateSchema(res), ajv.errorsText(validateSchema.errors));
  assert.equal(res.orders[0].delta_q_buy, spec.expected.delta_q_buy);
  assert.equal(res.orders[0].buy_blocked_reason, spec.expected.buy_blocked_reason);
  assert.equal(res.capital.total_buy_commit_usd, spec.expected.total_buy_commit_usd);
}

// 4. Rounding friction + explicit b_exec + rho_order diagnostic (threshold: null)
{
  const spec = matrix.cases.rounding_friction_and_b_exec;
  const res = evaluateDeployableCapitalSizing(spec.input);
  assert.ok(validateSchema(res), ajv.errorsText(validateSchema.errors));
  const ord = res.orders[0];
  assert.equal(ord.q_ideal, spec.expected.q_ideal);
  assert.equal(ord.delta_q_buy, spec.expected.delta_q_buy);
  assert.equal(ord.est_commission_usd, spec.expected.est_commission_usd);
  assert.equal(ord.est_b_exec_usd, spec.expected.est_b_exec_usd);
  assert.equal(ord.est_total_buy_commit_usd, spec.expected.est_total_buy_commit_usd);
  assert.equal(ord.rho_order.rounding_friction_usd, spec.expected.rounding_friction_usd);
  assert.equal(ord.rho_order.value, spec.expected.rho_order_value);
  assert.equal(ord.rho_order.threshold, spec.expected.rho_order_threshold);
}

// 5. ORDER-UNKNOWN per-symbol buy block
{
  const spec = matrix.cases.order_unknown_symbol_block;
  const res = evaluateDeployableCapitalSizing(spec.input);
  assert.ok(validateSchema(res), ajv.errorsText(validateSchema.errors));
  assert.equal(res.capital.c_avail_usd, spec.expected.c_avail_usd);
  const tqqq = res.orders.find((o) => o.symbol === "TQQQ");
  const soxl = res.orders.find((o) => o.symbol === "SOXL");
  assert.equal(tqqq.delta_q_buy, spec.expected.tqqq_delta_q_buy);
  assert.equal(tqqq.buy_blocked_reason, spec.expected.tqqq_buy_blocked_reason);
  assert.equal(soxl.delta_q_buy, spec.expected.soxl_delta_q_buy);
}

// 6. b_band suppression vs emergency_bypass
{
  const spec = matrix.cases.b_band_suppression_vs_emergency_bypass;
  const suppressed = evaluateDeployableCapitalSizing(spec.discretionary_suppressed.input);
  assert.ok(validateSchema(suppressed));
  assert.equal(suppressed.orders[0].band_suppressed, spec.discretionary_suppressed.expected.band_suppressed);
  assert.equal(suppressed.orders[0].delta_q_final, spec.discretionary_suppressed.expected.delta_q_final);
  assert.equal(suppressed.orders[0].action, spec.discretionary_suppressed.expected.action);

  const bypassed = evaluateDeployableCapitalSizing(spec.emergency_bypass_executes_sell.input);
  assert.ok(validateSchema(bypassed));
  assert.equal(bypassed.orders[0].band_suppressed, spec.emergency_bypass_executes_sell.expected.band_suppressed);
  assert.equal(bypassed.orders[0].emergency_bypass_applied, spec.emergency_bypass_executes_sell.expected.emergency_bypass_applied);
  assert.equal(bypassed.orders[0].delta_q_final, spec.emergency_bypass_executes_sell.expected.delta_q_final);
  assert.equal(bypassed.orders[0].action, spec.emergency_bypass_executes_sell.expected.action);
}

// 7. B_min,tier < 10% vs >= 10% exact boundaries
{
  for (const [name, row] of Object.entries(matrix.cases.b_min_tier_boundaries)) {
    const out = evaluateWorkableBankrollBminTier({
      bankroll_w_usd: row.bankroll_w_usd,
      c_fixed_ann_usd: row.c_fixed_ann_usd,
      expected_excess_growth_ann_usd: row.expected_excess_growth_ann_usd,
    });
    assert.equal(out.status, row.expected.status, `${name}.status`);
    assert.equal(out.workable, row.expected.workable, `${name}.workable`);
    assert.equal(out.friction_ratio, row.expected.friction_ratio, `${name}.friction_ratio`);
    assert.equal(out.threshold_ratio, "0.1");
  }
}

// 8. Unset OI-COST-3 / OI-COST-4 & safety locks fail closed
{
  for (const [name, row] of Object.entries(matrix.cases.unset_oi_cost_and_safety_rejections)) {
    const res = evaluateDeployableCapitalSizing(row.input);
    assert.ok(validateSchema(res), `${name} schema: ${ajv.errorsText(validateSchema.errors)}`);
    assert.equal(res.status, row.expected.status, `${name}.status`);
    assert.equal(res.reason, row.expected.reason, `${name}.reason`);
    if (row.expected.oi_cost_3_resolved !== undefined) {
      assert.equal(res.fee_schedule.oi_cost_3_resolved, row.expected.oi_cost_3_resolved, `${name}.oi_cost_3_resolved`);
    }
    if (row.expected.oi_cost_4_resolved !== undefined) {
      assert.equal(res.fee_schedule.oi_cost_4_resolved, row.expected.oi_cost_4_resolved, `${name}.oi_cost_4_resolved`);
    }
    assert.equal(res.margin_enabled, false);
    assert.equal(res.h_usd, "0");
    assert.equal(res.kelly_applied, false);
    assert.equal(PRIVATE_LOCATOR_RE.test(JSON.stringify(res)), false);
  }
}

// 9. Composition with C-SA-14 (nav.js) + C-SA-25 (orders_fills)
{
  const provider = createPinnedCalendarProvider(pinnedCalendar);
  const nav = evaluateSizingUnitNav(
    {
      account_id: "ibkr:live:a1",
      platform: "ibkr",
      broker_environment: "live",
      management_status: "managed",
      evidence_state: "known",
      currency: "USD",
      nav_usd: "10000.00",
      settled_cash_usd: "4000.00",
      unsettled_cash_usd: "0",
      tbill_nav_usd: "5000.00",
      etf_market_value_usd: "1000.00",
      accrued_fees_usd: "0",
      margin_debt_usd: "0",
      margin_enabled: false,
      positions: [{ symbol: "TQQQ", qty: "20", market_value_usd: "1000.00", price_ref: "50.00" }],
      observed_at: "2025-01-08T21:00:00.000Z",
      fetched_at: "2025-01-08T21:00:05.000Z",
      evaluated_at: "2025-01-08T21:01:00.000Z",
      origin: "synthetic",
      source_class: "synthetic",
      evidence_ref: "sa2:a13:sa1-nav",
    },
    { calendarProvider: provider, require_live_cohort: true },
  );
  assert.equal(nav.status, "available");

  const ordersFills = evaluateAuthoritativeOrdersAndFills({
    broker: "ibkr",
    environment: "live",
    account: "ibkr:live:a1",
    as_of: "2025-01-08T21:00:30.000Z",
    evaluated_at: "2025-01-08T21:01:00.000Z",
    origin: "synthetic",
    source_class: "authorized_live_broker",
    evidence_ref: "sa2:a13:sa2-of",
    domains: {
      submissions: { domain_capability: "unsupported", as_of: null, source: "omitted", scope: "account_submissions" },
      executions: { domain_capability: "unsupported", as_of: null, source: "omitted", scope: "account_executions" },
      cutoff_open_orders: {
        domain_capability: "supported",
        as_of: "2025-01-08T21:00:30.000Z",
        source: "ibkr_open",
        scope: "cutoff_open_orders",
        cap: 256,
        completeness: "complete",
        truncated: false,
        records: [
          {
            client_order_id: "ord-ibkr-open-1",
            broker_order_id: "brk-ibkr-1",
            symbol: "SOXL",
            side: "BUY",
            state: "ACCEPTED",
            qty_submitted: "10",
            qty_filled: "0",
            qty_canceled: "0",
            qty_remaining: "10",
            limit_price: "25.00",
            currency: "USD",
            reserved_fee_usd: "1.25",
            as_of: "2025-01-08T21:00:30.000Z",
            evidence_ref: "sa2:a13:open-soxl",
          },
        ],
      },
    },
  });
  assert.equal(ordersFills.summary.k_pend_usd, "251.25");

  const composed = evaluateDeployableCapitalSizing({
    sizing_unit_nav: nav,
    orders_fills: ordersFills,
    r_cash_usd: "100.00",
    proceeds_eligible_usd: "0",
    fee_schedule: {
      provenance: "synthetic_fixture",
      c_min_usd: "1.00",
      c_per_share_usd: "0.01",
      c_reg: "0.25",
      b_exec_usd: "0",
    },
    targets: [{ symbol: "TQQQ", q_pre: "20", price_ref: "50.00", price_lim: "50.50", w_target: "0.30" }],
    evaluated_at: "2025-01-08T21:01:00.000Z",
    origin: "synthetic",
    source_class: "synthetic",
    evidence_ref: "sa2:a13:composed",
  });
  assert.ok(validateSchema(composed), ajv.errorsText(validateSchema.errors));
  assert.equal(composed.capital.c_inv_usd, "1000.00");
  assert.equal(composed.capital.k_pend_usd, "251.25");
  assert.equal(composed.capital.c_avail_usd, "3648.75");
  assert.equal(composed.orders[0].delta_q_buy, "40");
}

// 10. P1 regression guards for C-SA-Q21 (#1, #8-#14)
{
  // #1 (Q21): Unsupported/incomplete open-orders (k_pend_usd: null) blocks buys while keeping reductions unblocked.
  const unprovenOrdersFills = evaluateAuthoritativeOrdersAndFills({
    broker: "longbridge",
    environment: "paper",
    account: "longbridge:paper:pilot",
    as_of: "2026-11-24T15:00:00.000Z",
    evaluated_at: "2026-11-24T15:00:05.000Z",
    origin: "synthetic",
    source_class: "paper_broker",
    evidence_ref: "sa2:q21:p1:unproven-of",
    domains: {
      submissions: { domain_capability: "unsupported", as_of: null, source: "omitted", scope: "account_submissions" },
      executions: { domain_capability: "unsupported", as_of: null, source: "omitted", scope: "account_executions" },
      cutoff_open_orders: { domain_capability: "unsupported", as_of: null, source: "omitted", scope: "cutoff_open_orders" },
    },
  });
  assert.equal(unprovenOrdersFills.summary.k_pend_usd, null);
  const q21UnknownKPend = evaluateDeployableCapitalSizing({
    account_id: "longbridge:paper:pilot",
    broker: "longbridge",
    environment: "paper",
    currency: "USD",
    margin_enabled: false,
    h_usd: "0",
    kelly_applied: false,
    evaluated_at: "2026-11-24T15:00:05.000Z",
    equity_usd: "10000.00",
    cash_settled_usd: "5000.00",
    proceeds_eligible_usd: "0",
    r_cash_usd: "0",
    orders_fills: unprovenOrdersFills,
    fee_schedule: {
      provenance: "synthetic_fixture",
      c_min_usd: "1.00",
      c_per_share_usd: "0.01",
      c_reg: "0.25",
      b_exec_usd: "0",
    },
    targets: [
      { symbol: "TQQQ", q_pre: "0", price_ref: "50.00", price_lim: "50.50", w_target: "0.10" },
      { symbol: "SOXL", q_pre: "20", price_ref: "25.00", price_lim: "25.25", w_target: "0.025" },
    ],
    origin: "synthetic",
    source_class: "synthetic",
    evidence_ref: "sa2:q21:p1:unknown-kpend",
  });
  assert.ok(validateSchema(q21UnknownKPend), ajv.errorsText(validateSchema.errors));
  assert.equal(q21UnknownKPend.status, "available");
  assert.equal(q21UnknownKPend.capital.k_pend_usd, null);
  assert.equal(q21UnknownKPend.capital.k_pend_release_allowed, false);
  assert.equal(q21UnknownKPend.capital.c_avail_usd, "0");
  assert.equal(q21UnknownKPend.orders.find((o) => o.symbol === "TQQQ").action, "BLOCKED_BUY");
  assert.equal(q21UnknownKPend.orders.find((o) => o.symbol === "TQQQ").delta_q_buy, "0");
  assert.equal(q21UnknownKPend.orders.find((o) => o.symbol === "SOXL").action, "SELL");
  assert.equal(q21UnknownKPend.orders.find((o) => o.symbol === "SOXL").delta_q_sell, "10");

  // #8: Invalid order_unknown_symbols returns structured unavailable without TDZ ReferenceError.
  const badUnknownList = evaluateDeployableCapitalSizing({
    account_id: "longbridge:paper:pilot",
    broker: "longbridge",
    environment: "paper",
    evaluated_at: "2026-11-24T15:00:00.000Z",
    order_unknown_symbols: "TQQQ",
    fee_schedule: { provenance: "synthetic_fixture", c_min_usd: "1.00", c_per_share_usd: "0.01", c_reg: "0.25", b_exec_usd: "0" },
    targets: [],
  });
  assert.ok(validateSchema(badUnknownList));
  assert.equal(badUnknownList.status, "unavailable");
  assert.equal(badUnknownList.reason, "invalid_order_unknown_symbols");

  const badUnknownSym = evaluateDeployableCapitalSizing({
    account_id: "longbridge:paper:pilot",
    broker: "longbridge",
    environment: "paper",
    evaluated_at: "2026-11-24T15:00:00.000Z",
    order_unknown_symbols: ["U" + "1234567"],
    fee_schedule: { provenance: "synthetic_fixture", c_min_usd: "1.00", c_per_share_usd: "0.01", c_reg: "0.25", b_exec_usd: "0" },
    targets: [],
  });
  assert.ok(validateSchema(badUnknownSym));
  assert.equal(badUnknownSym.status, "unavailable");
  assert.equal(badUnknownSym.reason, "invalid_order_unknown_symbol");

  // #9a: Top-level account vs orders_fills mismatch (without nav) must fail closed.
  const crossAccountRelabel = evaluateDeployableCapitalSizing({
    account_id: "ibkr:live:a1",
    broker: "ibkr",
    environment: "live",
    evaluated_at: "2026-11-24T15:00:05.000Z",
    equity_usd: "10000.00",
    cash_settled_usd: "5000.00",
    proceeds_eligible_usd: "0",
    r_cash_usd: "0",
    orders_fills: unprovenOrdersFills,
    fee_schedule: { provenance: "synthetic_fixture", c_min_usd: "1.00", c_per_share_usd: "0.01", c_reg: "0.25", b_exec_usd: "0" },
    targets: [],
  });
  assert.ok(validateSchema(crossAccountRelabel));
  assert.equal(crossAccountRelabel.status, "unavailable");
  assert.equal(crossAccountRelabel.reason, "raw_orders_broker_mismatch");

  // #10: Omitting b_exec_usd must fail closed as oi_cost_3_fee_schedule_unavailable.
  const missingBExec = evaluateDeployableCapitalSizing({
    account_id: "longbridge:paper:pilot",
    broker: "longbridge",
    environment: "paper",
    evaluated_at: "2026-11-24T15:00:00.000Z",
    equity_usd: "10000.00",
    cash_settled_usd: "5000.00",
    proceeds_eligible_usd: "0",
    r_cash_usd: "0",
    k_pend_usd: "0",
    fee_schedule: { provenance: "synthetic_fixture", c_min_usd: "1.00", c_per_share_usd: "0.01", c_reg: "0.25" },
    targets: [{ symbol: "TQQQ", q_pre: "0", price_ref: "50.00", price_lim: "50.50", w_target: "0.10" }],
  });
  assert.ok(validateSchema(missingBExec));
  assert.equal(missingBExec.status, "unavailable");
  assert.equal(missingBExec.reason, "oi_cost_3_fee_schedule_unavailable");
  assert.equal(missingBExec.fee_schedule.oi_cost_3_resolved, false);

  // #11: Buy missing O5 collar in a mixed portfolio with C_avail = 0 keeps reduction SELL unblocked.
  const mixedBuyNoCollarPlusSell = evaluateDeployableCapitalSizing({
    account_id: "longbridge:paper:pilot",
    broker: "longbridge",
    environment: "paper",
    evaluated_at: "2026-11-24T15:00:00.000Z",
    equity_usd: "10000.00",
    cash_settled_usd: "0",
    proceeds_eligible_usd: "0",
    r_cash_usd: "0",
    k_pend_usd: "0",
    fee_schedule: { provenance: "synthetic_fixture", c_min_usd: "1.00", c_per_share_usd: "0.01", c_reg: "0.25", b_exec_usd: "0" },
    targets: [
      { symbol: "TQQQ", q_pre: "0", price_ref: "50.00", price_lim: null, w_target: "0.10" },
      { symbol: "SOXL", q_pre: "20", price_ref: "25.00", price_lim: null, w_target: "0.025" },
    ],
  });
  assert.ok(validateSchema(mixedBuyNoCollarPlusSell), ajv.errorsText(validateSchema.errors));
  assert.equal(mixedBuyNoCollarPlusSell.status, "available");
  assert.equal(mixedBuyNoCollarPlusSell.fee_schedule.oi_cost_4_resolved, false);
  const blockedBuy = mixedBuyNoCollarPlusSell.orders.find((o) => o.symbol === "TQQQ");
  const unblockedSell = mixedBuyNoCollarPlusSell.orders.find((o) => o.symbol === "SOXL");
  assert.equal(blockedBuy.action, "BLOCKED_BUY");
  assert.equal(blockedBuy.delta_q_buy, "0");
  assert.equal(blockedBuy.buy_blocked_reason, "oi_cost_4_price_collar_unavailable");
  assert.equal(unblockedSell.action, "SELL");
  assert.equal(unblockedSell.delta_q_sell, "10");

  // #12: emergency_bypass rejects string "false" / non-boolean and enforces strict boolean precedence.
  const stringBypass = evaluateDeployableCapitalSizing({
    account_id: "longbridge:paper:pilot",
    broker: "longbridge",
    environment: "paper",
    evaluated_at: "2026-11-24T15:00:00.000Z",
    equity_usd: "10000.00",
    cash_settled_usd: "5000.00",
    proceeds_eligible_usd: "0",
    r_cash_usd: "0",
    k_pend_usd: "0",
    b_band: "0.20",
    emergency_bypass: "false",
    fee_schedule: { provenance: "synthetic_fixture", c_min_usd: "1.00", c_per_share_usd: "0.01", c_reg: "0.25", b_exec_usd: "0" },
    targets: [{ symbol: "SOXL", q_pre: "20", price_ref: "25.00", price_lim: "25.25", w_target: "0.045" }],
  });
  assert.ok(validateSchema(stringBypass));
  assert.equal(stringBypass.status, "unavailable");
  assert.equal(stringBypass.reason, "invalid_emergency_bypass");

  const precedenceBypass = evaluateDeployableCapitalSizing({
    account_id: "longbridge:paper:pilot",
    broker: "longbridge",
    environment: "paper",
    evaluated_at: "2026-11-24T15:00:00.000Z",
    equity_usd: "10000.00",
    cash_settled_usd: "0",
    proceeds_eligible_usd: "0",
    r_cash_usd: "0",
    k_pend_usd: "0",
    b_band: "0.20",
    emergency_bypass: true,
    fee_schedule: { provenance: "synthetic_fixture", c_min_usd: "1.00", c_per_share_usd: "0.01", c_reg: "0.25", b_exec_usd: "0" },
    targets: [
      { symbol: "SOXL", q_pre: "20", price_ref: "25.00", price_lim: "25.25", w_target: "0.045", emergency_bypass: false },
      { symbol: "TQQQ", q_pre: "10", price_ref: "50.00", price_lim: "50.50", w_target: "0.045" },
    ],
  });
  assert.ok(validateSchema(precedenceBypass));
  assert.equal(precedenceBypass.orders.find((o) => o.symbol === "SOXL").action, "HOLD");
  assert.equal(precedenceBypass.orders.find((o) => o.symbol === "SOXL").emergency_bypass_applied, false);
  assert.equal(precedenceBypass.orders.find((o) => o.symbol === "TQQQ").action, "SELL");
  assert.equal(precedenceBypass.orders.find((o) => o.symbol === "TQQQ").emergency_bypass_applied, true);

  // #13a: Held non-zero position without valuation fails closed instead of C_inv = 0.
  const unpricedPosition = evaluateDeployableCapitalSizing({
    account_id: "longbridge:paper:pilot",
    broker: "longbridge",
    environment: "paper",
    evaluated_at: "2026-11-24T15:00:00.000Z",
    equity_usd: "10000.00",
    cash_settled_usd: "5000.00",
    proceeds_eligible_usd: "0",
    r_cash_usd: "0",
    k_pend_usd: "0",
    positions: [{ symbol: "QQQ", qty: "10" }],
    fee_schedule: { provenance: "synthetic_fixture", c_min_usd: "1.00", c_per_share_usd: "0.01", c_reg: "0.25", b_exec_usd: "0" },
    targets: [],
  });
  assert.ok(validateSchema(unpricedPosition));
  assert.equal(unpricedPosition.status, "unavailable");
  assert.equal(unpricedPosition.reason, "held_position_valuation_unavailable");
  assert.equal(unpricedPosition.capital.c_inv_usd, null);

  // #13b: B_min,tier missing annual_rounding_friction_usd or annual_passthrough_usd fails closed as unavailable.
  const feeModelResolved = { ok: true, cMinRat: { n: 1n, d: 1n }, cRegSpec: { fixed: { n: 1n, d: 4n } } };
  const incompleteBmin = evaluateWorkableBankrollBminTier({
    bankroll_w_usd: "50000.00",
    annual_ticket_count: 10,
    fee_schedule_resolved: feeModelResolved,
    expected_excess_growth_ann_usd: "5000.00",
  });
  assert.equal(incompleteBmin.status, "unavailable");
  assert.equal(incompleteBmin.workable, null);
  assert.equal(incompleteBmin.reason, "incomplete_fixed_annual_cost_inputs");

  const completeBmin = evaluateWorkableBankrollBminTier({
    bankroll_w_usd: "50000.00",
    annual_ticket_count: 10,
    annual_rounding_friction_usd: "50.00",
    annual_passthrough_usd: "10.00",
    fee_schedule_resolved: feeModelResolved,
    expected_excess_growth_ann_usd: "5000.00",
  });
  assert.equal(completeBmin.status, "available");
  assert.equal(completeBmin.c_fixed_ann_usd, "72.50");
  assert.equal(completeBmin.workable, true);

  // #14: sizing_unit_nav.reason containing raw account / token / private locator is sanitized, never echoed.
  const leakyNavRes = evaluateDeployableCapitalSizing({
    account_id: "ibkr:live:a1",
    broker: "ibkr",
    environment: "live",
    evaluated_at: "2026-11-24T15:00:00.000Z",
    sizing_unit_nav: {
      account_id: "ibkr:live:a1",
      platform: "ibkr",
      broker_environment: "live",
      status: "unavailable",
      reason: "account token " + "U" + "1234567 kv:" + "//bucket/secret",
      currency: "USD",
      freshness: { data_status: "unavailable" },
    },
    fee_schedule: { provenance: "synthetic_fixture", c_min_usd: "1.00", c_per_share_usd: "0.01", c_reg: "0.25", b_exec_usd: "0" },
    targets: [],
  });
  assert.ok(validateSchema(leakyNavRes), ajv.errorsText(validateSchema.errors));
  assert.equal(leakyNavRes.status, "unavailable");
  assert.equal(leakyNavRes.reason, "sizing_unit_nav_unavailable");
  assert.equal(JSON.stringify(leakyNavRes).includes("account token"), false);
  assert.equal(JSON.stringify(leakyNavRes).includes("U" + "1234567"), false);
  assert.equal(PRIVATE_LOCATOR_RE.test(JSON.stringify(leakyNavRes)), false);

  const unsafeEvidence = evaluateDeployableCapitalSizing({
    account_id: "longbridge:paper:pilot",
    broker: "longbridge",
    environment: "paper",
    evaluated_at: "2026-11-24T15:00:00.000Z",
    fee_schedule: { provenance: "synthetic_fixture", c_min_usd: "1.00", c_per_share_usd: "0.01", c_reg: "0.25", b_exec_usd: "0" },
    targets: [],
    evidence_ref: "kv:" + "//bucket/secret",
  });
  assert.ok(validateSchema(unsafeEvidence));
  assert.equal(unsafeEvidence.status, "unavailable");
  assert.equal(unsafeEvidence.reason, "unsafe_evidence_ref");
  assert.equal(PRIVATE_LOCATOR_RE.test(JSON.stringify(unsafeEvidence)), false);
}

// 11. Codex review regression (#3 PRRT_kwDOSZeN-M67n_nm: stale nonzero target q_pre absent from complete nav.positions)
{
  const provider = createPinnedCalendarProvider(pinnedCalendar);
  const allCashNav = evaluateSizingUnitNav(
    {
      account_id: "ibkr:live:a1",
      platform: "ibkr",
      broker_environment: "live",
      management_status: "managed",
      evidence_state: "known",
      currency: "USD",
      nav_usd: "10000.00",
      settled_cash_usd: "10000.00",
      unsettled_cash_usd: "0",
      tbill_nav_usd: "0",
      etf_market_value_usd: "0",
      accrued_fees_usd: "0",
      margin_debt_usd: "0",
      margin_enabled: false,
      positions: [],
      observed_at: "2025-01-08T21:00:00.000Z",
      fetched_at: "2025-01-08T21:00:05.000Z",
      evaluated_at: "2025-01-08T21:01:00.000Z",
      origin: "synthetic",
      source_class: "synthetic",
      evidence_ref: "sa2:codex:all-cash-nav",
    },
    { calendarProvider: provider, require_live_cohort: true },
  );
  assert.equal(allCashNav.status, "available");

  // Stale nonzero q_pre on symbol absent from nav.positions: [] must fail closed instead of selling unheld shares.
  const oversellBlocked = evaluateDeployableCapitalSizing({
    sizing_unit_nav: allCashNav,
    r_cash_usd: "0",
    proceeds_eligible_usd: "0",
    k_pend_usd: "0",
    fee_schedule: { provenance: "synthetic_fixture", c_min_usd: "1.00", c_per_share_usd: "0.01", c_reg: "0.25", b_exec_usd: "0" },
    targets: [{ symbol: "ABC", q_pre: "10", price_ref: "50.00", price_lim: "50.50", w_target: "0" }],
    evaluated_at: "2025-01-08T21:01:00.000Z",
    origin: "synthetic",
    source_class: "synthetic",
    evidence_ref: "sa2:codex:oversell-blocked",
  });
  assert.ok(validateSchema(oversellBlocked), ajv.errorsText(validateSchema.errors));
  assert.equal(oversellBlocked.status, "unavailable");
  assert.equal(oversellBlocked.reason, "positions_target_q_pre_mismatch");
  assert.equal(oversellBlocked.orders.length, 0);

  // Target absent from nav.positions: [] with q_pre === "0" is genuinely zero-held and allowed to BUY cleanly.
  const freshBuyAllowed = evaluateDeployableCapitalSizing({
    sizing_unit_nav: allCashNav,
    r_cash_usd: "0",
    proceeds_eligible_usd: "0",
    k_pend_usd: "0",
    fee_schedule: { provenance: "synthetic_fixture", c_min_usd: "1.00", c_per_share_usd: "0.01", c_reg: "0.25", b_exec_usd: "0" },
    targets: [{ symbol: "ABC", q_pre: "0", price_ref: "50.00", price_lim: "50.50", w_target: "0.05" }],
    evaluated_at: "2025-01-08T21:01:00.000Z",
    origin: "synthetic",
    source_class: "synthetic",
    evidence_ref: "sa2:codex:fresh-buy-ok",
  });
  assert.ok(validateSchema(freshBuyAllowed), ajv.errorsText(validateSchema.errors));
  assert.equal(freshBuyAllowed.status, "available");
  assert.equal(freshBuyAllowed.orders[0].action, "BUY");
  assert.equal(freshBuyAllowed.orders[0].delta_q_buy, "10");

  // Codex round-3 #2 (PRRT_kwDOSZeN-M67o1UW): Reject orders_fills evaluated after sizing boundary (no look-ahead cash release).
  const ofAt1602 = evaluateAuthoritativeOrdersAndFills({
    broker: "ibkr",
    environment: "live",
    account: "ibkr:live:a1",
    as_of: "2026-11-24T16:02:00.000Z",
    evaluated_at: "2026-11-24T16:02:00.000Z",
    origin: "synthetic",
    source_class: "authorized_live_broker",
    evidence_ref: "sa2:codex-r3:of-1602",
    domains: {
      submissions: {
        domain_capability: "supported",
        as_of: "2026-11-24T16:02:00.000Z",
        source: "ibkr_subs",
        scope: "account_submissions",
        cap: 256,
        count: 1,
        truncated: false,
        completeness: "complete",
        records: [
          {
            client_order_id: "ord-fill-1600",
            broker_order_id: "brk-fill-1600",
            symbol: "AAPL",
            side: "BUY",
            state: "FILLED",
            qty_submitted: "10",
            limit_price: "50",
            currency: "USD",
            fee_native: null,
            fee_currency: null,
            submitted_at: "2026-11-24T14:55:00.000Z",
            resolved_at: "2026-11-24T16:00:00.000Z",
            evidence_ref: "sa2:codex-r3:sub-1600",
          },
        ],
      },
      executions: {
        domain_capability: "supported",
        as_of: "2026-11-24T16:02:00.000Z",
        source: "ibkr_execs",
        scope: "account_executions",
        cap: 512,
        count: 1,
        truncated: false,
        completeness: "complete",
        records: [
          {
            execution_ref: "exec-fill-1600",
            client_order_id: "ord-fill-1600",
            broker_order_id: "brk-fill-1600",
            symbol: "AAPL",
            side: "BUY",
            qty: "10",
            price: "50",
            currency: "USD",
            fee_native: "0",
            fee_currency: "USD",
            executed_at: "2026-11-24T16:00:00.000Z",
            evidence_ref: "sa2:codex-r3:ex-1600",
          },
        ],
      },
      cutoff_open_orders: {
        domain_capability: "supported",
        as_of: "2026-11-24T16:02:00.000Z",
        source: "ibkr_open",
        scope: "cutoff_open_orders",
        cap: 256,
        count: 0,
        truncated: false,
        completeness: "complete",
        records: [],
      },
    },
  });
  assert.equal(ofAt1602.summary.k_pend_usd, "0");

  const lookaheadRejectedRawEval = evaluateDeployableCapitalSizing({
    broker: "ibkr",
    environment: "live",
    account_id: "ibkr:live:a1",
    evaluated_at: "2026-11-24T15:02:00.000Z",
    equity_usd: "1000.00",
    cash_settled_usd: "500.00",
    proceeds_eligible_usd: "0",
    r_cash_usd: "0",
    orders_fills: ofAt1602,
    fee_schedule: { provenance: "synthetic_fixture", c_min_usd: "1.00", c_per_share_usd: "0.01", c_reg: "0.25", b_exec_usd: "0" },
    targets: [{ symbol: "AAPL", q_pre: "0", price_ref: "50.00", price_lim: "50.50", w_target: "1" }],
    origin: "synthetic",
    source_class: "synthetic",
    evidence_ref: "sa2:codex-r3:lookahead-raw",
  });
  assert.ok(validateSchema(lookaheadRejectedRawEval), ajv.errorsText(validateSchema.errors));
  assert.equal(lookaheadRejectedRawEval.status, "unavailable");
  assert.equal(lookaheadRejectedRawEval.reason, "orders_fills_evaluated_after_sizing_boundary");
  assert.equal(lookaheadRejectedRawEval.orders.length, 0);

  const lookaheadRejectedOptEval = evaluateDeployableCapitalSizing({
    broker: "ibkr",
    environment: "live",
    account_id: "ibkr:live:a1",
    equity_usd: "1000.00",
    cash_settled_usd: "500.00",
    proceeds_eligible_usd: "0",
    r_cash_usd: "0",
    orders_fills: ofAt1602,
    fee_schedule: { provenance: "synthetic_fixture", c_min_usd: "1.00", c_per_share_usd: "0.01", c_reg: "0.25", b_exec_usd: "0" },
    targets: [{ symbol: "AAPL", q_pre: "0", price_ref: "50.00", price_lim: "50.50", w_target: "1" }],
    origin: "synthetic",
    source_class: "synthetic",
    evidence_ref: "sa2:codex-r3:lookahead-opt",
  }, { evaluated_at: "2026-11-24T15:02:00.000Z" });
  assert.ok(validateSchema(lookaheadRejectedOptEval), ajv.errorsText(validateSchema.errors));
  assert.equal(lookaheadRejectedOptEval.status, "unavailable");
  assert.equal(lookaheadRejectedOptEval.reason, "orders_fills_evaluated_after_sizing_boundary");
  assert.equal(lookaheadRejectedOptEval.orders.length, 0);

  // Positive control: orders_fills evaluated at 16:02 composed into sizing at 16:02 succeeds cleanly.
  const sameBoundaryOk = evaluateDeployableCapitalSizing({
    broker: "ibkr",
    environment: "live",
    account_id: "ibkr:live:a1",
    evaluated_at: "2026-11-24T16:02:00.000Z",
    equity_usd: "1000.00",
    cash_settled_usd: "500.00",
    proceeds_eligible_usd: "0",
    r_cash_usd: "0",
    orders_fills: ofAt1602,
    fee_schedule: { provenance: "synthetic_fixture", c_min_usd: "1.00", c_per_share_usd: "0.01", c_reg: "0.25", b_exec_usd: "0" },
    targets: [{ symbol: "AAPL", q_pre: "0", price_ref: "50.00", price_lim: "50.50", w_target: "0.5" }],
    origin: "synthetic",
    source_class: "synthetic",
    evidence_ref: "sa2:codex-r3:same-boundary-ok",
  });
  assert.ok(validateSchema(sameBoundaryOk), ajv.errorsText(validateSchema.errors));
  assert.equal(sameBoundaryOk.status, "available");

  // Compose Codex round-3 #1 into sizing: untimed execution without cutoff keeps $500 reserved so other buys cannot spend it.
  const untimedOrdersFills = evaluateAuthoritativeOrdersAndFills({
    broker: "ibkr",
    environment: "live",
    account: "ibkr:live:a1",
    as_of: "2026-11-24T15:02:00.000Z",
    evaluated_at: "2026-11-24T15:02:00.000Z",
    origin: "synthetic",
    source_class: "authorized_live_broker",
    evidence_ref: "sa2:codex-r3:untimed-sizing",
    domains: {
      submissions: {
        domain_capability: "supported",
        as_of: "2026-11-24T15:02:00.000Z",
        source: "ibkr_subs",
        scope: "account_submissions",
        cap: 256,
        count: 1,
        truncated: false,
        completeness: "complete",
        records: [
          {
            client_order_id: "ord-untimed-sz",
            broker_order_id: "brk-untimed-sz",
            symbol: "MSFT",
            side: "BUY",
            state: "ACCEPTED",
            qty_submitted: "10",
            limit_price: "50",
            estimated_fee_usd: "0",
            currency: "USD",
            fee_native: null,
            fee_currency: null,
            submitted_at: "2026-11-24T15:01:00.000Z",
            evidence_ref: "sa2:codex-r3:sub-untimed-sz",
          },
        ],
      },
      executions: {
        domain_capability: "supported",
        as_of: "2026-11-24T15:02:00.000Z",
        source: "ibkr_execs",
        scope: "account_executions",
        cap: 512,
        count: 1,
        truncated: false,
        completeness: "complete",
        records: [
          {
            execution_ref: "exec-untimed-sz",
            client_order_id: "ord-untimed-sz",
            broker_order_id: "brk-untimed-sz",
            symbol: "MSFT",
            side: "BUY",
            qty: "10",
            price: "50",
            currency: "USD",
            fee_native: "0",
            fee_currency: "USD",
            executed_at: null,
            evidence_ref: "sa2:codex-r3:ex-untimed-sz",
          },
        ],
      },
      cutoff_open_orders: {
        domain_capability: "supported",
        as_of: "2026-11-24T15:00:00.000Z",
        source: "ibkr_open",
        scope: "cutoff_open_orders",
        cap: 256,
        count: 0,
        truncated: false,
        completeness: "complete",
        records: [],
      },
    },
  });
  const untimedBuyBlocked = evaluateDeployableCapitalSizing({
    broker: "ibkr",
    environment: "live",
    account_id: "ibkr:live:a1",
    evaluated_at: "2026-11-24T15:02:00.000Z",
    equity_usd: "1000.00",
    cash_settled_usd: "500.00",
    proceeds_eligible_usd: "0",
    r_cash_usd: "0",
    orders_fills: untimedOrdersFills,
    fee_schedule: { provenance: "synthetic_fixture", c_min_usd: "1.00", c_per_share_usd: "0.01", c_reg: "0.25", b_exec_usd: "0" },
    targets: [{ symbol: "AAPL", q_pre: "0", price_ref: "50.00", price_lim: "50.50", w_target: "0.5" }],
    origin: "synthetic",
    source_class: "synthetic",
    evidence_ref: "sa2:codex-r3:untimed-buy-blocked",
  });
  assert.ok(validateSchema(untimedBuyBlocked), ajv.errorsText(validateSchema.errors));
  assert.equal(untimedBuyBlocked.capital.k_pend_usd, "500.00");
  assert.equal(untimedBuyBlocked.capital.k_pend_release_allowed, false);
  assert.equal(untimedBuyBlocked.capital.c_avail_usd, "0");
  assert.equal(untimedBuyBlocked.orders[0].delta_q_buy, "0");
  assert.equal(untimedBuyBlocked.orders[0].buy_blocked_reason, "zero_deployable_cash");
}

console.log("sa2_deployable_capital_validation: PASS (SA-A13)");
