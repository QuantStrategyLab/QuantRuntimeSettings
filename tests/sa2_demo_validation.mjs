import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../web/strategy-switch-console/package.json", import.meta.url));
const Ajv2020 = require("ajv/dist/2020").default;
const addFormats = require("ajv-formats");

const loadJson = (relPath) => JSON.parse(readFileSync(new URL(relPath, import.meta.url), "utf8"));

const ordersFillsSchema = loadJson("../schemas/qsl-authoritative-orders-fills.v1.schema.json");
const deployableCapitalSchema = loadJson("../schemas/qsl-deployable-capital-sizing.v1.schema.json");
const demoFixture = loadJson("./fixtures/sa2/sa2_demo_cases.json");

const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false });
addFormats(ajv);
const validateOrdersFillsSchema = ajv.compile(ordersFillsSchema);
const validateDeployableCapitalSchema = ajv.compile(deployableCapitalSchema);

const PRIVATE_LOCATOR_RE = new RegExp(
  "(?:source_ref|kv_key|do_key|kv://|do://|/" + "Users/|/" + "home/|broker_account_hash|broker_account_id)",
);

const caseArgIndex = process.argv.indexOf("--case");
const requestedCase = caseArgIndex >= 0 ? process.argv[caseArgIndex + 1] : null;

const handlers = {
  async "SA2-D1"() {
    const { evaluateDeployableCapitalSizing } = await import(
      "../web/strategy-switch-console/application/sizing_unit/deployable_capital.js"
    );
    const spec = demoFixture.cases["SA2-D1"];
    const zeroCash = evaluateDeployableCapitalSizing(spec.zero_cash_case.input);
    assert.ok(
      validateDeployableCapitalSchema(zeroCash),
      `SA2-D1 zero_cash schema: ${ajv.errorsText(validateDeployableCapitalSchema.errors)}`,
    );
    assert.equal(zeroCash.status, spec.zero_cash_case.expected.status);
    assert.equal(zeroCash.capital.c_inv_usd, spec.zero_cash_case.expected.c_inv_usd);
    assert.equal(zeroCash.capital.c_avail_usd, spec.zero_cash_case.expected.c_avail_usd);
    assert.equal(zeroCash.capital.total_buy_commit_usd, spec.zero_cash_case.expected.total_buy_commit_usd);
    const tqqq = zeroCash.orders.find((o) => o.symbol === "TQQQ");
    const soxl = zeroCash.orders.find((o) => o.symbol === "SOXL");
    assert.ok(tqqq && soxl);
    for (const [k, v] of Object.entries(spec.zero_cash_case.expected.tqqq)) {
      assert.equal(tqqq[k], v, `SA2-D1 zero_cash.tqqq.${k}`);
    }
    for (const [k, v] of Object.entries(spec.zero_cash_case.expected.soxl)) {
      assert.equal(soxl[k], v, `SA2-D1 zero_cash.soxl.${k}`);
    }
    assert.equal(PRIVATE_LOCATOR_RE.test(JSON.stringify(zeroCash)), false);

    const pos = evaluateDeployableCapitalSizing(spec.positive_control.input);
    assert.ok(
      validateDeployableCapitalSchema(pos),
      `SA2-D1 positive schema: ${ajv.errorsText(validateDeployableCapitalSchema.errors)}`,
    );
    assert.equal(pos.status, spec.positive_control.expected.status);
    assert.equal(pos.capital.c_avail_usd, spec.positive_control.expected.c_avail_usd);
    assert.equal(pos.capital.total_buy_commit_usd, spec.positive_control.expected.total_buy_commit_usd);
    const posTqqq = pos.orders.find((o) => o.symbol === "TQQQ");
    const posSoxl = pos.orders.find((o) => o.symbol === "SOXL");
    assert.equal(posTqqq.delta_q_buy, spec.positive_control.expected.tqqq_delta_q_buy);
    assert.equal(posTqqq.action, spec.positive_control.expected.tqqq_action);
    assert.equal(posSoxl.delta_q_sell, spec.positive_control.expected.soxl_delta_q_sell);
    assert.equal(posSoxl.action, spec.positive_control.expected.soxl_action);
  },

  async "SA2-D2"() {
    const { evaluateDeployableCapitalSizing } = await import(
      "../web/strategy-switch-console/application/sizing_unit/deployable_capital.js"
    );
    const spec = demoFixture.cases["SA2-D2"];
    const res = evaluateDeployableCapitalSizing(spec.boundary_case.input);
    assert.ok(
      validateDeployableCapitalSchema(res),
      `SA2-D2 boundary schema: ${ajv.errorsText(validateDeployableCapitalSchema.errors)}`,
    );
    assert.equal(res.status, spec.boundary_case.expected.status);
    assert.equal(res.fractional_shares, spec.boundary_case.expected.fractional_shares);
    assert.equal(res.capital.c_avail_usd, spec.boundary_case.expected.c_avail_usd);
    assert.equal(res.capital.remaining_deployable_cash_usd, spec.boundary_case.expected.remaining_deployable_cash_usd);
    const ord = res.orders[0];
    assert.equal(ord.q_ideal, spec.boundary_case.expected.q_ideal);
    assert.equal(ord.delta_q_buy, spec.boundary_case.expected.delta_q_buy);
    assert.equal(ord.q_target, spec.boundary_case.expected.q_target);
    assert.equal(ord.est_worst_case_notional_usd, spec.boundary_case.expected.est_worst_case_notional_usd);
    assert.equal(ord.est_commission_usd, spec.boundary_case.expected.est_commission_usd);
    assert.equal(ord.est_total_buy_commit_usd, spec.boundary_case.expected.est_total_buy_commit_usd);
    assert.equal(ord.rho_order.value, spec.boundary_case.expected.rho_order_value);
    assert.equal(ord.rho_order.threshold, spec.boundary_case.expected.rho_order_threshold);

    const pos = evaluateDeployableCapitalSizing(spec.positive_control.input);
    assert.ok(validateDeployableCapitalSchema(pos));
    assert.equal(pos.orders[0].delta_q_buy, spec.positive_control.expected.delta_q_buy);
    assert.equal(pos.orders[0].est_total_buy_commit_usd, spec.positive_control.expected.est_total_buy_commit_usd);
    assert.equal(pos.capital.remaining_deployable_cash_usd, spec.positive_control.expected.remaining_deployable_cash_usd);
  },

  async "SA2-D3"() {
    const {
      applyOrderUnknownObservation,
      checkSymbolOrderAllowed,
      createOrderUnknownLockStore,
      deserializeOrderUnknownLockStore,
      lockedSymbolsForAccount,
      serializeOrderUnknownLockStore,
    } = await import(
      "../web/strategy-switch-console/application/orders_fills/order_unknown_lock.js"
    );
    const { evaluateAuthoritativeOrdersAndFills } = await import(
      "../web/strategy-switch-console/application/orders_fills/helpers.js"
    );
    const { evaluateDeployableCapitalSizing } = await import(
      "../web/strategy-switch-console/application/sizing_unit/deployable_capital.js"
    );

    const spec = demoFixture.cases["SA2-D3"];
    let store = createOrderUnknownLockStore();
    store = applyOrderUnknownObservation(store, spec.timeout_submission);
    const serialized = JSON.stringify(serializeOrderUnknownLockStore(store));
    // Simulate DO/store process restart
    const reloaded = deserializeOrderUnknownLockStore(JSON.parse(serialized));

    const identity = {
      broker: spec.timeout_submission.broker,
      environment: spec.timeout_submission.environment,
      account: spec.timeout_submission.account,
    };
    const tqqqCheck = checkSymbolOrderAllowed(reloaded, { ...identity, symbol: "TQQQ" });
    assert.equal(tqqqCheck.allowed, false);
    assert.equal(tqqqCheck.query_target.by, spec.expected.query_target_pre_ack_by);
    assert.equal(tqqqCheck.query_target.client_order_id, spec.timeout_submission.client_order_id);
    assert.equal(tqqqCheck.query_target.broker_order_id, null);

    // Non-terminal update must NOT clear the ORDER-UNKNOWN lock
    const stillLocked = applyOrderUnknownObservation(reloaded, spec.non_terminal_followup);
    assert.deepEqual(lockedSymbolsForAccount(stillLocked, identity), spec.expected.locked_symbols);

    const ordersState = evaluateAuthoritativeOrdersAndFills(
      {
        ...identity,
        as_of: "2026-11-24T15:00:00.000Z",
        evaluated_at: "2026-11-24T15:00:05.000Z",
        origin: "synthetic",
        source_class: "paper_broker",
        evidence_ref: "sa2:demo:d3-eval",
        domains: {
          submissions: {
            domain_capability: "supported",
            as_of: "2026-11-24T15:00:00.000Z",
            source: "longbridge_paper_orders",
            scope: "account_submissions",
            cap: 512,
            completeness: "complete",
            truncated: false,
            records: [spec.timeout_submission],
          },
          executions: {
            domain_capability: "supported",
            as_of: "2026-11-24T15:00:00.000Z",
            source: "longbridge_paper_fills",
            scope: "account_executions",
            cap: 512,
            completeness: "complete",
            truncated: false,
            records: [],
          },
          cutoff_open_orders: {
            domain_capability: "supported",
            as_of: "2026-11-24T15:00:00.000Z",
            source: "longbridge_paper_open",
            scope: "cutoff_open_orders",
            cap: 512,
            completeness: "complete",
            truncated: false,
            records: [spec.non_terminal_followup],
          },
        },
      },
      { lockStore: stillLocked },
    );
    assert.ok(validateOrdersFillsSchema(ordersState), ajv.errorsText(validateOrdersFillsSchema.errors));
    assert.deepEqual(ordersState.order_unknown_symbols, spec.expected.locked_symbols);
    assert.equal(ordersState.summary.k_pend_usd, spec.expected.k_pend_locked_usd);
    assert.equal(ordersState.summary.k_pend_release_allowed, false);

    const sized = evaluateDeployableCapitalSizing({
      account_id: identity.account,
      broker: identity.broker,
      environment: identity.environment,
      currency: "USD",
      margin_enabled: false,
      h_usd: "0",
      kelly_applied: false,
      evaluated_at: "2026-11-24T15:00:05.000Z",
      equity_usd: "5000.00",
      cash_settled_usd: "5000.00",
      proceeds_eligible_usd: "0",
      r_cash_usd: "0",
      orders_fills: ordersState,
      fee_schedule: {
        provenance: "synthetic_fixture",
        c_min_usd: "1.00",
        c_per_share_usd: "0.01",
        c_reg: "0.25",
        b_exec_usd: "0",
      },
      targets: [
        { symbol: "TQQQ", q_pre: "0", price_ref: "50.00", price_lim: "50.50", w_target: "0.20" },
        { symbol: "SOXL", q_pre: "0", price_ref: "25.00", price_lim: "25.25", w_target: "0.02" },
      ],
      origin: "synthetic",
      source_class: "paper_broker",
      evidence_ref: "sa2:demo:d3-sizing",
    });
    assert.ok(validateDeployableCapitalSchema(sized), ajv.errorsText(validateDeployableCapitalSchema.errors));
    assert.equal(sized.orders.find((o) => o.symbol === "TQQQ").delta_q_buy, spec.expected.tqqq_buy_blocked_while_locked);
    assert.equal(sized.orders.find((o) => o.symbol === "SOXL").delta_q_buy, spec.expected.soxl_buy_unblocked_while_tqqq_locked);

    // Terminal broker evidence clears lock and allows release when cutoff open orders are complete & empty
    const clearedStore = applyOrderUnknownObservation(stillLocked, spec.terminal_resolution);
    assert.deepEqual(lockedSymbolsForAccount(clearedStore, identity), []);
    const afterTerminal = evaluateAuthoritativeOrdersAndFills(
      {
        ...identity,
        as_of: "2026-11-24T15:01:00.000Z",
        evaluated_at: "2026-11-24T15:01:05.000Z",
        origin: "synthetic",
        source_class: "paper_broker",
        evidence_ref: "sa2:demo:d3-cleared",
        domains: {
          submissions: {
            domain_capability: "supported",
            as_of: "2026-11-24T15:01:00.000Z",
            source: "longbridge_paper_orders",
            scope: "account_submissions",
            cap: 512,
            completeness: "complete",
            truncated: false,
            records: [spec.terminal_resolution],
          },
          executions: {
            domain_capability: "supported",
            as_of: "2026-11-24T15:01:00.000Z",
            source: "longbridge_paper_fills",
            scope: "account_executions",
            cap: 512,
            completeness: "complete",
            truncated: false,
            records: [],
          },
          cutoff_open_orders: {
            domain_capability: "supported",
            as_of: "2026-11-24T15:01:00.000Z",
            source: "longbridge_paper_open",
            scope: "cutoff_open_orders",
            cap: 512,
            completeness: "complete",
            truncated: false,
            records: [],
          },
        },
      },
      { lockStore: clearedStore },
    );
    assert.ok(validateOrdersFillsSchema(afterTerminal));
    assert.equal(afterTerminal.summary.k_pend_usd, spec.expected.k_pend_after_terminal_with_complete_coverage);
    assert.equal(afterTerminal.summary.k_pend_release_allowed, true);
  },

  async "SA2-D4"() {
    const { evaluateAuthoritativeOrdersAndFills } = await import(
      "../web/strategy-switch-console/application/orders_fills/helpers.js"
    );
    const { deduplicateExecutions } = await import(
      "../web/strategy-switch-console/application/orders_fills/dedup_state.js"
    );
    const spec = demoFixture.cases["SA2-D4"];
    const paperRes = evaluateAuthoritativeOrdersAndFills(spec.paper_account);
    const liveRes = evaluateAuthoritativeOrdersAndFills(spec.live_account);
    assert.ok(validateOrdersFillsSchema(paperRes), ajv.errorsText(validateOrdersFillsSchema.errors));
    assert.ok(validateOrdersFillsSchema(liveRes), ajv.errorsText(validateOrdersFillsSchema.errors));
    assert.equal(paperRes.account_binding.binding_key, spec.expected.paper_binding_key);
    assert.equal(liveRes.account_binding.binding_key, spec.expected.live_binding_key);

    // Same execution_ref across (longbridge, paper) vs (longbridge, live) must NEVER collide or merge
    const combinedExecs = deduplicateExecutions(
      [...paperRes.executions, ...liveRes.executions],
      [],
    );
    assert.equal(combinedExecs.length, spec.expected.isolated_distinct_executions);
    assert.throws(() => evaluateAuthoritativeOrdersAndFills({
      ...spec.paper_account,
      ...spec.invalid_conflated_broker,
    }));
  },

  async "SA2-D5"() {
    const { evaluateAuthoritativeOrdersAndFills } = await import(
      "../web/strategy-switch-console/application/orders_fills/helpers.js"
    );
    const spec = demoFixture.cases["SA2-D5"];
    const res = evaluateAuthoritativeOrdersAndFills(spec.partial_fill_cancel_input);
    assert.ok(validateOrdersFillsSchema(res), ajv.errorsText(validateOrdersFillsSchema.errors));
    assert.equal(res.executions.length, spec.expected.executions_count);
    assert.equal(res.orders.length, 1);
    const ord = res.orders[0];
    assert.equal(ord.qty_submitted, spec.expected.qty_submitted);
    assert.equal(ord.qty_filled, spec.expected.qty_filled);
    assert.equal(ord.qty_canceled, spec.expected.qty_canceled);
    assert.equal(ord.qty_remaining, spec.expected.qty_remaining);
    assert.equal(ord.state, spec.expected.state);
    assert.equal(res.summary.k_pend_usd, spec.expected.k_pend_usd);
    assert.equal(res.summary.k_pend_release_allowed, spec.expected.k_pend_release_allowed);

    const conflictInput = structuredClone(spec.partial_fill_cancel_input);
    conflictInput.domains.executions.records.push(spec.conflicting_duplicate_execution);
    assert.throws(() => evaluateAuthoritativeOrdersAndFills(conflictInput), /conflicting_duplicate_execution/);
  },

  async "SA2-D6"() {
    const { evaluateDomainCoverage } = await import(
      "../web/strategy-switch-console/application/orders_fills/coverage.js"
    );
    const spec = demoFixture.cases["SA2-D6"];

    const trunc512 = evaluateDomainCoverage(spec.truncated_512_case);
    assert.equal(trunc512.empty_domain_proven, spec.expected.truncated_512_empty_proven);
    assert.equal(trunc512.k_pend_release_allowed, spec.expected.truncated_512_release_allowed);

    const incZero = evaluateDomainCoverage(spec.incomplete_zero_case);
    assert.equal(incZero.empty_domain_proven, spec.expected.incomplete_zero_empty_proven);
    assert.equal(incZero.k_pend_release_allowed, spec.expected.incomplete_zero_release_allowed);

    const empty512 = evaluateDomainCoverage(spec.proven_empty_512_case);
    assert.equal(empty512.empty_domain_proven, spec.expected.proven_empty_512_empty_proven);
    assert.equal(empty512.k_pend_release_allowed, spec.expected.proven_empty_512_release_allowed);

    const unsup = evaluateDomainCoverage(spec.unsupported_domain_case);
    assert.equal(unsup.domain_capability, spec.expected.unsupported_capability);
    assert.equal(unsup.count, spec.expected.unsupported_count);
    assert.equal(unsup.empty_domain_proven, spec.expected.unsupported_empty_proven);
    assert.equal(unsup.k_pend_release_allowed, spec.expected.unsupported_release_allowed);
  },

  async "SA2-D7"() {
    const { buildConsoleOrdersFillsReadModel } = await import(
      "../web/strategy-switch-console/application/console_api/executions.js"
    );
    const { evaluateAuthoritativeOrdersAndFills } = await import(
      "../web/strategy-switch-console/application/orders_fills/helpers.js"
    );
    const { evaluateDeployableCapitalSizing } = await import(
      "../web/strategy-switch-console/application/sizing_unit/deployable_capital.js"
    );
    let storageWrites = 0;
    let kvWrites = 0;
    const spyDeps = {
      kv: {
        async get() { return null; },
        async put() { kvWrites++; throw new Error("forbidden_kv_write_on_read"); },
        async delete() { kvWrites++; throw new Error("forbidden_kv_delete_on_read"); },
      },
      sql: {
        exec(query) {
          if (!/^\s*SELECT\b/i.test(String(query))) {
            storageWrites++;
            throw new Error("forbidden_sql_write_on_read");
          }
          return { toArray: () => [] };
        },
      },
    };
    const rm = buildConsoleOrdersFillsReadModel(demoFixture.cases["SA2-D4"].paper_account, spyDeps);
    assert.ok(validateOrdersFillsSchema(rm));
    const direct = evaluateAuthoritativeOrdersAndFills(demoFixture.cases["SA2-D5"].partial_fill_cancel_input);
    assert.ok(validateOrdersFillsSchema(direct));
    const sized = evaluateDeployableCapitalSizing(demoFixture.cases["SA2-D1"].zero_cash_case.input);
    assert.ok(validateDeployableCapitalSchema(sized));
    assert.equal(storageWrites, demoFixture.cases["SA2-D7"].expected.storage_writes);
    assert.equal(kvWrites, demoFixture.cases["SA2-D7"].expected.kv_writes);
  },
};

const ids = requestedCase ? [requestedCase] : Object.keys(handlers);
let failures = 0;
for (const id of ids) {
  const fn = handlers[id];
  if (!fn) {
    console.error(`[FAIL] ${id}: unknown demo case`);
    failures++;
    continue;
  }
  try {
    await fn();
    console.log(`[PASS] ${id}: ${demoFixture.cases[id].title}`);
  } catch (err) {
    failures++;
    console.error(`[FAIL] ${id}: ${err?.code || err?.name || "Error"}: ${err?.message || err}`);
  }
}
if (failures > 0) {
  console.error(`sa2_demo_validation: FAILED (${failures}/${ids.length} cases failed)`);
  process.exit(1);
}
console.log(`sa2_demo_validation: PASS (${ids.length}/${ids.length} cases passed)`);
