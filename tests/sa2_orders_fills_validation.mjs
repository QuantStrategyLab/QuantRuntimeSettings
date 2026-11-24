import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../web/strategy-switch-console/package.json", import.meta.url));
const Ajv2020 = require("ajv/dist/2020").default;
const addFormats = require("ajv-formats");

const loadJson = (relPath) => JSON.parse(readFileSync(new URL(relPath, import.meta.url), "utf8"));

const ordersFillsSchema = loadJson("../schemas/qsl-authoritative-orders-fills.v1.schema.json");
const matrix = loadJson("./fixtures/sa2/sa2_orders_fills_matrix.json");

const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false });
addFormats(ajv);
const validateSchema = ajv.compile(ordersFillsSchema);

const PRIVATE_LOCATOR_RE = new RegExp(
  "(?:source_ref|kv_key|do_key|kv://|do://|/" + "Users/|/" + "home/|broker_account_hash|broker_account_id)",
);

const {
  ALLOWED_ORDER_BROKERS,
  ALLOWED_ORDER_ENVIRONMENTS,
  ORDER_DOMAIN_CAPS,
  ORDER_LIFECYCLE_STATES,
} = await import("../web/strategy-switch-console/application/orders_fills/constants.js");
const { evaluateDomainCoverage } = await import(
  "../web/strategy-switch-console/application/orders_fills/coverage.js"
);
const { adaptLegacyBrokerExecutionPayload, normalizeBrokerIdentity } = await import(
  "../web/strategy-switch-console/application/orders_fills/normalize.js"
);
const { deduplicateExecutions } = await import(
  "../web/strategy-switch-console/application/orders_fills/dedup_state.js"
);
const {
  applyOrderUnknownObservation,
  checkSymbolOrderAllowed,
  createOrderUnknownLockStore,
  deserializeOrderUnknownLockStore,
  lockedSymbolsForAccount,
  serializeOrderUnknownLockStore,
} = await import("../web/strategy-switch-console/application/orders_fills/order_unknown_lock.js");
const { evaluateAuthoritativeOrdersAndFills } = await import(
  "../web/strategy-switch-console/application/orders_fills/helpers.js"
);

// 0. Leaf boundary checks (constants.js zero imports; zero Worker/runtime_support/storage/network imports).
const stripJsComments = (src) => src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
for (const modName of [
  "constants.js",
  "coverage.js",
  "normalize.js",
  "dedup_state.js",
  "order_unknown_lock.js",
  "helpers.js",
]) {
  const code = stripJsComments(
    readFileSync(new URL(`../web/strategy-switch-console/application/orders_fills/${modName}`, import.meta.url), "utf8"),
  );
  if (modName === "constants.js") {
    assert.equal(/\bimport\b|\brequire\s*\(/.test(code), false, "orders_fills/constants.js must have zero imports");
  }
  assert.equal(/runtime_support|worker\.js|\bfetch\s*\(/.test(code), false, `${modName} violates leaf boundary`);
}

assert.deepEqual(ALLOWED_ORDER_BROKERS, ["schwab", "firstrade", "ibkr", "longbridge", "binance"]);
assert.deepEqual(ALLOWED_ORDER_ENVIRONMENTS, ["live", "paper"]);
assert.deepEqual(ORDER_DOMAIN_CAPS, [256, 512, 2048]);
assert.ok(ORDER_LIFECYCLE_STATES.includes("PARTIAL_CANCEL"));
assert.ok(ORDER_LIFECYCLE_STATES.includes("ORDER_UNKNOWN"));

// 1. Multi-broker & environment separation across all 5 canonical brokers + invalid identity rejections
{
  const seenKeys = new Set();
  for (const acct of matrix.cases.multi_broker_separation.accounts) {
    const id = normalizeBrokerIdentity(acct);
    assert.equal(id.broker, acct.broker);
    assert.equal(id.environment, acct.environment);
    assert.equal(id.account, acct.account);
    assert.equal(seenKeys.has(id.binding_key), false);
    seenKeys.add(id.binding_key);

    const res = evaluateAuthoritativeOrdersAndFills({
      broker: acct.broker,
      environment: acct.environment,
      account: acct.account,
      as_of: "2026-11-24T15:00:00.000Z",
      evaluated_at: "2026-11-24T15:00:05.000Z",
      origin: "synthetic",
      source_class: acct.source_class,
      evidence_ref: `sa2:a12:${acct.broker}:${acct.environment}`,
      domains: {
        submissions: {
          domain_capability: "supported",
          as_of: "2026-11-24T15:00:00.000Z",
          source: `${acct.broker}_${acct.environment}_orders`,
          scope: "account_submissions",
          cap: 512,
          completeness: "complete",
          truncated: false,
          records: [
            {
              client_order_id: "ord-shared-cross-venue",
              broker_order_id: `brk-${acct.broker}-${acct.environment}`,
              symbol: acct.symbol,
              side: "BUY",
              state: "FILLED",
              qty_submitted: "1",
              limit_price: acct.price,
              currency: "USD",
              fee_native: null,
              fee_currency: null,
              submitted_at: "2026-11-24T14:50:00.000Z",
              evidence_ref: `sa2:a12:sub:${acct.broker}`,
            },
          ],
        },
        executions: {
          domain_capability: "supported",
          as_of: "2026-11-24T15:00:00.000Z",
          source: `${acct.broker}_${acct.environment}_fills`,
          scope: "account_executions",
          cap: 2048,
          completeness: "complete",
          truncated: false,
          records: [
            {
              execution_ref: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
              report_ref: "1111111111111111111111111111111111111111111111111111111111111111",
              client_order_id: "ord-shared-cross-venue",
              broker_order_id: `brk-${acct.broker}-${acct.environment}`,
              symbol: acct.symbol,
              side: "BUY",
              qty: "1",
              price: acct.price,
              currency: "USD",
              fee_native: null,
              fee_currency: null,
              executed_at: "2026-11-24T14:51:00.000Z",
              evidence_ref: `sa2:a12:exec:${acct.broker}`,
            },
          ],
        },
        cutoff_open_orders: {
          domain_capability: "supported",
          as_of: "2026-11-24T15:00:00.000Z",
          source: `${acct.broker}_${acct.environment}_open`,
          scope: "cutoff_open_orders",
          cap: 256,
          completeness: "complete",
          truncated: false,
          records: [],
        },
      },
    });
    assert.ok(validateSchema(res), `${acct.broker}/${acct.environment}: ${ajv.errorsText(validateSchema.errors)}`);
    assert.equal(PRIVATE_LOCATOR_RE.test(JSON.stringify(res)), false);
  }
  assert.equal(seenKeys.size, matrix.cases.multi_broker_separation.accounts.length);

  for (const bad of matrix.cases.multi_broker_separation.invalid_inputs) {
    assert.throws(() => normalizeBrokerIdentity(bad), `${bad.name} must throw`);
  }
}

// 2. Identical + supplemental dedup vs conflicting duplicates
{
  const spec = matrix.cases.dedup_and_lifecycle.identical_and_supplemental_dedup;
  const res = evaluateAuthoritativeOrdersAndFills({
    broker: spec.broker,
    environment: spec.environment,
    account: spec.account,
    as_of: "2026-11-24T15:00:00.000Z",
    evaluated_at: "2026-11-24T15:00:05.000Z",
    origin: "synthetic",
    source_class: "paper_broker",
    evidence_ref: "sa2:a12:dedup-lifecycle",
    domains: {
      submissions: {
        domain_capability: "supported",
        as_of: "2026-11-24T15:00:00.000Z",
        source: "longbridge_paper_orders",
        scope: "account_submissions",
        cap: 512,
        completeness: "complete",
        truncated: false,
        records: spec.submissions,
      },
      executions: {
        domain_capability: "supported",
        as_of: "2026-11-24T15:00:00.000Z",
        source: "longbridge_paper_fills",
        scope: "account_executions",
        cap: 512,
        completeness: "complete",
        truncated: false,
        records: spec.executions,
      },
      cutoff_open_orders: {
        domain_capability: "supported",
        as_of: "2026-11-24T15:00:00.000Z",
        source: "longbridge_paper_open",
        scope: "cutoff_open_orders",
        cap: 512,
        completeness: "complete",
        truncated: false,
        records: spec.cutoff_open_orders,
      },
    },
  });
  assert.ok(validateSchema(res), ajv.errorsText(validateSchema.errors));
  assert.equal(res.executions.length, spec.expected.executions_count);
  assert.equal(res.executions[0].fee_usd, spec.expected.fee_usd);
  assert.equal(res.orders[0].qty_submitted, spec.expected.qty_submitted);
  assert.equal(res.orders[0].qty_filled, spec.expected.qty_filled);
  assert.equal(res.orders[0].qty_remaining, spec.expected.qty_remaining);
  assert.equal(res.summary.k_pend_usd, spec.expected.k_pend_usd);

  for (const conflict of matrix.cases.dedup_and_lifecycle.conflicting_execution_cases) {
    const base = {
      broker: spec.broker,
      environment: spec.environment,
      account: spec.account,
      ...spec.executions[1],
    };
    const bad = { ...base, ...conflict.patch };
    assert.throws(() => deduplicateExecutions([bad], [base]), /conflicting_duplicate_execution/, conflict.name);
  }
}

// 3. Pre-ack vs post-ack ORDER-UNKNOWN locks & restart persistence
{
  const spec = matrix.cases.order_unknown_recovery;
  let store = createOrderUnknownLockStore();
  store = applyOrderUnknownObservation(store, spec.pre_ack_timeout);
  store = applyOrderUnknownObservation(store, spec.post_ack_timeout);
  const reloaded = deserializeOrderUnknownLockStore(JSON.parse(JSON.stringify(serializeOrderUnknownLockStore(store))));

  const preCheck = checkSymbolOrderAllowed(reloaded, {
    broker: spec.pre_ack_timeout.broker,
    environment: spec.pre_ack_timeout.environment,
    account: spec.pre_ack_timeout.account,
    symbol: "TQQQ",
  });
  assert.equal(preCheck.allowed, false);
  assert.equal(preCheck.query_target.by, spec.expected.pre_ack_query_by);
  assert.equal(preCheck.lock.k_pend_usd, spec.expected.pre_ack_k_pend_usd);

  const postCheck = checkSymbolOrderAllowed(reloaded, {
    broker: spec.post_ack_timeout.broker,
    environment: spec.post_ack_timeout.environment,
    account: spec.post_ack_timeout.account,
    symbol: "SOXL",
  });
  assert.equal(postCheck.allowed, false);
  assert.equal(postCheck.query_target.by, spec.expected.post_ack_query_by);
  assert.equal(postCheck.query_target.broker_order_id, spec.post_ack_timeout.broker_order_id);
  assert.equal(postCheck.lock.k_pend_usd, spec.expected.post_ack_k_pend_usd);

  // Cross-environment isolation: lock on (longbridge, paper) does NOT lock (longbridge, live)
  const liveCrossCheck = checkSymbolOrderAllowed(reloaded, {
    broker: "longbridge",
    environment: "live",
    account: "longbridge:live:sg",
    symbol: "TQQQ",
  });
  assert.equal(liveCrossCheck.allowed, true);
  assert.deepEqual(
    lockedSymbolsForAccount(reloaded, {
      broker: "longbridge",
      environment: "paper",
      account: "longbridge:paper:pilot",
    }),
    ["TQQQ"],
  );
}

// 4. Caps (256 / 512 / 2048), incomplete coverage, unsupported domains, K_pend non-release
{
  for (const row of matrix.cases.caps_and_completeness_matrix) {
    const cov = evaluateDomainCoverage({
      domain: "cutoff_open_orders",
      domain_capability: row.domain_capability,
      as_of: row.domain_capability === "supported" ? "2026-11-24T15:00:00.000Z" : null,
      source: row.name,
      scope: "cutoff_open_orders",
      cap: row.cap,
      count: row.count,
      truncated: row.truncated,
      completeness: row.completeness,
    });
    assert.equal(cov.empty_domain_proven, row.expected.empty_domain_proven, `${row.name}.empty_domain_proven`);
    assert.equal(cov.k_pend_release_allowed, row.expected.k_pend_release_allowed, `${row.name}.k_pend_release_allowed`);
    if (row.expected.count !== undefined) {
      assert.equal(cov.count, row.expected.count, `${row.name}.count`);
    }

    const full = evaluateAuthoritativeOrdersAndFills(
      {
        broker: "longbridge",
        environment: "paper",
        account: "longbridge:paper:pilot",
        as_of: "2026-11-24T15:00:00.000Z",
        evaluated_at: "2026-11-24T15:00:05.000Z",
        origin: "synthetic",
        source_class: "paper_broker",
        evidence_ref: `sa2:a12:${row.name}`,
        domains: {
          submissions: { domain_capability: "unsupported", as_of: null, source: "omitted", scope: "account_submissions" },
          executions: { domain_capability: "unsupported", as_of: null, source: "omitted", scope: "account_executions" },
          cutoff_open_orders: {
            domain_capability: row.domain_capability,
            as_of: row.domain_capability === "supported" ? "2026-11-24T15:00:00.000Z" : null,
            source: row.name,
            scope: "cutoff_open_orders",
            cap: row.cap,
            count: row.count,
            truncated: row.truncated,
            completeness: row.completeness,
          },
        },
      },
      { priorKPendUsd: row.prior_k_pend_usd },
    );
    assert.ok(validateSchema(full), `${row.name} schema: ${ajv.errorsText(validateSchema.errors)}`);
    assert.equal(full.summary.k_pend_usd, row.expected.k_pend_usd, `${row.name}.summary.k_pend_usd`);
    assert.equal(full.summary.k_pend_release_allowed, row.expected.k_pend_release_allowed, `${row.name}.summary.k_pend_release_allowed`);
  }

  assert.throws(() =>
    evaluateDomainCoverage({
      domain: "cutoff_open_orders",
      domain_capability: "supported",
      as_of: "2026-11-24T15:00:00.000Z",
      source: "bad_cap",
      scope: "cutoff_open_orders",
      cap: 1000,
      count: 0,
      truncated: false,
      completeness: "complete",
    }),
  );
}

// 5. Null fees, non-USD unavailability, and legacy broker_executions.v1 pure adapter
{
  const spec = matrix.cases.null_fee_and_non_usd_cases;
  const nullFeeRes = evaluateAuthoritativeOrdersAndFills({
    broker: spec.null_fee_usd_execution.broker,
    environment: spec.null_fee_usd_execution.environment,
    account: spec.null_fee_usd_execution.account,
    as_of: "2026-11-24T15:00:00.000Z",
    evaluated_at: "2026-11-24T15:00:05.000Z",
    origin: "synthetic",
    source_class: "paper_broker",
    evidence_ref: "sa2:a12:null-fee-check",
    domains: {
      submissions: { domain_capability: "unsupported", as_of: null, source: "omitted", scope: "account_submissions" },
      executions: {
        domain_capability: "supported",
        as_of: "2026-11-24T15:00:00.000Z",
        source: "longbridge_paper_fills",
        scope: "account_executions",
        cap: 512,
        completeness: "complete",
        truncated: false,
        records: [spec.null_fee_usd_execution],
      },
      cutoff_open_orders: { domain_capability: "unsupported", as_of: null, source: "omitted", scope: "cutoff_open_orders" },
    },
  });
  assert.ok(validateSchema(nullFeeRes));
  assert.equal(nullFeeRes.executions[0].fee_native, null);
  assert.equal(nullFeeRes.executions[0].fee_usd, null);
  assert.equal(nullFeeRes.executions[0].notional_usd, "250.00");

  const hkdRes = evaluateAuthoritativeOrdersAndFills({
    broker: spec.non_usd_hkd_execution.broker,
    environment: spec.non_usd_hkd_execution.environment,
    account: spec.non_usd_hkd_execution.account,
    as_of: "2026-11-24T15:00:00.000Z",
    evaluated_at: "2026-11-24T15:00:05.000Z",
    origin: "synthetic",
    source_class: "authorized_live_broker",
    evidence_ref: "sa2:a12:hkd-check",
    domains: {
      submissions: { domain_capability: "unsupported", as_of: null, source: "omitted", scope: "account_submissions" },
      executions: {
        domain_capability: "supported",
        as_of: "2026-11-24T15:00:00.000Z",
        source: "longbridge_live_fills",
        scope: "account_executions",
        cap: 512,
        completeness: "complete",
        truncated: false,
        records: [spec.non_usd_hkd_execution],
      },
      cutoff_open_orders: { domain_capability: "unsupported", as_of: null, source: "omitted", scope: "cutoff_open_orders" },
    },
  });
  assert.ok(validateSchema(hkdRes));
  assert.equal(hkdRes.executions[0].currency, "HKD");
  assert.equal(hkdRes.executions[0].notional_usd, null);
  assert.equal(hkdRes.executions[0].fee_usd, null);
  assert.equal(hkdRes.summary.fx_inferred, false);

  const adapted = adaptLegacyBrokerExecutionPayload(spec.legacy_ibkr_flex_payload, {
    broker: "ibkr",
    environment: "live",
    account: "ibkr:live:a1",
    evidence_ref: "sa2:a12:legacy-ibkr-adapter",
  });
  const adaptedEval = evaluateAuthoritativeOrdersAndFills(adapted);
  assert.ok(validateSchema(adaptedEval), ajv.errorsText(validateSchema.errors));
  assert.equal(adaptedEval.domains.executions.completeness, "incomplete");
  assert.equal(adaptedEval.domains.executions.k_pend_release_allowed, false);
  assert.equal(adaptedEval.executions[0].fee_native, "-0.123456789000000001");
  assert.equal(adaptedEval.executions[0].fee_currency, "EUR");
  assert.equal(adaptedEval.executions[0].fee_usd, null);
  assert.equal(PRIVATE_LOCATOR_RE.test(JSON.stringify(adaptedEval)), false);
}

console.log("sa2_orders_fills_validation: PASS (SA-A12)");
