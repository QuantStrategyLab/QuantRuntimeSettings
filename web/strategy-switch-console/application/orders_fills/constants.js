/**
 * C-SA-25: Authoritative orders, fills, cutoff open orders, and ORDER-UNKNOWN constants.
 *
 * Pure zero-import constant table under application/orders_fills/:
 * - Never imports helpers, Worker/DO modules, storage, or network.
 * - Separates broker from paper/live environment and enforces 256/512/2048 caps.
 */

export const AUTHORITATIVE_ORDERS_FILLS_SCHEMA = "qsl.authoritative_orders_fills.v1";
export const ORDER_UNKNOWN_LOCK_STORE_SCHEMA = "qsl.order_unknown_lock_store.v1";

export const ALLOWED_ORDER_BROKERS = Object.freeze([
  "schwab",
  "firstrade",
  "ibkr",
  "longbridge",
  "binance",
]);

export const ALLOWED_ORDER_ENVIRONMENTS = Object.freeze([
  "live",
  "paper",
]);

export const ORDER_LIFECYCLE_STATES = Object.freeze([
  "SUBMITTED",
  "ACCEPTED",
  "PARTIAL_FILL",
  "FILLED",
  "PARTIAL_CANCEL",
  "CANCELED",
  "REJECTED",
  "ORDER_UNKNOWN",
]);

export const TERMINAL_ORDER_STATES = Object.freeze([
  "FILLED",
  "CANCELED",
  "REJECTED",
]);

export const WORKING_ORDER_STATES = Object.freeze([
  "SUBMITTED",
  "ACCEPTED",
  "PARTIAL_FILL",
  "PARTIAL_CANCEL",
  "ORDER_UNKNOWN",
]);

export const ORDER_SIDES = Object.freeze(["BUY", "SELL"]);

export const ORDER_DOMAIN_NAMES = Object.freeze([
  "submissions",
  "executions",
  "cutoff_open_orders",
]);

export const ORDER_DOMAIN_CAPS = Object.freeze([256, 512, 2048]);

export const DOMAIN_CAPABILITIES = Object.freeze(["supported", "unsupported"]);

export const COMPLETENESS_STATUSES = Object.freeze([
  "complete",
  "incomplete",
  "unknown",
  "unsupported",
]);

export const SOURCE_CLASSES = Object.freeze([
  "synthetic",
  "historical_reconstruction",
  "decision_time_market",
  "operator_declared",
  "authorized_operational",
  "paper_broker",
  "authorized_live_broker",
]);

export const ORIGINS = Object.freeze(["synthetic", "production"]);

export const BROKER_SET = new Set(ALLOWED_ORDER_BROKERS);
export const ENVIRONMENT_SET = new Set(ALLOWED_ORDER_ENVIRONMENTS);
export const ORDER_STATE_SET = new Set(ORDER_LIFECYCLE_STATES);
export const TERMINAL_STATE_SET = new Set(TERMINAL_ORDER_STATES);
export const ORDER_SIDE_SET = new Set(ORDER_SIDES);
export const DOMAIN_NAME_SET = new Set(ORDER_DOMAIN_NAMES);
export const DOMAIN_CAP_SET = new Set(ORDER_DOMAIN_CAPS);
export const DOMAIN_CAPABILITY_SET = new Set(DOMAIN_CAPABILITIES);
export const COMPLETENESS_SET = new Set(COMPLETENESS_STATUSES);
export const SOURCE_CLASS_SET = new Set(SOURCE_CLASSES);
export const ORIGIN_SET = new Set(ORIGINS);

export const DECIMAL_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
export const NON_NEGATIVE_DECIMAL_RE = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
export const POSITIVE_DECIMAL_RE = /^(?:0\.\d*[1-9]\d*|[1-9]\d*(?:\.\d+)?)$/;
export const CURRENCY_RE = /^[A-Z][A-Z0-9]{2,9}$/;
export const SYMBOL_RE = /^[A-Z0-9][A-Z0-9./_-]{0,63}$/;
export const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const OPAQUE_ACCOUNT_SLOT_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
export const CANONICAL_ORDER_ACCOUNT_RE = /^(schwab|firstrade|ibkr|longbridge|binance):(live|paper):([a-z0-9][a-z0-9_-]{0,31})$/;
export const HEX64_RE = /^[a-f0-9]{64}$/;
export const SHA256_EVIDENCE_RE = /^sha256:[a-f0-9]{64}$/;

export class OrdersFillsError extends Error {
  constructor(code = "invalid_orders_fills", status = 400) {
    super(code);
    this.name = "OrdersFillsError";
    this.code = code;
    this.status = status;
  }
}
