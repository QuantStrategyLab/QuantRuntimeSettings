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
const { deduplicateExecutions, reconcileOrdersAndFills } = await import(
  "../web/strategy-switch-console/application/orders_fills/dedup_state.js"
);
const {
  applyOrderUnknownObservation,
  checkSymbolOrderAllowed,
  createOrderUnknownLockStore,
  deserializeOrderUnknownLockStore,
  listActiveOrderUnknownLocks,
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

  // Dynamic raw account ID & private locator negative controls (kept out of static JSON fixtures).
  const dynamicBadAccounts = [
    { name: "raw_u_account_rejected", broker: "ibkr", environment: "live", account: "U" + "1234567" },
    { name: "raw_du_account_rejected", broker: "ibkr", environment: "paper", account: "DU" + "987654" },
    { name: "raw_6digit_account_rejected", broker: "schwab", environment: "live", account: "1234" + "5678" },
    { name: "raw_split_digits_rejected", broker: "schwab", environment: "live", account: ["12", "34", "56"].join("-") },
    { name: "private_kv_locator_rejected", broker: "ibkr", environment: "live", account: "kv:" + "//ibkr/live/a1" },
  ];
  for (const bad of dynamicBadAccounts) {
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

  const legacyWithSelector = {
    ...spec.legacy_ibkr_flex_payload,
    account_selector: "U" + "100001",
  };
  const adapted = adaptLegacyBrokerExecutionPayload(legacyWithSelector, {
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
  assert.equal(adaptedEval.summary.k_pend_usd, null);
  assert.equal(PRIVATE_LOCATOR_RE.test(JSON.stringify(adaptedEval)), false);
  assert.equal(JSON.stringify(adaptedEval).includes("U" + "100001"), false);
}

// 6. P1 regression guards for C-SA-25 (#1-#7, #9b, #14)
{
  // #1a: First read of unsupported / incomplete / truncated open orders must NEVER release K_pend = "0".
  for (const badDomain of [
    { domain_capability: "unsupported", as_of: null, source: "omitted", scope: "cutoff_open_orders" },
    { domain_capability: "supported", as_of: "2026-11-24T15:00:00.000Z", source: "lb_open", scope: "cutoff_open_orders", cap: 256, count: 0, truncated: false, completeness: "incomplete", records: [] },
    { domain_capability: "supported", as_of: "2026-11-24T15:00:00.000Z", source: "lb_open", scope: "cutoff_open_orders", cap: 256, count: 256, truncated: true, completeness: "incomplete" },
  ]) {
    const res = evaluateAuthoritativeOrdersAndFills({
      broker: "longbridge",
      environment: "paper",
      account: "longbridge:paper:pilot",
      as_of: "2026-11-24T15:00:00.000Z",
      evaluated_at: "2026-11-24T15:00:05.000Z",
      origin: "synthetic",
      source_class: "paper_broker",
      evidence_ref: "sa2:p1:first-read-incomplete",
      domains: {
        submissions: { domain_capability: "unsupported", as_of: null, source: "omitted", scope: "account_submissions" },
        executions: { domain_capability: "unsupported", as_of: null, source: "omitted", scope: "account_executions" },
        cutoff_open_orders: badDomain,
      },
    });
    assert.ok(validateSchema(res), ajv.errorsText(validateSchema.errors));
    assert.equal(res.summary.k_pend_release_allowed, false);
    assert.equal(res.summary.k_pend_usd, null);
  }

  // #1b: Non-overlapping new submission alongside unreleased priorKPendUsd is additive, never dropped by max().
  const withPriorAndNewSub = evaluateAuthoritativeOrdersAndFills(
    {
      broker: "longbridge",
      environment: "paper",
      account: "longbridge:paper:pilot",
      as_of: "2026-11-24T15:00:00.000Z",
      evaluated_at: "2026-11-24T15:00:05.000Z",
      origin: "synthetic",
      source_class: "paper_broker",
      evidence_ref: "sa2:p1:prior-plus-new",
      domains: {
        submissions: {
          domain_capability: "supported",
          as_of: "2026-11-24T15:00:00.000Z",
          source: "lb_orders",
          scope: "account_submissions",
          cap: 512,
          completeness: "complete",
          truncated: false,
          records: [
            {
              client_order_id: "ord-new-1",
              broker_order_id: null,
              symbol: "TQQQ",
              side: "BUY",
              state: "SUBMITTED",
              qty_submitted: "8",
              limit_price: "50.00",
              currency: "USD",
              estimated_fee_usd: "1.25",
              submitted_at: "2026-11-24T14:58:00.000Z",
              evidence_ref: "sa2:p1:new-sub",
            },
          ],
        },
        executions: { domain_capability: "unsupported", as_of: null, source: "omitted", scope: "account_executions" },
        cutoff_open_orders: { domain_capability: "unsupported", as_of: null, source: "omitted", scope: "cutoff_open_orders" },
      },
    },
    { priorKPendUsd: "1000.00" },
  );
  assert.ok(validateSchema(withPriorAndNewSub), ajv.errorsText(validateSchema.errors));
  assert.equal(withPriorAndNewSub.summary.k_pend_usd, "1401.25");
  assert.equal(withPriorAndNewSub.summary.k_pend_release_allowed, false);

  // Overlapping prior order ID deduplicated against priorKPendUsd while adding non-overlapping new order.
  const overlapDeduped = evaluateAuthoritativeOrdersAndFills(
    {
      broker: "longbridge",
      environment: "paper",
      account: "longbridge:paper:pilot",
      as_of: "2026-11-24T15:00:00.000Z",
      evaluated_at: "2026-11-24T15:00:05.000Z",
      origin: "synthetic",
      source_class: "paper_broker",
      evidence_ref: "sa2:p1:prior-overlap",
      domains: {
        submissions: {
          domain_capability: "supported",
          as_of: "2026-11-24T15:00:00.000Z",
          source: "lb_orders",
          scope: "account_submissions",
          cap: 512,
          completeness: "complete",
          truncated: false,
          records: [
            {
              client_order_id: "ord-old-1",
              broker_order_id: "brk-old-1",
              symbol: "SOXL",
              side: "BUY",
              state: "ACCEPTED",
              qty_submitted: "10",
              limit_price: "40.00",
              currency: "USD",
              estimated_fee_usd: "0",
              submitted_at: "2026-11-24T14:30:00.000Z",
              evidence_ref: "sa2:p1:old-sub",
            },
            {
              client_order_id: "ord-new-2",
              broker_order_id: "brk-new-2",
              symbol: "TQQQ",
              side: "BUY",
              state: "SUBMITTED",
              qty_submitted: "6",
              limit_price: "50.00",
              currency: "USD",
              estimated_fee_usd: "0",
              submitted_at: "2026-11-24T14:59:00.000Z",
              evidence_ref: "sa2:p1:new-sub-2",
            },
          ],
        },
        executions: { domain_capability: "unsupported", as_of: null, source: "omitted", scope: "account_executions" },
        cutoff_open_orders: {
          domain_capability: "supported",
          as_of: "2026-11-24T15:00:00.000Z",
          source: "lb_open",
          scope: "cutoff_open_orders",
          cap: 512,
          count: 1,
          truncated: false,
          completeness: "incomplete",
          records: [
            {
              client_order_id: "ord-old-1",
              broker_order_id: "brk-old-1",
              symbol: "SOXL",
              side: "BUY",
              state: "ACCEPTED",
              qty_submitted: "10",
              qty_filled: "0",
              qty_canceled: "0",
              qty_remaining: "10",
              limit_price: "40.00",
              currency: "USD",
              reserved_fee_usd: "0",
              as_of: "2026-11-24T15:00:00.000Z",
              evidence_ref: "sa2:p1:old-open",
            },
          ],
        },
      },
    },
    { priorKPendUsd: "1000.00", priorKPendOrderIds: ["ord-old-1"] },
  );
  assert.ok(validateSchema(overlapDeduped));
  assert.equal(overlapDeduped.summary.k_pend_usd, "1300.00");

  // #2: Coverage count=1, records=[], completeness="complete" fails closed as incomplete;
  // records.length > cap (257>256, 513>512, 2049>2048) rejects regardless of truncated flag.
  const mismatchCov = evaluateDomainCoverage({
    domain: "cutoff_open_orders",
    domain_capability: "supported",
    as_of: "2026-11-24T15:00:00.000Z",
    source: "lb_open",
    scope: "cutoff_open_orders",
    cap: 512,
    count: 1,
    truncated: false,
    completeness: "complete",
    records: [],
  });
  assert.equal(mismatchCov.completeness, "incomplete");
  assert.equal(mismatchCov.empty_domain_proven, false);
  assert.equal(mismatchCov.k_pend_release_allowed, false);

  for (const capVal of [256, 512, 2048]) {
    for (const truncFlag of [false, true]) {
      assert.throws(
        () => evaluateDomainCoverage({
          domain: "cutoff_open_orders",
          domain_capability: "supported",
          as_of: "2026-11-24T15:00:00.000Z",
          source: "cap_overflow",
          scope: "cutoff_open_orders",
          cap: capVal,
          count: capVal + 1,
          truncated: truncFlag,
          completeness: "incomplete",
          records: Array.from({ length: capVal + 1 }, (_, idx) => ({ id: idx })),
        }),
        /domain_records_exceed_cap/,
      );
    }
  }

  // #3a: Same-batch ORDER_UNKNOWN -> ACCEPTED cannot erase ORDER_UNKNOWN lock.
  const sameBatchDowngradeAttempt = evaluateAuthoritativeOrdersAndFills({
    broker: "longbridge",
    environment: "paper",
    account: "longbridge:paper:pilot",
    as_of: "2026-11-24T15:00:00.000Z",
    evaluated_at: "2026-11-24T15:00:05.000Z",
    origin: "synthetic",
    source_class: "paper_broker",
    evidence_ref: "sa2:p1:inbatch-order-unknown",
    domains: {
      submissions: {
        domain_capability: "supported",
        as_of: "2026-11-24T15:00:00.000Z",
        source: "lb_orders",
        scope: "account_submissions",
        cap: 512,
        completeness: "complete",
        truncated: false,
        records: [
          {
            client_order_id: "ord-race-1",
            broker_order_id: null,
            symbol: "TQQQ",
            side: "BUY",
            state: "ORDER_UNKNOWN",
            qty_submitted: "5",
            limit_price: "50.00",
            currency: "USD",
            estimated_fee_usd: "1.00",
            submitted_at: "2026-11-24T14:55:00.000Z",
            evidence_ref: "sa2:p1:race-1",
          },
          {
            client_order_id: "ord-race-1",
            broker_order_id: "brk-race-1",
            symbol: "TQQQ",
            side: "BUY",
            state: "ACCEPTED",
            qty_submitted: "5",
            limit_price: "50.00",
            currency: "USD",
            estimated_fee_usd: "1.00",
            submitted_at: "2026-11-24T14:56:00.000Z",
            evidence_ref: "sa2:p1:race-2",
          },
        ],
      },
      executions: { domain_capability: "unsupported", as_of: null, source: "omitted", scope: "account_executions" },
      cutoff_open_orders: { domain_capability: "unsupported", as_of: null, source: "omitted", scope: "cutoff_open_orders" },
    },
  });
  assert.ok(validateSchema(sameBatchDowngradeAttempt));
  assert.equal(sameBatchDowngradeAttempt.orders[0].state, "ORDER_UNKNOWN");
  assert.deepEqual(sameBatchDowngradeAttempt.order_unknown_symbols, ["TQQQ"]);
  assert.equal(sameBatchDowngradeAttempt.summary.k_pend_release_allowed, false);

  // #3b + #4: Reloaded lock key normalized across canonical/short account forms AND cannot unlock via wrong symbol.
  let symLockStore = createOrderUnknownLockStore();
  symLockStore = applyOrderUnknownObservation(symLockStore, {
    broker: "longbridge",
    environment: "paper",
    account: "longbridge:paper:pilot",
    client_order_id: "ord-lock-sym",
    broker_order_id: null,
    symbol: "TQQQ",
    side: "BUY",
    state: "ORDER_UNKNOWN",
    qty_submitted: "10",
    limit_price: "50.00",
    currency: "USD",
    estimated_fee_usd: "1.25",
    submitted_at: "2026-11-24T14:55:00.000Z",
  });
  const symLockReloaded = deserializeOrderUnknownLockStore(JSON.parse(JSON.stringify(serializeOrderUnknownLockStore(symLockStore))));
  assert.equal(
    checkSymbolOrderAllowed(symLockReloaded, {
      broker: "longbridge",
      environment: "paper",
      account: "pilot",
      symbol: "TQQQ",
    }).allowed,
    false,
  );
  assert.throws(
    () => evaluateAuthoritativeOrdersAndFills(
      {
        broker: "longbridge",
        environment: "paper",
        account: "pilot",
        as_of: "2026-11-24T15:00:00.000Z",
        evaluated_at: "2026-11-24T15:00:05.000Z",
        origin: "synthetic",
        source_class: "paper_broker",
        evidence_ref: "sa2:p1:wrong-symbol-clear",
        domains: {
          submissions: {
            domain_capability: "supported",
            as_of: "2026-11-24T15:00:00.000Z",
            source: "lb_orders",
            scope: "account_submissions",
            cap: 512,
            completeness: "complete",
            truncated: false,
            records: [
              {
                client_order_id: "ord-lock-sym",
                broker_order_id: null,
                symbol: "SOXL",
                side: "BUY",
                state: "CANCELED",
                qty_submitted: "10",
                limit_price: "50.00",
                currency: "USD",
                resolved_at: "2026-11-24T14:59:00.000Z",
                evidence_ref: "sa2:p1:wrong-symbol-cancel",
              },
            ],
          },
          executions: { domain_capability: "unsupported", as_of: null, source: "omitted", scope: "account_executions" },
          cutoff_open_orders: { domain_capability: "unsupported", as_of: null, source: "omitted", scope: "cutoff_open_orders" },
        },
      },
      { lockStore: symLockReloaded },
    ),
    /order_unknown_symbol_mismatch/,
  );

  // #3c: Future-dated CANCELED / fill (> evaluated_at) must NEVER release K_pend early or clear lock.
  const futureCancelRes = evaluateAuthoritativeOrdersAndFills({
    broker: "longbridge",
    environment: "paper",
    account: "longbridge:paper:pilot",
    as_of: "2026-11-24T15:00:00.000Z",
    evaluated_at: "2026-11-24T15:00:00.000Z",
    origin: "synthetic",
    source_class: "paper_broker",
    evidence_ref: "sa2:p1:future-cancel",
    domains: {
      submissions: {
        domain_capability: "supported",
        as_of: "2026-11-24T15:00:00.000Z",
        source: "lb_orders",
        scope: "account_submissions",
        cap: 512,
        completeness: "complete",
        truncated: false,
        records: [
          {
            client_order_id: "ord-future-cancel",
            broker_order_id: null,
            symbol: "TQQQ",
            side: "BUY",
            state: "CANCELED",
            qty_submitted: "10",
            limit_price: "50.00",
            currency: "USD",
            estimated_fee_usd: "1.25",
            submitted_at: "2026-11-24T14:50:00.000Z",
            resolved_at: "2026-11-24T15:05:00.000Z",
            evidence_ref: "sa2:p1:future-cancel-sub",
          },
        ],
      },
      executions: { domain_capability: "unsupported", as_of: null, source: "omitted", scope: "account_executions" },
      cutoff_open_orders: {
        domain_capability: "supported",
        as_of: "2026-11-24T15:00:00.000Z",
        source: "lb_open",
        scope: "cutoff_open_orders",
        cap: 512,
        count: 0,
        truncated: false,
        completeness: "complete",
        records: [],
      },
    },
  });
  assert.ok(validateSchema(futureCancelRes));
  assert.equal(futureCancelRes.summary.k_pend_usd, "501.25");
  assert.equal(futureCancelRes.summary.k_pend_release_allowed, false);

  const lockAfterFutureCancel = applyOrderUnknownObservation(
    symLockReloaded,
    {
      broker: "longbridge",
      environment: "paper",
      account: "pilot",
      client_order_id: "ord-lock-sym",
      symbol: "TQQQ",
      state: "CANCELED",
      resolved_at: "2026-11-24T15:05:00.000Z",
    },
    { evaluatedAt: "2026-11-24T15:00:00.000Z" },
  );
  assert.deepEqual(
    lockedSymbolsForAccount(lockAfterFutureCancel, { broker: "longbridge", environment: "paper", account: "pilot" }),
    ["TQQQ"],
  );

  // #5: Duplicate broker_order_id collision across distinct client_order_id values fails closed.
  assert.throws(
    () => evaluateAuthoritativeOrdersAndFills({
      broker: "longbridge",
      environment: "paper",
      account: "longbridge:paper:pilot",
      as_of: "2026-11-24T15:00:00.000Z",
      evaluated_at: "2026-11-24T15:00:05.000Z",
      origin: "synthetic",
      source_class: "paper_broker",
      evidence_ref: "sa2:p1:broker-id-hijack",
      domains: {
        submissions: {
          domain_capability: "supported",
          as_of: "2026-11-24T15:00:00.000Z",
          source: "lb_orders",
          scope: "account_submissions",
          cap: 512,
          completeness: "complete",
          truncated: false,
          records: [
            {
              client_order_id: "ord-a",
              broker_order_id: "brk-shared",
              symbol: "TQQQ",
              side: "BUY",
              state: "SUBMITTED",
              qty_submitted: "5",
              limit_price: "50.00",
              currency: "USD",
              estimated_fee_usd: "1.00",
              submitted_at: "2026-11-24T14:50:00.000Z",
              evidence_ref: "sa2:p1:hijack-a",
            },
            {
              client_order_id: "ord-b",
              broker_order_id: "brk-shared",
              symbol: "SOXL",
              side: "BUY",
              state: "SUBMITTED",
              qty_submitted: "5",
              limit_price: "25.00",
              currency: "USD",
              estimated_fee_usd: "1.00",
              submitted_at: "2026-11-24T14:51:00.000Z",
              evidence_ref: "sa2:p1:hijack-b",
            },
          ],
        },
        executions: { domain_capability: "unsupported", as_of: null, source: "omitted", scope: "account_executions" },
        cutoff_open_orders: { domain_capability: "unsupported", as_of: null, source: "omitted", scope: "cutoff_open_orders" },
      },
    }),
    /conflicting_duplicate_broker_order_id/,
  );

  // #6a + #9b: IBKR Flex multi-report dedup across distinct observed_at timestamps + reject relabeling to longbridge/paper.
  const legacyFlexWithSelector = {
    ...matrix.cases.null_fee_and_non_usd_cases.legacy_ibkr_flex_payload,
    account_selector: "U" + "100001",
  };
  const flexReport1 = adaptLegacyBrokerExecutionPayload(
    { ...legacyFlexWithSelector, observed_at: "2026-10-23T16:00:00.000Z" },
    { broker: "ibkr", environment: "live", account: "ibkr:live:a1" },
  );
  const flexReport2 = adaptLegacyBrokerExecutionPayload(
    { ...legacyFlexWithSelector, observed_at: "2026-10-24T01:00:00.000Z" },
    { broker: "ibkr", environment: "live", account: "ibkr:live:a1" },
  );
  const mergedFlex = deduplicateExecutions(
    flexReport2.domains.executions.records,
    flexReport1.domains.executions.records,
  );
  assert.equal(mergedFlex.length, 1);
  const evalFlex1 = evaluateAuthoritativeOrdersAndFills(flexReport1);
  const evalFlex2 = evaluateAuthoritativeOrdersAndFills(flexReport2);
  assert.equal(deduplicateExecutions(evalFlex2.executions, evalFlex1.executions).length, 1);

  assert.throws(
    () => adaptLegacyBrokerExecutionPayload(legacyFlexWithSelector, {
      broker: "longbridge",
      environment: "paper",
      account: "longbridge:paper:pilot",
    }),
    /legacy_source_broker_mismatch/,
  );
  assert.throws(
    () => adaptLegacyBrokerExecutionPayload(legacyFlexWithSelector, {
      broker: "ibkr",
      environment: "paper",
      account: "ibkr:paper:a1",
    }),
    /legacy_source_environment_mismatch/,
  );

  // #6b: Conflicting non-USD notional_usd or usd_basis_qualified must fail closed.
  const hkdQ1 = {
    broker: "longbridge",
    environment: "live",
    account: "longbridge:live:hk",
    execution_ref: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    report_ref: "1111111111111111111111111111111111111111111111111111111111111111",
    client_order_id: null,
    broker_order_id: null,
    symbol: "2800.HK",
    side: "BUY",
    qty: "100",
    price: "20.00",
    currency: "HKD",
    notional_usd: "256.00",
    fee_native: null,
    fee_currency: null,
    fee_usd: null,
    usd_basis_qualified: true,
    executed_at: "2026-11-24T06:30:00.000Z",
    evidence_ref: "sa2:p1:hkd-1",
  };
  assert.throws(
    () => deduplicateExecutions([{ ...hkdQ1, notional_usd: "260.00" }], [hkdQ1]),
    /conflicting_duplicate_execution/,
  );
  assert.throws(
    () => deduplicateExecutions([{ ...hkdQ1, usd_basis_qualified: false, notional_usd: null }], [hkdQ1]),
    /conflicting_duplicate_execution/,
  );

  // #7: Non-USD ORDER_UNKNOWN never multiplies native price as USD, and missing estimated_fee_usd is never coerced to 0.
  let hkdLockStore = createOrderUnknownLockStore();
  hkdLockStore = applyOrderUnknownObservation(hkdLockStore, {
    broker: "longbridge",
    environment: "live",
    account: "longbridge:live:hk",
    client_order_id: "ord-hkd-lock",
    broker_order_id: null,
    symbol: "2800.HK",
    side: "BUY",
    state: "ORDER_UNKNOWN",
    qty_submitted: "500",
    limit_price: "20.10",
    currency: "HKD",
    usd_basis_qualified: true,
    submitted_at: "2026-11-24T06:30:00.000Z",
  });
  assert.equal(
    listActiveOrderUnknownLocks(hkdLockStore, { broker: "longbridge", environment: "live", account: "hk" })[0].k_pend_usd,
    null,
  );

  const missingEstFee = evaluateAuthoritativeOrdersAndFills({
    broker: "longbridge",
    environment: "paper",
    account: "longbridge:paper:pilot",
    as_of: "2026-11-24T15:00:00.000Z",
    evaluated_at: "2026-11-24T15:00:05.000Z",
    origin: "synthetic",
    source_class: "paper_broker",
    evidence_ref: "sa2:p1:missing-fee-kpend",
    domains: {
      submissions: { domain_capability: "unsupported", as_of: null, source: "omitted", scope: "account_submissions" },
      executions: { domain_capability: "unsupported", as_of: null, source: "omitted", scope: "account_executions" },
      cutoff_open_orders: {
        domain_capability: "supported",
        as_of: "2026-11-24T15:00:00.000Z",
        source: "lb_open",
        scope: "cutoff_open_orders",
        cap: 512,
        completeness: "complete",
        truncated: false,
        records: [
          {
            client_order_id: "ord-nofee-open",
            broker_order_id: "brk-nofee-open",
            symbol: "TQQQ",
            side: "BUY",
            state: "ACCEPTED",
            qty_submitted: "10",
            qty_filled: "0",
            qty_canceled: "0",
            qty_remaining: "10",
            limit_price: "50.00",
            currency: "USD",
            as_of: "2026-11-24T15:00:00.000Z",
            evidence_ref: "sa2:p1:nofee-open",
          },
        ],
      },
    },
  });
  assert.ok(validateSchema(missingEstFee));
  assert.equal(missingEstFee.orders[0].k_pend_usd, null);
  assert.equal(missingEstFee.summary.k_pend_usd, null);

  // #14: Schema rejects raw account IDs encoded as currency; coverage rejects raw currency in native_currency / records.
  const badCurPayload = structuredClone(missingEstFee);
  badCurPayload.orders[0].currency = "U" + "1234567";
  assert.equal(validateSchema(badCurPayload), false);
  assert.throws(
    () => evaluateDomainCoverage({
      domain: "executions",
      domain_capability: "supported",
      as_of: "2026-11-24T15:00:00.000Z",
      source: "lb_fills",
      scope: "account_executions",
      cap: 256,
      count: 0,
      truncated: false,
      completeness: "complete",
      native_currency: "DU" + "987654",
      records: [],
    }),
  );
}

// 7. Codex review regressions (#1 future empty cutoff domain, #2 post-cutoff executions, #4 count>0 omitted records)
{
  // Codex #1 (PRRT_kwDOSZeN-M67n_nW): empty complete cutoff snapshot with as_of > evaluated_at cannot release K_pend.
  const futureEmptyCutoffInput = {
    broker: "longbridge",
    environment: "paper",
    account: "longbridge:paper:pilot",
    as_of: "2026-11-24T15:02:00.000Z",
    evaluated_at: "2026-11-24T15:02:00.000Z",
    origin: "synthetic",
    source_class: "paper_broker",
    evidence_ref: "sa2:codex:future-empty-cutoff",
    domains: {
      submissions: { domain_capability: "unsupported", as_of: null, source: "omitted", scope: "account_submissions" },
      executions: { domain_capability: "unsupported", as_of: null, source: "omitted", scope: "account_executions" },
      cutoff_open_orders: {
        domain_capability: "supported",
        as_of: "2026-11-24T16:00:00.000Z",
        source: "lb_open",
        scope: "cutoff_open_orders",
        cap: 256,
        count: 0,
        truncated: false,
        completeness: "complete",
        records: [],
      },
    },
  };
  const futureWithPrior = evaluateAuthoritativeOrdersAndFills(futureEmptyCutoffInput, { priorKPendUsd: "1000.00" });
  assert.ok(validateSchema(futureWithPrior), ajv.errorsText(validateSchema.errors));
  assert.equal(futureWithPrior.summary.k_pend_release_allowed, false);
  assert.equal(futureWithPrior.summary.k_pend_usd, "1000.00");
  assert.equal(futureWithPrior.domains.cutoff_open_orders.empty_domain_proven, false);
  assert.equal(futureWithPrior.domains.cutoff_open_orders.k_pend_release_allowed, false);

  const futureNoPrior = evaluateAuthoritativeOrdersAndFills(futureEmptyCutoffInput);
  assert.ok(validateSchema(futureNoPrior));
  assert.equal(futureNoPrior.summary.k_pend_release_allowed, false);
  assert.equal(futureNoPrior.summary.k_pend_usd, null);

  const directFutureCutoff = reconcileOrdersAndFills({
    identity: { broker: "longbridge", environment: "paper", account: "longbridge:paper:pilot", binding_key: "longbridge|paper|longbridge:paper:pilot" },
    cutoffCoverage: { as_of: "2026-11-24T16:00:00.000Z", k_pend_release_allowed: true },
    priorKPendUsd: "1000.00",
    evaluatedAt: "2026-11-24T15:02:00.000Z",
  });
  assert.equal(directFutureCutoff.k_pend_release_allowed, false);
  assert.equal(directFutureCutoff.k_pend_usd, "1000.00");

  // Codex #2 (PRRT_kwDOSZeN-M67n_ne): executions after cutoff.as_of and <= evaluated_at advance remaining qty cleanly.
  const asyncCutoffWithFill = evaluateAuthoritativeOrdersAndFills({
    broker: "longbridge",
    environment: "paper",
    account: "longbridge:paper:pilot",
    as_of: "2026-11-24T15:02:00.000Z",
    evaluated_at: "2026-11-24T15:02:00.000Z",
    origin: "synthetic",
    source_class: "paper_broker",
    evidence_ref: "sa2:codex:async-cutoff-exec",
    domains: {
      submissions: {
        domain_capability: "supported",
        as_of: "2026-11-24T15:02:00.000Z",
        source: "lb_orders",
        scope: "account_submissions",
        cap: 512,
        completeness: "complete",
        truncated: false,
        records: [
          {
            client_order_id: "ord-async-1",
            broker_order_id: "brk-async-1",
            symbol: "TQQQ",
            side: "BUY",
            state: "ACCEPTED",
            qty_submitted: "10",
            limit_price: "50.00",
            currency: "USD",
            estimated_fee_usd: "1.25",
            submitted_at: "2026-11-24T14:59:00.000Z",
            evidence_ref: "sa2:codex:async-sub",
          },
        ],
      },
      executions: {
        domain_capability: "supported",
        as_of: "2026-11-24T15:02:00.000Z",
        source: "lb_fills",
        scope: "account_executions",
        cap: 512,
        completeness: "complete",
        truncated: false,
        records: [
          {
            execution_ref: "abababababababababababababababababababababababababababababababab",
            report_ref: "1111111111111111111111111111111111111111111111111111111111111111",
            client_order_id: "ord-async-1",
            broker_order_id: "brk-async-1",
            symbol: "TQQQ",
            side: "BUY",
            qty: "2",
            price: "49.50",
            currency: "USD",
            fee_native: "0.25",
            fee_currency: "USD",
            executed_at: "2026-11-24T15:01:00.000Z",
            evidence_ref: "sa2:codex:async-exec-1",
          },
        ],
      },
      cutoff_open_orders: {
        domain_capability: "supported",
        as_of: "2026-11-24T15:00:00.000Z",
        source: "lb_open",
        scope: "cutoff_open_orders",
        cap: 512,
        completeness: "complete",
        truncated: false,
        records: [
          {
            client_order_id: "ord-async-1",
            broker_order_id: "brk-async-1",
            symbol: "TQQQ",
            side: "BUY",
            state: "ACCEPTED",
            qty_submitted: "10",
            qty_filled: "0",
            qty_canceled: "0",
            qty_remaining: "10",
            limit_price: "50.00",
            currency: "USD",
            reserved_fee_usd: "1.25",
            as_of: "2026-11-24T15:00:00.000Z",
            evidence_ref: "sa2:codex:async-open",
          },
        ],
      },
    },
  });
  assert.ok(validateSchema(asyncCutoffWithFill), ajv.errorsText(validateSchema.errors));
  assert.equal(asyncCutoffWithFill.orders[0].qty_filled, "2");
  assert.equal(asyncCutoffWithFill.orders[0].qty_remaining, "8");
  assert.equal(asyncCutoffWithFill.orders[0].state, "PARTIAL_FILL");
  assert.equal(asyncCutoffWithFill.orders[0].k_pend_usd, "401.25");
  assert.equal(asyncCutoffWithFill.summary.k_pend_usd, "401.25");

  // Full fill after cutoff completes cleanly with zero remaining K_pend.
  const asyncFullFill = evaluateAuthoritativeOrdersAndFills({
    broker: "longbridge",
    environment: "paper",
    account: "longbridge:paper:pilot",
    as_of: "2026-11-24T15:02:00.000Z",
    evaluated_at: "2026-11-24T15:02:00.000Z",
    origin: "synthetic",
    source_class: "paper_broker",
    evidence_ref: "sa2:codex:async-full-fill",
    domains: {
      submissions: { domain_capability: "unsupported", as_of: null, source: "omitted", scope: "account_submissions" },
      executions: {
        domain_capability: "supported",
        as_of: "2026-11-24T15:02:00.000Z",
        source: "lb_fills",
        scope: "account_executions",
        cap: 512,
        completeness: "complete",
        truncated: false,
        records: [
          {
            execution_ref: "cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd",
            report_ref: "2222222222222222222222222222222222222222222222222222222222222222",
            client_order_id: "ord-async-2",
            broker_order_id: "brk-async-2",
            symbol: "TQQQ",
            side: "BUY",
            qty: "10",
            price: "50.00",
            currency: "USD",
            fee_native: "1.25",
            fee_currency: "USD",
            executed_at: "2026-11-24T15:01:00.000Z",
            evidence_ref: "sa2:codex:async-full-exec",
          },
        ],
      },
      cutoff_open_orders: {
        domain_capability: "supported",
        as_of: "2026-11-24T15:00:00.000Z",
        source: "lb_open",
        scope: "cutoff_open_orders",
        cap: 512,
        completeness: "complete",
        truncated: false,
        records: [
          {
            client_order_id: "ord-async-2",
            broker_order_id: "brk-async-2",
            symbol: "TQQQ",
            side: "BUY",
            state: "ACCEPTED",
            qty_submitted: "10",
            qty_filled: "0",
            qty_canceled: "0",
            qty_remaining: "10",
            limit_price: "50.00",
            currency: "USD",
            reserved_fee_usd: "1.25",
            as_of: "2026-11-24T15:00:00.000Z",
            evidence_ref: "sa2:codex:async-open-2",
          },
        ],
      },
    },
  });
  assert.ok(validateSchema(asyncFullFill));
  assert.equal(asyncFullFill.orders[0].state, "FILLED");
  assert.equal(asyncFullFill.orders[0].qty_remaining, "0");
  assert.equal(asyncFullFill.summary.k_pend_usd, "0");

  // Genuine pre-cutoff execution mismatch AT cutoff.as_of still rejects 409; post-cutoff overfill still rejects 400.
  assert.throws(
    () => evaluateAuthoritativeOrdersAndFills({
      broker: "longbridge",
      environment: "paper",
      account: "longbridge:paper:pilot",
      as_of: "2026-11-24T15:02:00.000Z",
      evaluated_at: "2026-11-24T15:02:00.000Z",
      origin: "synthetic",
      source_class: "paper_broker",
      evidence_ref: "sa2:codex:precutoff-mismatch",
      domains: {
        submissions: { domain_capability: "unsupported", as_of: null, source: "omitted", scope: "account_submissions" },
        executions: {
          domain_capability: "supported",
          as_of: "2026-11-24T15:02:00.000Z",
          source: "lb_fills",
          scope: "account_executions",
          cap: 512,
          completeness: "complete",
          truncated: false,
          records: [
            {
              execution_ref: "efefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefef",
              report_ref: "3333333333333333333333333333333333333333333333333333333333333333",
              client_order_id: "ord-pre-mismatch",
              broker_order_id: "brk-pre-mismatch",
              symbol: "TQQQ",
              side: "BUY",
              qty: "2",
              price: "50.00",
              currency: "USD",
              fee_native: "0",
              fee_currency: "USD",
              executed_at: "2026-11-24T14:59:00.000Z",
              evidence_ref: "sa2:codex:pre-exec",
            },
          ],
        },
        cutoff_open_orders: {
          domain_capability: "supported",
          as_of: "2026-11-24T15:00:00.000Z",
          source: "lb_open",
          scope: "cutoff_open_orders",
          cap: 512,
          completeness: "complete",
          truncated: false,
          records: [
            {
              client_order_id: "ord-pre-mismatch",
              broker_order_id: "brk-pre-mismatch",
              symbol: "TQQQ",
              side: "BUY",
              state: "ACCEPTED",
              qty_submitted: "10",
              qty_filled: "0",
              qty_canceled: "0",
              qty_remaining: "10",
              limit_price: "50.00",
              currency: "USD",
              reserved_fee_usd: "1.25",
              as_of: "2026-11-24T15:00:00.000Z",
              evidence_ref: "sa2:codex:pre-open",
            },
          ],
        },
      },
    }),
    /order_remaining_cutoff_mismatch/,
  );

  // Codex #4 (PRRT_kwDOSZeN-M67n_nv): positive count without records array cannot stay complete or release K_pend.
  const positiveCountNoRecordsCov = evaluateDomainCoverage({
    domain: "cutoff_open_orders",
    domain_capability: "supported",
    as_of: "2026-11-24T15:00:00.000Z",
    source: "lb_open",
    scope: "cutoff_open_orders",
    cap: 256,
    count: 1,
    truncated: false,
    completeness: "complete",
  });
  assert.equal(positiveCountNoRecordsCov.completeness, "incomplete");
  assert.equal(positiveCountNoRecordsCov.empty_domain_proven, false);
  assert.equal(positiveCountNoRecordsCov.k_pend_release_allowed, false);

  const positiveCountOmittedInput = {
    broker: "longbridge",
    environment: "paper",
    account: "longbridge:paper:pilot",
    as_of: "2026-11-24T15:00:00.000Z",
    evaluated_at: "2026-11-24T15:00:05.000Z",
    origin: "synthetic",
    source_class: "paper_broker",
    evidence_ref: "sa2:codex:count1-no-records",
    domains: {
      submissions: { domain_capability: "unsupported", as_of: null, source: "omitted", scope: "account_submissions" },
      executions: { domain_capability: "unsupported", as_of: null, source: "omitted", scope: "account_executions" },
      cutoff_open_orders: {
        domain_capability: "supported",
        as_of: "2026-11-24T15:00:00.000Z",
        source: "lb_open",
        scope: "cutoff_open_orders",
        cap: 256,
        count: 1,
        truncated: false,
        completeness: "complete",
      },
    },
  };
  const omittedWithPrior = evaluateAuthoritativeOrdersAndFills(positiveCountOmittedInput, { priorKPendUsd: "1000.00" });
  assert.ok(validateSchema(omittedWithPrior), ajv.errorsText(validateSchema.errors));
  assert.equal(omittedWithPrior.domains.cutoff_open_orders.completeness, "incomplete");
  assert.equal(omittedWithPrior.summary.k_pend_release_allowed, false);
  assert.equal(omittedWithPrior.summary.k_pend_usd, "1000.00");

  const omittedNoPrior = evaluateAuthoritativeOrdersAndFills(positiveCountOmittedInput);
  assert.ok(validateSchema(omittedNoPrior));
  assert.equal(omittedNoPrior.summary.k_pend_release_allowed, false);
  assert.equal(omittedNoPrior.summary.k_pend_usd, null);
}

// 8. Codex round-2 P2 regression guards (two-pass exec link, updated_at cancel, legacy TZ, mixed fee_usd)
{
  // P2 #1: Two-pass execution linking when submission & cutoff lack broker_order_id and earlier exec omits client_order_id.
  const twoPassInput = {
    broker: "longbridge",
    environment: "paper",
    account: "longbridge:paper:pilot",
    as_of: "2026-11-24T15:02:00.000Z",
    evaluated_at: "2026-11-24T15:02:00.000Z",
    origin: "synthetic",
    source_class: "paper_broker",
    evidence_ref: "sa2:codex-r2:p2-1-twopass",
    domains: {
      submissions: {
        domain_capability: "supported",
        as_of: "2026-11-24T15:02:00.000Z",
        source: "lb_subs",
        scope: "account_submissions",
        cap: 256,
        count: 1,
        truncated: false,
        completeness: "complete",
        records: [
          {
            client_order_id: "ord-twopass-1",
            broker_order_id: null,
            symbol: "AAPL",
            side: "BUY",
            state: "SUBMITTED",
            qty_submitted: "10",
            limit_price: "50",
            estimated_fee_usd: "0",
            currency: "USD",
            fee_native: null,
            fee_currency: null,
            fee_usd: null,
            submitted_at: "2026-11-24T14:55:00.000Z",
            evidence_ref: "sa2:codex-r2:sub1",
          },
        ],
      },
      executions: {
        domain_capability: "supported",
        as_of: "2026-11-24T15:02:00.000Z",
        source: "lb_execs",
        scope: "account_executions",
        cap: 512,
        count: 2,
        truncated: false,
        completeness: "complete",
        records: [
          {
            execution_ref: "exec-twopass-early",
            client_order_id: null,
            broker_order_id: "brk-twopass-1",
            symbol: "AAPL",
            side: "BUY",
            qty: "2",
            price: "50",
            currency: "USD",
            fee_native: "0",
            fee_currency: "USD",
            executed_at: "2026-11-24T14:58:00.000Z",
            evidence_ref: "sa2:codex-r2:ex-early",
          },
          {
            execution_ref: "exec-twopass-late",
            client_order_id: "ord-twopass-1",
            broker_order_id: "brk-twopass-1",
            symbol: "AAPL",
            side: "BUY",
            qty: "2",
            price: "50",
            currency: "USD",
            fee_native: "0",
            fee_currency: "USD",
            executed_at: "2026-11-24T15:00:00.000Z",
            evidence_ref: "sa2:codex-r2:ex-late",
          },
        ],
      },
      cutoff_open_orders: {
        domain_capability: "supported",
        as_of: "2026-11-24T14:56:00.000Z",
        source: "lb_open",
        scope: "cutoff_open_orders",
        cap: 256,
        count: 1,
        truncated: false,
        completeness: "complete",
        records: [
          {
            client_order_id: "ord-twopass-1",
            broker_order_id: null,
            symbol: "AAPL",
            side: "BUY",
            state: "ACCEPTED",
            qty_submitted: "10",
            qty_filled: "0",
            qty_canceled: "0",
            qty_remaining: "10",
            limit_price: "50",
            reserved_fee_usd: "0",
            currency: "USD",
            as_of: "2026-11-24T14:56:00.000Z",
            evidence_ref: "sa2:codex-r2:open1",
          },
        ],
      },
    },
  };
  const twoPassRes = evaluateAuthoritativeOrdersAndFills(twoPassInput);
  assert.ok(validateSchema(twoPassRes), ajv.errorsText(validateSchema.errors));
  assert.equal(twoPassRes.orders.length, 1);
  assert.equal(twoPassRes.orders[0].broker_order_id, "brk-twopass-1");
  assert.equal(twoPassRes.orders[0].qty_filled, "4");
  assert.equal(twoPassRes.orders[0].qty_remaining, "6");
  assert.equal(twoPassRes.orders[0].state, "PARTIAL_FILL");
  assert.equal(twoPassRes.orders[0].k_pend_usd, "300.00");
  assert.equal(twoPassRes.summary.k_pend_usd, "300.00");
  assert.equal(twoPassRes.summary.k_pend_release_allowed, true);

  // P2 #2: Post-cutoff terminal/cancel update identified via updated_at advances cutoff snapshot & releases K_pend.
  const updatedAtCancelRes = evaluateAuthoritativeOrdersAndFills({
    broker: "longbridge",
    environment: "paper",
    account: "longbridge:paper:pilot",
    as_of: "2026-11-24T15:02:00.000Z",
    evaluated_at: "2026-11-24T15:02:00.000Z",
    origin: "synthetic",
    source_class: "paper_broker",
    evidence_ref: "sa2:codex-r2:p2-2-updated-at",
    domains: {
      submissions: {
        domain_capability: "supported",
        as_of: "2026-11-24T15:02:00.000Z",
        source: "lb_subs",
        scope: "account_submissions",
        cap: 256,
        count: 1,
        truncated: false,
        completeness: "complete",
        records: [
          {
            client_order_id: "ord-upd-cancel",
            broker_order_id: "brk-upd-cancel",
            symbol: "AAPL",
            side: "BUY",
            state: "CANCELED",
            qty_submitted: "10",
            limit_price: "50",
            estimated_fee_usd: "0",
            currency: "USD",
            fee_native: null,
            fee_currency: null,
            fee_usd: null,
            submitted_at: "2026-11-24T14:55:00.000Z",
            updated_at: "2026-11-24T15:01:00.000Z",
            evidence_ref: "sa2:codex-r2:sub-upd-cancel",
          },
        ],
      },
      executions: {
        domain_capability: "supported",
        as_of: "2026-11-24T15:02:00.000Z",
        source: "lb_execs",
        scope: "account_executions",
        cap: 512,
        count: 0,
        truncated: false,
        completeness: "complete",
        records: [],
      },
      cutoff_open_orders: {
        domain_capability: "supported",
        as_of: "2026-11-24T15:00:00.000Z",
        source: "lb_open",
        scope: "cutoff_open_orders",
        cap: 256,
        count: 1,
        truncated: false,
        completeness: "complete",
        records: [
          {
            client_order_id: "ord-upd-cancel",
            broker_order_id: "brk-upd-cancel",
            symbol: "AAPL",
            side: "BUY",
            state: "ACCEPTED",
            qty_submitted: "10",
            qty_filled: "0",
            qty_canceled: "0",
            qty_remaining: "10",
            limit_price: "50",
            reserved_fee_usd: "0",
            currency: "USD",
            as_of: "2026-11-24T15:00:00.000Z",
            evidence_ref: "sa2:codex-r2:open-upd-cancel",
          },
        ],
      },
    },
  }, { priorKPendUsd: "500.00" });
  assert.ok(validateSchema(updatedAtCancelRes), ajv.errorsText(validateSchema.errors));
  assert.equal(updatedAtCancelRes.orders[0].state, "CANCELED");
  assert.equal(updatedAtCancelRes.orders[0].qty_canceled, "10");
  assert.equal(updatedAtCancelRes.orders[0].qty_remaining, "0");
  assert.equal(updatedAtCancelRes.orders[0].k_pend_usd, "0");
  assert.equal(updatedAtCancelRes.orders[0].updated_at, "2026-11-24T15:01:00.000Z");
  assert.equal(updatedAtCancelRes.summary.k_pend_usd, "0");
  assert.equal(updatedAtCancelRes.summary.k_pend_release_allowed, true);

  // Also cover PARTIAL_CANCEL reported via updated_at after cutoff with post-cutoff fill.
  const updatedAtPartialCancelRes = evaluateAuthoritativeOrdersAndFills({
    broker: "longbridge",
    environment: "paper",
    account: "longbridge:paper:pilot",
    as_of: "2026-11-24T15:02:00.000Z",
    evaluated_at: "2026-11-24T15:02:00.000Z",
    origin: "synthetic",
    source_class: "paper_broker",
    evidence_ref: "sa2:codex-r2:p2-2-partial-cancel",
    domains: {
      submissions: {
        domain_capability: "supported",
        as_of: "2026-11-24T15:02:00.000Z",
        source: "lb_subs",
        scope: "account_submissions",
        cap: 256,
        count: 1,
        truncated: false,
        completeness: "complete",
        records: [
          {
            client_order_id: "ord-upd-pc",
            broker_order_id: "brk-upd-pc",
            symbol: "AAPL",
            side: "BUY",
            state: "PARTIAL_CANCEL",
            qty_submitted: "10",
            limit_price: "50",
            estimated_fee_usd: "0",
            currency: "USD",
            fee_native: null,
            fee_currency: null,
            fee_usd: null,
            submitted_at: "2026-11-24T14:55:00.000Z",
            updated_at: "2026-11-24T15:01:30.000Z",
            evidence_ref: "sa2:codex-r2:sub-upd-pc",
          },
        ],
      },
      executions: {
        domain_capability: "supported",
        as_of: "2026-11-24T15:02:00.000Z",
        source: "lb_execs",
        scope: "account_executions",
        cap: 512,
        count: 1,
        truncated: false,
        completeness: "complete",
        records: [
          {
            execution_ref: "exec-upd-pc-1",
            client_order_id: "ord-upd-pc",
            broker_order_id: "brk-upd-pc",
            symbol: "AAPL",
            side: "BUY",
            qty: "4",
            price: "50",
            currency: "USD",
            fee_native: "0",
            fee_currency: "USD",
            executed_at: "2026-11-24T15:01:00.000Z",
            evidence_ref: "sa2:codex-r2:ex-upd-pc",
          },
        ],
      },
      cutoff_open_orders: {
        domain_capability: "supported",
        as_of: "2026-11-24T15:00:00.000Z",
        source: "lb_open",
        scope: "cutoff_open_orders",
        cap: 256,
        count: 1,
        truncated: false,
        completeness: "complete",
        records: [
          {
            client_order_id: "ord-upd-pc",
            broker_order_id: "brk-upd-pc",
            symbol: "AAPL",
            side: "BUY",
            state: "ACCEPTED",
            qty_submitted: "10",
            qty_filled: "0",
            qty_canceled: "0",
            qty_remaining: "10",
            limit_price: "50",
            reserved_fee_usd: "0",
            currency: "USD",
            as_of: "2026-11-24T15:00:00.000Z",
            evidence_ref: "sa2:codex-r2:open-upd-pc",
          },
        ],
      },
    },
  });
  assert.ok(validateSchema(updatedAtPartialCancelRes), ajv.errorsText(validateSchema.errors));
  assert.equal(updatedAtPartialCancelRes.orders[0].state, "PARTIAL_CANCEL");
  assert.equal(updatedAtPartialCancelRes.orders[0].qty_filled, "4");
  assert.equal(updatedAtPartialCancelRes.orders[0].qty_canceled, "6");
  assert.equal(updatedAtPartialCancelRes.orders[0].qty_remaining, "0");
  assert.equal(updatedAtPartialCancelRes.orders[0].k_pend_usd, "0");
  assert.equal(updatedAtPartialCancelRes.summary.k_pend_usd, "0");

  // P2 #3: Legacy execution adapter converts local_time + time_zone deterministically & never fabricates T00:00:00Z.
  const baseLegacy = {
    ...matrix.cases.null_fee_and_non_usd_cases.legacy_ibkr_flex_payload,
    account_selector: "U" + "100001",
    observed_at: "2026-11-24T15:00:00.000Z",
  };
  const legacyUtcFuture = adaptLegacyBrokerExecutionPayload({
    ...baseLegacy,
    records: [
      {
        ...baseLegacy.records[0],
        trade_date: "2026-11-24",
        local_time: "2026-11-24T20:00:00",
        time_zone: "UTC",
      },
    ],
  }, { broker: "ibkr", environment: "live", account: "ibkr:live:a1" });
  assert.equal(legacyUtcFuture.domains.executions.records[0].executed_at, "2026-11-24T20:00:00.000Z");
  const evalUtcFuture = evaluateAuthoritativeOrdersAndFills(legacyUtcFuture);
  assert.ok(validateSchema(evalUtcFuture), ajv.errorsText(validateSchema.errors));
  assert.equal(evalUtcFuture.executions[0].executed_at, "2026-11-24T20:00:00.000Z");
  assert.equal(evalUtcFuture.summary.k_pend_release_allowed, false);

  // Verify the converted 20:00Z execution sits on the future side of a 15:00Z evaluation boundary
  // even when paired with a complete empty cutoff snapshot, whereas 21:00Z allows release.
  const completeEmptyBoundaryInput = (evaluatedAt) => ({
    broker: "ibkr",
    environment: "live",
    account: "ibkr:live:a1",
    as_of: evaluatedAt,
    evaluated_at: evaluatedAt,
    origin: "synthetic",
    source_class: "authorized_live_broker",
    evidence_ref: "sa2:codex-r2:legacy-boundary",
    domains: {
      submissions: { domain_capability: "unsupported", as_of: null, source: "omitted", scope: "account_submissions" },
      executions: {
        ...legacyUtcFuture.domains.executions,
        as_of: evaluatedAt,
        completeness: "complete",
      },
      cutoff_open_orders: {
        domain_capability: "supported",
        as_of: evaluatedAt,
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
  const boundaryAt1500 = evaluateAuthoritativeOrdersAndFills(
    completeEmptyBoundaryInput("2026-11-24T15:00:00.000Z"),
    { priorKPendUsd: "100.00" },
  );
  assert.ok(validateSchema(boundaryAt1500));
  assert.equal(boundaryAt1500.summary.k_pend_release_allowed, false);
  assert.equal(boundaryAt1500.summary.k_pend_usd, "100.00");

  const boundaryAt2100 = evaluateAuthoritativeOrdersAndFills(
    completeEmptyBoundaryInput("2026-11-24T21:00:00.000Z"),
    { priorKPendUsd: "100.00" },
  );
  assert.ok(validateSchema(boundaryAt2100));
  assert.equal(boundaryAt2100.summary.k_pend_release_allowed, true);
  assert.equal(boundaryAt2100.summary.k_pend_usd, "0");

  const legacyNyDst = adaptLegacyBrokerExecutionPayload({
    ...baseLegacy,
    observed_at: "2026-11-24T21:00:00.000Z",
    records: [
      {
        ...baseLegacy.records[0],
        execution_ref: "a".repeat(64),
        trade_date: "2026-11-24",
        local_time: "2026-11-24T09:30:00",
        time_zone: "America/New_York",
      },
      {
        ...baseLegacy.records[0],
        execution_ref: "b".repeat(64),
        trade_date: "2026-07-15",
        local_time: "2026-07-15T09:30:00",
        time_zone: "America/New_York",
      },
    ],
  }, { broker: "ibkr", environment: "live", account: "ibkr:live:a1" });
  assert.equal(legacyNyDst.domains.executions.records[0].executed_at, "2026-11-24T14:30:00.000Z");
  assert.equal(legacyNyDst.domains.executions.records[1].executed_at, "2026-07-15T13:30:00.000Z");

  // Unknown time_zone leaves executed_at: null (never midnight UTC), supports enrichment, and blocks K_pend release.
  const legacyUnknownZone = adaptLegacyBrokerExecutionPayload({
    ...baseLegacy,
    observed_at: "2026-10-23T16:00:00.000Z",
    records: [
      {
        ...baseLegacy.records[0],
        trade_date: "2026-10-23",
        local_time: "2026-10-23T09:31:00",
        time_zone: null,
      },
    ],
  }, { broker: "ibkr", environment: "live", account: "ibkr:live:a1" });
  assert.equal(legacyUnknownZone.domains.executions.records[0].executed_at, null);
  const evalUnknownZone = evaluateAuthoritativeOrdersAndFills(legacyUnknownZone);
  assert.ok(validateSchema(evalUnknownZone), ajv.errorsText(validateSchema.errors));
  assert.equal(evalUnknownZone.executions[0].executed_at, null);

  const enrichedUnknownToKnown = deduplicateExecutions(
    [{ ...legacyUnknownZone.domains.executions.records[0], executed_at: "2026-10-23T13:31:00.000Z" }],
    legacyUnknownZone.domains.executions.records,
  );
  assert.equal(enrichedUnknownToKnown.length, 1);
  assert.equal(enrichedUnknownToKnown[0].executed_at, "2026-10-23T13:31:00.000Z");

  const nullExecWithCompleteCutoff = evaluateAuthoritativeOrdersAndFills({
    broker: "ibkr",
    environment: "live",
    account: "ibkr:live:a1",
    as_of: "2026-11-24T15:00:00.000Z",
    evaluated_at: "2026-11-24T15:00:05.000Z",
    origin: "synthetic",
    source_class: "authorized_live_broker",
    evidence_ref: "sa2:codex-r2:null-exec-ts",
    domains: {
      submissions: { domain_capability: "unsupported", as_of: null, source: "omitted", scope: "account_submissions" },
      executions: {
        domain_capability: "supported",
        as_of: "2026-11-24T15:00:00.000Z",
        source: "ibkr_flex",
        scope: "account_executions",
        cap: 512,
        count: 1,
        truncated: false,
        completeness: "complete",
        records: [legacyUnknownZone.domains.executions.records[0]],
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
  }, { priorKPendUsd: "100.00" });
  assert.ok(validateSchema(nullExecWithCompleteCutoff));
  assert.equal(nullExecWithCompleteCutoff.summary.k_pend_release_allowed, false);
  assert.equal(nullExecWithCompleteCutoff.summary.k_pend_usd, "100.00");

  // Reject spring-forward DST gap, mismatched trade_date prefix, or invalid timezone.
  for (const [badRow, expectedErr] of [
    [{ trade_date: "2026-03-08", local_time: "2026-03-08T02:30:00", time_zone: "America/New_York" }, /invalid_legacy_execution_local_time/],
    [{ trade_date: "2026-11-24", local_time: "2026-11-25T09:30:00", time_zone: "UTC" }, /invalid_legacy_execution_local_time/],
    [{ trade_date: "2026-11-24", local_time: "2026-11-24T09:30:00", time_zone: "Mars/Olympus_Mons" }, /invalid_legacy_execution_time_zone/],
  ]) {
    assert.throws(
      () => adaptLegacyBrokerExecutionPayload({
        ...baseLegacy,
        records: [{ ...baseLegacy.records[0], ...badRow }],
      }, { broker: "ibkr", environment: "live", account: "ibkr:live:a1" }),
      expectedErr,
    );
  }

  // P2 #4: Mixed fee currencies still sum fee_usd when every fill carries fee_usd, keeping fee_native/fee_currency null.
  const mixedFeeUsdRes = evaluateAuthoritativeOrdersAndFills({
    broker: "ibkr",
    environment: "paper",
    account: "ibkr:paper:a1",
    as_of: "2026-11-24T15:02:00.000Z",
    evaluated_at: "2026-11-24T15:02:00.000Z",
    origin: "synthetic",
    source_class: "paper_broker",
    evidence_ref: "sa2:codex-r2:p2-4-mixed-fee-usd",
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
            client_order_id: "ord-mixed-fee",
            broker_order_id: "brk-mixed-fee",
            symbol: "AAPL",
            side: "BUY",
            state: "FILLED",
            qty_submitted: "10",
            limit_price: "50",
            currency: "USD",
            fee_native: null,
            fee_currency: null,
            fee_usd: null,
            submitted_at: "2026-11-24T15:00:00.000Z",
            resolved_at: "2026-11-24T15:01:00.000Z",
            evidence_ref: "sa2:codex-r2:sub-mixed-fee",
          },
        ],
      },
      executions: {
        domain_capability: "supported",
        as_of: "2026-11-24T15:02:00.000Z",
        source: "ibkr_execs",
        scope: "account_executions",
        cap: 512,
        count: 2,
        truncated: false,
        completeness: "complete",
        records: [
          {
            execution_ref: "exec-mixed-fee-usd",
            client_order_id: "ord-mixed-fee",
            broker_order_id: "brk-mixed-fee",
            symbol: "AAPL",
            side: "BUY",
            qty: "5",
            price: "50",
            currency: "USD",
            fee_native: "1.00",
            fee_currency: "USD",
            executed_at: "2026-11-24T15:00:30.000Z",
            evidence_ref: "sa2:codex-r2:ex-fee-1",
          },
          {
            execution_ref: "exec-mixed-fee-hkd",
            client_order_id: "ord-mixed-fee",
            broker_order_id: "brk-mixed-fee",
            symbol: "AAPL",
            side: "BUY",
            qty: "5",
            price: "50",
            currency: "USD",
            fee_native: "7.80",
            fee_currency: "HKD",
            fee_usd: "1.00",
            usd_basis_qualified: true,
            executed_at: "2026-11-24T15:01:00.000Z",
            evidence_ref: "sa2:codex-r2:ex-fee-2",
          },
        ],
      },
      cutoff_open_orders: {
        domain_capability: "supported",
        as_of: "2026-11-24T15:02:00.000Z",
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
  assert.ok(validateSchema(mixedFeeUsdRes), ajv.errorsText(validateSchema.errors));
  assert.equal(mixedFeeUsdRes.orders[0].fee_native, null);
  assert.equal(mixedFeeUsdRes.orders[0].fee_currency, null);
  assert.equal(mixedFeeUsdRes.orders[0].fee_usd, "2.00");

  // Unqualified non-USD fee on one fill still leaves aggregated fee_usd null.
  const mixedFeeUnqualified = evaluateAuthoritativeOrdersAndFills({
    broker: "ibkr",
    environment: "paper",
    account: "ibkr:paper:a1",
    as_of: "2026-11-24T15:02:00.000Z",
    evaluated_at: "2026-11-24T15:02:00.000Z",
    origin: "synthetic",
    source_class: "paper_broker",
    evidence_ref: "sa2:codex-r2:p2-4-unqualified",
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
            client_order_id: "ord-mixed-unq",
            broker_order_id: "brk-mixed-unq",
            symbol: "AAPL",
            side: "BUY",
            state: "FILLED",
            qty_submitted: "10",
            limit_price: "50",
            currency: "USD",
            fee_native: null,
            fee_currency: null,
            fee_usd: null,
            submitted_at: "2026-11-24T15:00:00.000Z",
            resolved_at: "2026-11-24T15:01:00.000Z",
            evidence_ref: "sa2:codex-r2:sub-mixed-unq",
          },
        ],
      },
      executions: {
        domain_capability: "supported",
        as_of: "2026-11-24T15:02:00.000Z",
        source: "ibkr_execs",
        scope: "account_executions",
        cap: 512,
        count: 2,
        truncated: false,
        completeness: "complete",
        records: [
          {
            execution_ref: "exec-mixed-unq-1",
            client_order_id: "ord-mixed-unq",
            broker_order_id: "brk-mixed-unq",
            symbol: "AAPL",
            side: "BUY",
            qty: "5",
            price: "50",
            currency: "USD",
            fee_native: "1.00",
            fee_currency: "USD",
            executed_at: "2026-11-24T15:00:30.000Z",
            evidence_ref: "sa2:codex-r2:ex-unq-1",
          },
          {
            execution_ref: "exec-mixed-unq-2",
            client_order_id: "ord-mixed-unq",
            broker_order_id: "brk-mixed-unq",
            symbol: "AAPL",
            side: "BUY",
            qty: "5",
            price: "50",
            currency: "USD",
            fee_native: "7.80",
            fee_currency: "HKD",
            fee_usd: null,
            usd_basis_qualified: false,
            executed_at: "2026-11-24T15:01:00.000Z",
            evidence_ref: "sa2:codex-r2:ex-unq-2",
          },
        ],
      },
      cutoff_open_orders: { domain_capability: "unsupported", as_of: null, source: "omitted", scope: "cutoff_open_orders" },
    },
  });
  assert.ok(validateSchema(mixedFeeUnqualified), ajv.errorsText(validateSchema.errors));
  assert.equal(mixedFeeUnqualified.orders[0].fee_native, null);
  assert.equal(mixedFeeUnqualified.orders[0].fee_currency, null);
  assert.equal(mixedFeeUnqualified.orders[0].fee_usd, null);
}

// 9. Codex round-3 regression guards (untimed execution reservation & lagging FILLED reconciliation)
{
  // R3 #1 (PRRT_kwDOSZeN-M67o1UQ): Untimed execution (executed_at: null) without cutoff must NEVER mark FILLED or zero K_pend.
  const untimedBuyInput = ({ includeFeeReserve }) => ({
    broker: "longbridge",
    environment: "paper",
    account: "longbridge:paper:pilot",
    as_of: "2026-11-24T15:02:00.000Z",
    evaluated_at: "2026-11-24T15:02:00.000Z",
    origin: "synthetic",
    source_class: "paper_broker",
    evidence_ref: `sa2:codex-r3:untimed-buy:${includeFeeReserve ? "reserved" : "null"}`,
    domains: {
      submissions: {
        domain_capability: "supported",
        as_of: "2026-11-24T15:02:00.000Z",
        source: "lb_subs",
        scope: "account_submissions",
        cap: 256,
        count: 1,
        truncated: false,
        completeness: "complete",
        records: [
          {
            client_order_id: "ord-untimed-1",
            broker_order_id: "brk-untimed-1",
            symbol: "AAPL",
            side: "BUY",
            state: "ACCEPTED",
            qty_submitted: "10",
            limit_price: "50",
            ...(includeFeeReserve ? { estimated_fee_usd: "0" } : {}),
            currency: "USD",
            fee_native: null,
            fee_currency: null,
            fee_usd: null,
            submitted_at: "2026-11-24T15:01:00.000Z",
            evidence_ref: "sa2:codex-r3:sub-untimed",
          },
        ],
      },
      executions: {
        domain_capability: "supported",
        as_of: "2026-11-24T15:02:00.000Z",
        source: "lb_execs",
        scope: "account_executions",
        cap: 512,
        count: 1,
        truncated: false,
        completeness: "complete",
        records: [
          {
            execution_ref: "exec-untimed-1",
            client_order_id: "ord-untimed-1",
            broker_order_id: "brk-untimed-1",
            symbol: "AAPL",
            side: "BUY",
            qty: "10",
            price: "50",
            currency: "USD",
            fee_native: "0",
            fee_currency: "USD",
            executed_at: null,
            evidence_ref: "sa2:codex-r3:ex-untimed",
          },
        ],
      },
      cutoff_open_orders: {
        domain_capability: "supported",
        as_of: "2026-11-24T15:00:00.000Z",
        source: "lb_open",
        scope: "cutoff_open_orders",
        cap: 256,
        count: 0,
        truncated: false,
        completeness: "complete",
        records: [],
      },
    },
  });

  const untimedReserved = evaluateAuthoritativeOrdersAndFills(untimedBuyInput({ includeFeeReserve: true }));
  assert.ok(validateSchema(untimedReserved), ajv.errorsText(validateSchema.errors));
  assert.equal(untimedReserved.orders[0].state, "ACCEPTED");
  assert.equal(untimedReserved.orders[0].qty_filled, "0");
  assert.equal(untimedReserved.orders[0].qty_remaining, "10");
  assert.equal(untimedReserved.orders[0].k_pend_usd, "500.00");
  assert.equal(untimedReserved.summary.k_pend_usd, "500.00");
  assert.equal(untimedReserved.summary.k_pend_release_allowed, false);

  const untimedNoFee = evaluateAuthoritativeOrdersAndFills(untimedBuyInput({ includeFeeReserve: false }));
  assert.ok(validateSchema(untimedNoFee), ajv.errorsText(validateSchema.errors));
  assert.equal(untimedNoFee.orders[0].state, "ACCEPTED");
  assert.equal(untimedNoFee.orders[0].qty_filled, "0");
  assert.equal(untimedNoFee.orders[0].qty_remaining, "10");
  assert.equal(untimedNoFee.orders[0].k_pend_usd, null);
  assert.equal(untimedNoFee.summary.k_pend_usd, null);
  assert.equal(untimedNoFee.summary.k_pend_release_allowed, false);

  // Unlinked untimed execution + empty complete cutoff without prior K_pend must still fail closed (never "0").
  const untimedUnlinked = evaluateAuthoritativeOrdersAndFills({
    broker: "longbridge",
    environment: "paper",
    account: "longbridge:paper:pilot",
    as_of: "2026-11-24T15:02:00.000Z",
    evaluated_at: "2026-11-24T15:02:00.000Z",
    origin: "synthetic",
    source_class: "paper_broker",
    evidence_ref: "sa2:codex-r3:untimed-unlinked",
    domains: {
      submissions: { domain_capability: "unsupported", as_of: null, source: "omitted", scope: "account_submissions" },
      executions: {
        domain_capability: "supported",
        as_of: "2026-11-24T15:02:00.000Z",
        source: "lb_execs",
        scope: "account_executions",
        cap: 512,
        count: 1,
        truncated: false,
        completeness: "complete",
        records: [
          {
            execution_ref: "exec-untimed-unlinked",
            client_order_id: null,
            broker_order_id: null,
            symbol: "AAPL",
            side: "BUY",
            qty: "10",
            price: "50",
            currency: "USD",
            fee_native: "0",
            fee_currency: "USD",
            executed_at: null,
            evidence_ref: "sa2:codex-r3:ex-unlinked",
          },
        ],
      },
      cutoff_open_orders: {
        domain_capability: "supported",
        as_of: "2026-11-24T15:00:00.000Z",
        source: "lb_open",
        scope: "cutoff_open_orders",
        cap: 256,
        count: 0,
        truncated: false,
        completeness: "complete",
        records: [],
      },
    },
  });
  assert.ok(validateSchema(untimedUnlinked), ajv.errorsText(validateSchema.errors));
  assert.equal(untimedUnlinked.summary.k_pend_release_allowed, false);
  assert.equal(untimedUnlinked.summary.k_pend_usd, null);

  // R3 #3 (PRRT_kwDOSZeN-M67o1Ua): Definitive FILLED submission with unsupported/lagging executions reconciles qty_filled & leaves avg_fill_price null.
  const filledUnsupportedExecs = evaluateAuthoritativeOrdersAndFills({
    broker: "longbridge",
    environment: "paper",
    account: "longbridge:paper:pilot",
    as_of: "2026-11-24T15:02:00.000Z",
    evaluated_at: "2026-11-24T15:02:00.000Z",
    origin: "synthetic",
    source_class: "paper_broker",
    evidence_ref: "sa2:codex-r3:filled-unsupported-execs",
    domains: {
      submissions: {
        domain_capability: "supported",
        as_of: "2026-11-24T15:02:00.000Z",
        source: "lb_subs",
        scope: "account_submissions",
        cap: 256,
        count: 1,
        truncated: false,
        completeness: "complete",
        records: [
          {
            client_order_id: "ord-filled-no-exec",
            broker_order_id: "brk-filled-no-exec",
            symbol: "AAPL",
            side: "BUY",
            state: "FILLED",
            qty_submitted: "10",
            limit_price: "50",
            currency: "USD",
            fee_native: null,
            fee_currency: null,
            fee_usd: null,
            submitted_at: "2026-11-24T14:55:00.000Z",
            resolved_at: "2026-11-24T15:01:00.000Z",
            evidence_ref: "sa2:codex-r3:sub-filled-no-exec",
          },
        ],
      },
      executions: { domain_capability: "unsupported", as_of: null, source: "omitted", scope: "account_executions" },
      cutoff_open_orders: {
        domain_capability: "supported",
        as_of: "2026-11-24T15:02:00.000Z",
        source: "lb_open",
        scope: "cutoff_open_orders",
        cap: 256,
        count: 0,
        truncated: false,
        completeness: "complete",
        records: [],
      },
    },
  });
  assert.ok(validateSchema(filledUnsupportedExecs), ajv.errorsText(validateSchema.errors));
  assert.equal(filledUnsupportedExecs.orders[0].state, "FILLED");
  assert.equal(filledUnsupportedExecs.orders[0].qty_submitted, "10");
  assert.equal(filledUnsupportedExecs.orders[0].qty_filled, "10");
  assert.equal(filledUnsupportedExecs.orders[0].qty_canceled, "0");
  assert.equal(filledUnsupportedExecs.orders[0].qty_remaining, "0");
  assert.equal(filledUnsupportedExecs.orders[0].avg_fill_price, null);
  assert.equal(filledUnsupportedExecs.orders[0].notional_usd, null);
  assert.equal(filledUnsupportedExecs.orders[0].k_pend_usd, "0");
  assert.equal(filledUnsupportedExecs.summary.k_pend_usd, "0");
  assert.equal(filledUnsupportedExecs.summary.k_pend_release_allowed, true);

  // Post-cutoff FILLED via updated_at with only partial (4 of 10) lagging executions: qty_filled="10", avg_fill_price=null.
  const filledPartialLagExecs = evaluateAuthoritativeOrdersAndFills({
    broker: "longbridge",
    environment: "paper",
    account: "longbridge:paper:pilot",
    as_of: "2026-11-24T15:02:00.000Z",
    evaluated_at: "2026-11-24T15:02:00.000Z",
    origin: "synthetic",
    source_class: "paper_broker",
    evidence_ref: "sa2:codex-r3:filled-partial-lag",
    domains: {
      submissions: {
        domain_capability: "supported",
        as_of: "2026-11-24T15:02:00.000Z",
        source: "lb_subs",
        scope: "account_submissions",
        cap: 256,
        count: 1,
        truncated: false,
        completeness: "complete",
        records: [
          {
            client_order_id: "ord-filled-lag",
            broker_order_id: "brk-filled-lag",
            symbol: "AAPL",
            side: "BUY",
            state: "FILLED",
            qty_submitted: "10",
            limit_price: "50",
            currency: "USD",
            fee_native: null,
            fee_currency: null,
            fee_usd: null,
            submitted_at: "2026-11-24T14:55:00.000Z",
            updated_at: "2026-11-24T15:01:30.000Z",
            evidence_ref: "sa2:codex-r3:sub-filled-lag",
          },
        ],
      },
      executions: {
        domain_capability: "supported",
        as_of: "2026-11-24T15:02:00.000Z",
        source: "lb_execs",
        scope: "account_executions",
        cap: 512,
        count: 1,
        truncated: false,
        completeness: "incomplete",
        records: [
          {
            execution_ref: "exec-lag-partial",
            client_order_id: "ord-filled-lag",
            broker_order_id: "brk-filled-lag",
            symbol: "AAPL",
            side: "BUY",
            qty: "4",
            price: "49.50",
            currency: "USD",
            fee_native: "0",
            fee_currency: "USD",
            executed_at: "2026-11-24T15:01:00.000Z",
            evidence_ref: "sa2:codex-r3:ex-lag",
          },
        ],
      },
      cutoff_open_orders: {
        domain_capability: "supported",
        as_of: "2026-11-24T15:00:00.000Z",
        source: "lb_open",
        scope: "cutoff_open_orders",
        cap: 256,
        count: 1,
        truncated: false,
        completeness: "complete",
        records: [
          {
            client_order_id: "ord-filled-lag",
            broker_order_id: "brk-filled-lag",
            symbol: "AAPL",
            side: "BUY",
            state: "ACCEPTED",
            qty_submitted: "10",
            qty_filled: "0",
            qty_canceled: "0",
            qty_remaining: "10",
            limit_price: "50",
            reserved_fee_usd: "0",
            currency: "USD",
            as_of: "2026-11-24T15:00:00.000Z",
            evidence_ref: "sa2:codex-r3:open-lag",
          },
        ],
      },
    },
  });
  assert.ok(validateSchema(filledPartialLagExecs), ajv.errorsText(validateSchema.errors));
  assert.equal(filledPartialLagExecs.orders[0].state, "FILLED");
  assert.equal(filledPartialLagExecs.orders[0].qty_filled, "10");
  assert.equal(filledPartialLagExecs.orders[0].qty_remaining, "0");
  assert.equal(filledPartialLagExecs.orders[0].avg_fill_price, null);
  assert.equal(filledPartialLagExecs.orders[0].k_pend_usd, "0");
  assert.equal(filledPartialLagExecs.summary.k_pend_usd, "0");
  assert.equal(filledPartialLagExecs.summary.k_pend_release_allowed, true);

  // Over-fill execution (> qty_submitted) on FILLED submission still fails closed.
  assert.throws(
    () => evaluateAuthoritativeOrdersAndFills({
      broker: "longbridge",
      environment: "paper",
      account: "longbridge:paper:pilot",
      as_of: "2026-11-24T15:02:00.000Z",
      evaluated_at: "2026-11-24T15:02:00.000Z",
      origin: "synthetic",
      source_class: "paper_broker",
      evidence_ref: "sa2:codex-r3:overfill-fail",
      domains: {
        submissions: filledPartialLagExecs.domains.submissions,
        executions: {
          ...filledPartialLagExecs.domains.executions,
          completeness: "complete",
          records: [
            {
              ...filledPartialLagExecs.domains.executions.records[0],
              execution_ref: "exec-overfill-1",
              client_order_id: "ord-filled-lag",
              qty: "11",
            },
          ],
        },
        cutoff_open_orders: {
          domain_capability: "supported",
          as_of: "2026-11-24T15:02:00.000Z",
          source: "lb_open",
          scope: "cutoff_open_orders",
          cap: 256,
          count: 0,
          truncated: false,
          completeness: "complete",
          records: [],
        },
      },
    }),
    /order_quantities_exceed_submitted/,
  );
}

// 10. Codex round-4 regression guard (PRRT_kwDOSZeN-M67pKB0: untimed terminal observation must NOT clear ORDER_UNKNOWN lock)
{
  let untimedLockStore = createOrderUnknownLockStore();
  untimedLockStore = applyOrderUnknownObservation(untimedLockStore, {
    broker: "longbridge",
    environment: "paper",
    account: "longbridge:paper:pilot",
    client_order_id: "ord-lock-untimed",
    broker_order_id: null,
    symbol: "AAPL",
    side: "BUY",
    state: "ORDER_UNKNOWN",
    qty_submitted: "10",
    limit_price: "50.00",
    estimated_fee_usd: "0",
    currency: "USD",
    submitted_at: "2026-11-24T14:55:00.000Z",
    evidence_ref: "sa2:codex-r4:lock-create",
  });

  const untimedTerminalEvent = {
    broker: "longbridge",
    environment: "paper",
    account: "longbridge:paper:pilot",
    client_order_id: "ord-lock-untimed",
    symbol: "AAPL",
    state: "CANCELED",
  };
  const retainedWithEval = applyOrderUnknownObservation(
    untimedLockStore,
    untimedTerminalEvent,
    { evaluatedAt: "2026-11-24T15:00:00.000Z" },
  );
  assert.deepEqual(
    lockedSymbolsForAccount(retainedWithEval, { broker: "longbridge", environment: "paper", account: "longbridge:paper:pilot" }),
    ["AAPL"],
  );
  const retainedCheck = checkSymbolOrderAllowed(retainedWithEval, {
    broker: "longbridge",
    environment: "paper",
    account: "longbridge:paper:pilot",
    symbol: "AAPL",
  });
  assert.equal(retainedCheck.allowed, false);
  assert.equal(retainedCheck.lock.k_pend_usd, "500.00");

  const retainedWithoutEval = applyOrderUnknownObservation(untimedLockStore, untimedTerminalEvent);
  assert.deepEqual(
    lockedSymbolsForAccount(retainedWithoutEval, { broker: "longbridge", environment: "paper", account: "longbridge:paper:pilot" }),
    ["AAPL"],
  );

  // Positive control: timestamped terminal evidence <= evaluatedAt clears the lock cleanly.
  const clearedTimestamped = applyOrderUnknownObservation(
    retainedWithEval,
    { ...untimedTerminalEvent, resolved_at: "2026-11-24T14:59:00.000Z" },
    { evaluatedAt: "2026-11-24T15:00:00.000Z" },
  );
  assert.deepEqual(
    lockedSymbolsForAccount(clearedTimestamped, { broker: "longbridge", environment: "paper", account: "longbridge:paper:pilot" }),
    [],
  );
}

console.log("sa2_orders_fills_validation: PASS (SA-A12)");
