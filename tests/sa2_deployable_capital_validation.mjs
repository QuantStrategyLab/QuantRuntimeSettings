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

console.log("sa2_deployable_capital_validation: PASS (SA-A13)");
