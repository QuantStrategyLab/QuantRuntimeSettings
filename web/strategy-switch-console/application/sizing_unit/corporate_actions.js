/**
 * C-SA-CA: Atomic, apply-once, replayable corporate-action ledger.
 *
 * Pure leaf module under application/sizing_unit/:
 * - Enforces exact conservation: pre_units * pre_ref = post_units * post_ref +
 *   incremental_cash_in_lieu + incremental_dividend_receivable.
 * - Excludes all corporate actions and internal dividend transfers from
 *   external cash flows (external_flow_delta: "0") and preserves loss memory.
 * - Preserves ticker_lineage on instrument_id, invokes V3 on unresolved
 *   delisting, and enforces V2 halt with exact-match broker auto-clear vs
 *   mandatory human re-arm.
 * - Uses pure-JS synchronous SHA-256 (zero node:crypto or Worker imports).
 */

import {
  ratAdd,
  ratCmp,
  ratDiv,
  ratFromText,
  ratMul,
  ratSub,
  ratToDecimalText,
} from "./nav.js";

export const CORPORATE_ACTION_EVENT_SCHEMA = "qsl.corporate_action_event.v1";
export const CORPORATE_ACTION_LEDGER_SCHEMA = "qsl.corporate_action_ledger.v1";

const ZERO = { n: 0n, d: 1n };
const ONE = { n: 1n, d: 1n };

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x, n) {
  return (x >>> n) | (x << (32 - n));
}

function sha256HexSync(input) {
  const bytes = new TextEncoder().encode(input);
  const bitLen = BigInt(bytes.length) * 8n;
  const paddedLen = Math.ceil((bytes.length + 9) / 64) * 64;
  const buf = new Uint8Array(paddedLen);
  buf.set(bytes);
  buf[bytes.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(paddedLen - 8, Number(bitLen >> 32n), false);
  view.setUint32(paddedLen - 4, Number(bitLen & 0xffffffffn), false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((n) => n.toString(16).padStart(8, "0"))
    .join("");
}

function canonicalStringify(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

function formatUsdAmount(r) {
  if (r.n === 0n) return "0";
  return ratToDecimalText(r, { minScale: 2, maxScale: 8 });
}

function formatUnits(r) {
  if (r.n === 0n) return "0";
  return ratToDecimalText(r, { minScale: 0, maxScale: 8 });
}

function computeTotalEquityRat(ledger) {
  let total = ratAdd(
    ratFromText(ledger.settled_cash_usd),
    ratFromText(ledger.dividend_receivable_usd),
  );
  for (const pos of Object.values(ledger.positions || {})) {
    total = ratAdd(total, ratMul(ratFromText(pos.units), ratFromText(pos.ref_price_usd)));
  }
  return total;
}

function haltLedgerRejection(ledgerState, reason, instrumentId, symbol) {
  const rejected = rejectAction(ledgerState, reason);
  const existingHalted = Array.isArray(rejected.ledger.v2?.halted_instruments)
    ? [...rejected.ledger.v2.halted_instruments]
    : [];
  if (instrumentId && !existingHalted.some((h) => h.instrument_id === instrumentId)) {
    existingHalted.push({ instrument_id: instrumentId, symbol: symbol ?? null });
  }
  const haltedV2 = {
    ...rejected.ledger.v2,
    halted: true,
    state: "HALT",
    auto_cleared: false,
    human_rearm_required: true,
    halted_instruments: existingHalted,
  };
  rejected.v2 = haltedV2;
  rejected.ledger.v2 = structuredClone(haltedV2);
  return rejected;
}

function rejectAction(ledgerState, reason) {
  return {
    ok: false,
    replayed: false,
    reason,
    external_flow_delta: "0",
    phantom_return: "0",
    phantom_drawdown: "0",
    ledger: structuredClone(ledgerState),
    v2: structuredClone(ledgerState.v2),
  };
}

function parseActionLeg(leg) {
  if (!leg || typeof leg !== "object" || typeof leg.applicable !== "boolean") {
    return { ok: false };
  }
  if (!leg.applicable) {
    return leg.amount_usd === null ? { ok: true, rat: ZERO, applicable: false } : { ok: false };
  }
  const r = ratFromText(leg.amount_usd);
  if (!r || r.n < 0n) return { ok: false };
  return { ok: true, rat: r, applicable: true };
}

/**
 * Creates a clean C-SA-CA corporate-action ledger preserving initial positions,
 * balances, loss memory, and V2/V3 control states.
 */
export function createCorporateActionLedger(initial = {}) {
  const positions = {};
  for (const [key, pos] of Object.entries(initial.positions || {})) {
    positions[key] = {
      instrument_id: pos.instrument_id || key,
      symbol: pos.symbol,
      units: String(pos.units),
      ref_price_usd: String(pos.ref_price_usd),
      unresolved_pending_evidence: Boolean(pos.unresolved_pending_evidence),
      ticker_history: Array.isArray(pos.ticker_history) ? structuredClone(pos.ticker_history) : [pos.symbol],
    };
  }
  return {
    account_id: initial.account_id || "synth-sizing-01",
    broker_environment: initial.broker_environment === "paper" ? "paper" : "live",
    settled_cash_usd: String(initial.settled_cash_usd ?? "0"),
    dividend_receivable_usd: String(initial.dividend_receivable_usd ?? "0"),
    receivables_by_instrument: structuredClone(initial.receivables_by_instrument || {}),
    positions,
    loss_memory: structuredClone(initial.loss_memory || {
      dd_b: "0",
      w_ref_usd: "0",
      l_usd: "0",
      tier_drawdown_limit_d: "0.30",
      c_t: "0.30",
    }),
    applied_events: Array.isArray(initial.applied_events) ? structuredClone(initial.applied_events) : [],
    v2: structuredClone(initial.v2 || {
      halted: false,
      state: "CLEAR",
      auto_cleared: false,
      human_rearm_required: false,
      halted_instruments: [],
      triggers: [],
    }),
    v3: structuredClone(initial.v3 || {
      triggered: false,
      unresolved_instruments: [],
    }),
  };
}

export function serializeCorporateActionLedger(ledgerState) {
  const state = structuredClone(ledgerState);
  return {
    schema_version: CORPORATE_ACTION_LEDGER_SCHEMA,
    ledger_digest: sha256HexSync(canonicalStringify(state)),
    state,
  };
}

export function hydrateCorporateActionLedger(snapshot) {
  if (!snapshot || snapshot.schema_version !== CORPORATE_ACTION_LEDGER_SCHEMA || !snapshot.state) {
    throw new Error("invalid_corporate_action_ledger_snapshot");
  }
  const recomputed = sha256HexSync(canonicalStringify(snapshot.state));
  if (snapshot.ledger_digest && recomputed !== snapshot.ledger_digest) {
    throw new Error("corporate_action_ledger_digest_mismatch");
  }
  return structuredClone(snapshot.state);
}

/**
 * Applies a C-SA-CA corporate-action event atomically (apply-once by event_id
 * + revision). Rejects broken conservation or mismatches with zero mutation.
 */
export function applyCorporateAction(ledgerState, event) {
  if (!ledgerState || !event || event.schema_version !== CORPORATE_ACTION_EVENT_SCHEMA) {
    return rejectAction(ledgerState, "invalid_corporate_action_event");
  }
  if (event.account_id !== ledgerState.account_id || event.broker_environment !== ledgerState.broker_environment) {
    return rejectAction(ledgerState, "account_or_environment_mismatch");
  }

  const eventDigest = sha256HexSync(canonicalStringify(event));
  const prior = (ledgerState.applied_events || []).find((e) => e.event_id === event.event_id);
  if (prior) {
    if (prior.event_digest === eventDigest && prior.revision === event.revision) {
      return {
        ok: true,
        replayed: true,
        external_flow_delta: "0",
        phantom_return: "0",
        phantom_drawdown: "0",
        ledger: structuredClone(ledgerState),
        v2: structuredClone(ledgerState.v2),
      };
    }
    return rejectAction(ledgerState, "conflicting_duplicate_event_id");
  }

  const pos = ledgerState.positions?.[event.instrument_id];
  if (!pos) {
    return rejectAction(ledgerState, "unknown_instrument_id");
  }
  const v2Triggered = Boolean(
    event.v2_control?.announced_within_two_sessions || event.v2_control?.price_anomaly_detected,
  );
  const failAction = (reason) => (
    v2Triggered
      ? haltLedgerRejection(ledgerState, reason, event.instrument_id, pos.symbol)
      : rejectAction(ledgerState, reason)
  );
  const symbolInLineage = (sym) => sym === pos.symbol
    || (Array.isArray(pos.ticker_history) && pos.ticker_history.includes(sym));
  const isHistoricalDividendSymbol = event.action_type === "dividend_payment"
    && symbolInLineage(event.symbol);
  if (pos.symbol !== event.symbol && !isHistoricalDividendSymbol) {
    return failAction("instrument_symbol_mismatch");
  }

  const preUnits = ratFromText(event.pre_units);
  const postUnits = ratFromText(event.post_units);
  const preRef = ratFromText(event.pre_ref);
  const postRef = ratFromText(event.post_ref);
  const ratio = ratFromText(event.ratio);
  const posUnits = ratFromText(pos.units);
  const posRef = ratFromText(pos.ref_price_usd);
  if (!preUnits || !postUnits || !preRef || !postRef || !ratio || !posUnits || !posRef) {
    return failAction("invalid_decimal_operands");
  }
  if (ratCmp(posUnits, preUnits) !== 0 || ratCmp(posRef, preRef) !== 0) {
    return failAction("pre_state_mismatch");
  }

  const cilLeg = parseActionLeg(event.incremental_cash_in_lieu);
  const divRecLeg = parseActionLeg(event.incremental_dividend_receivable);
  const payLeg = parseActionLeg(event.payment_transfer_usd);
  if (!cilLeg.ok || !divRecLeg.ok || !payLeg.ok) {
    return failAction("malformed_action_leg");
  }

  const preNotional = ratMul(preUnits, preRef);
  const postNotional = ratMul(postUnits, postRef);
  const nextLedger = structuredClone(ledgerState);
  if (!nextLedger.receivables_by_instrument || typeof nextLedger.receivables_by_instrument !== "object") {
    nextLedger.receivables_by_instrument = {};
  }
  const settledBefore = ratFromText(nextLedger.settled_cash_usd);
  const recBefore = ratFromText(nextLedger.dividend_receivable_usd);
  let nextSettled = settledBefore;
  let nextRec = recBefore;

  if (event.action_type === "forward_split" || event.action_type === "reverse_split") {
    if (divRecLeg.applicable || payLeg.applicable) {
      return failAction("unexpected_dividend_leg_on_split");
    }
    const isHaltSentinel = Boolean(event.v2_control?.announced_within_two_sessions) && ratCmp(ratio, ONE) === 0;
    if (!isHaltSentinel) {
      if (ratio.n <= 0n) {
        return failAction("invalid_split_ratio");
      }
      if (event.action_type === "forward_split" && ratCmp(ratio, ONE) <= 0) {
        return failAction("forward_split_requires_ratio_gt_1");
      }
      if (event.action_type === "reverse_split" && ratCmp(ratio, ONE) >= 0) {
        return failAction("reverse_split_requires_ratio_lt_1");
      }
      const expectedPostRef = ratDiv(preRef, ratio);
      const rawPostUnits = ratMul(preUnits, ratio);
      if (ratCmp(postRef, expectedPostRef) !== 0) {
        return haltLedgerRejection(ledgerState, "split_ratio_not_applied", event.instrument_id, pos.symbol);
      }
      if (cilLeg.applicable) {
        const remainder = ratSub(rawPostUnits, postUnits);
        if (
          postUnits.d !== 1n
          || remainder.n < 0n
          || ratCmp(remainder, ONE) >= 0
          || ratCmp(ratMul(remainder, postRef), cilLeg.rat) !== 0
        ) {
          return haltLedgerRejection(ledgerState, "split_cil_mismatch", event.instrument_id, pos.symbol);
        }
      } else if (ratCmp(postUnits, rawPostUnits) !== 0) {
        return haltLedgerRejection(ledgerState, "split_ratio_not_applied", event.instrument_id, pos.symbol);
      }
    }
    const lhs = preNotional;
    const rhs = ratAdd(postNotional, cilLeg.rat);
    if (ratCmp(lhs, rhs) !== 0) {
      return failAction("conservation_equation_violated");
    }
    nextSettled = ratAdd(settledBefore, cilLeg.rat);
  } else if (event.action_type === "cash_dividend") {
    if (cilLeg.applicable || payLeg.applicable || !divRecLeg.applicable) {
      return failAction("invalid_ex_date_dividend_legs");
    }
    if (ratCmp(preUnits, postUnits) !== 0) {
      return failAction("unexpected_position_change_on_cash_dividend");
    }
    const eligible = ratFromText(event.eligible_units);
    const dpu = ratFromText(event.dividend_per_unit_usd);
    if (!eligible || !dpu || ratCmp(ratMul(eligible, dpu), divRecLeg.rat) !== 0) {
      return failAction("dividend_accrual_mismatch");
    }
    if (ratCmp(preNotional, ratAdd(postNotional, divRecLeg.rat)) !== 0) {
      return failAction("conservation_equation_violated");
    }
    const curInst = nextLedger.receivables_by_instrument[event.instrument_id];
    const curAmt = curInst ? ratFromText(curInst.amount_usd) : ZERO;
    const nextInstAmt = ratAdd(curAmt, divRecLeg.rat);
    nextLedger.receivables_by_instrument[event.instrument_id] = {
      instrument_id: event.instrument_id,
      symbol: event.symbol,
      currency: event.currency || "USD",
      amount_usd: formatUsdAmount(nextInstAmt),
    };
    nextRec = ratAdd(recBefore, divRecLeg.rat);
  } else if (event.action_type === "dividend_payment") {
    if (cilLeg.applicable || divRecLeg.applicable || !payLeg.applicable) {
      return failAction("invalid_dividend_payment_legs");
    }
    if (
      ratCmp(preUnits, postUnits) !== 0
      || ratCmp(preRef, postRef) !== 0
      || ratCmp(preNotional, postNotional) !== 0
    ) {
      return failAction("unexpected_position_change_on_payment");
    }
    const instRec = nextLedger.receivables_by_instrument[event.instrument_id];
    const instAmt = instRec ? ratFromText(instRec.amount_usd) : null;
    const lineageMatches = instRec
      && symbolInLineage(instRec.symbol)
      && symbolInLineage(event.symbol);
    if (
      !instRec
      || !lineageMatches
      || (event.currency && instRec.currency && event.currency !== instRec.currency)
      || !instAmt
      || ratCmp(instAmt, payLeg.rat) < 0
      || ratCmp(recBefore, payLeg.rat) < 0
    ) {
      return failAction("cross_symbol_or_missing_dividend_receivable");
    }
    const remInstAmt = ratSub(instAmt, payLeg.rat);
    nextLedger.receivables_by_instrument[event.instrument_id] = {
      ...instRec,
      symbol: pos.symbol,
      amount_usd: formatUsdAmount(remInstAmt),
    };
    nextRec = ratSub(recBefore, payLeg.rat);
    nextSettled = ratAdd(settledBefore, payLeg.rat);
  } else if (event.action_type === "ticker_change") {
    if (cilLeg.applicable || divRecLeg.applicable || payLeg.applicable || !event.ticker_lineage) {
      return failAction("invalid_ticker_change_event");
    }
    if (
      event.ticker_lineage.instrument_id !== event.instrument_id
      || event.ticker_lineage.prior_symbol !== pos.symbol
      || ratCmp(preUnits, postUnits) !== 0
      || ratCmp(preRef, postRef) !== 0
      || ratCmp(preNotional, postNotional) !== 0
    ) {
      return failAction("ticker_lineage_mismatch");
    }
    nextLedger.positions[event.instrument_id].symbol = event.ticker_lineage.new_symbol;
    nextLedger.positions[event.instrument_id].ticker_history.push(event.ticker_lineage.new_symbol);
    if (nextLedger.receivables_by_instrument[event.instrument_id]) {
      nextLedger.receivables_by_instrument[event.instrument_id] = {
        ...nextLedger.receivables_by_instrument[event.instrument_id],
        symbol: event.ticker_lineage.new_symbol,
      };
    }
  } else if (event.action_type === "delisting") {
    if (!event.delisting || event.delisting.invoked_v3 !== true) {
      return failAction("delisting_requires_v3_flag");
    }
    let finalUnits = postUnits;
    let finalRef = postRef;
    if (!event.delisting.resolved) {
      if (event.delisting.terminal_valuation_usd !== null) {
        return failAction("unresolved_delisting_must_have_null_valuation");
      }
      if (ratCmp(preUnits, postUnits) !== 0 || ratCmp(preRef, postRef) !== 0 || ratCmp(preNotional, postNotional) !== 0) {
        return failAction("delisting_conservation_mismatch");
      }
      nextLedger.positions[event.instrument_id].unresolved_pending_evidence = true;
      nextLedger.v3.triggered = true;
      if (!nextLedger.v3.unresolved_instruments.includes(event.instrument_id)) {
        nextLedger.v3.unresolved_instruments.push(event.instrument_id);
      }
    } else {
      if (event.delisting.terminal_valuation_usd === null) {
        return failAction("delisting_requires_terminal_valuation");
      }
      const termVal = ratFromText(String(event.delisting.terminal_valuation_usd));
      if (!termVal || termVal.n < 0n) {
        return failAction("invalid_delisting_terminal_valuation");
      }
      const settledToCash = postUnits.n === 0n && postNotional.n === 0n;
      const markedAtTerminal = ratCmp(postUnits, preUnits) === 0 && ratCmp(postNotional, termVal) === 0;
      if (!settledToCash && !markedAtTerminal) {
        return failAction("delisting_terminal_valuation_mismatch");
      }
      if (settledToCash || termVal.n === 0n) {
        const legCash = payLeg.applicable ? payLeg.rat : (cilLeg.applicable ? cilLeg.rat : null);
        if (legCash !== null && ratCmp(legCash, termVal) !== 0) {
          return failAction("delisting_terminal_valuation_mismatch");
        }
        if (settledToCash) {
          nextSettled = ratAdd(settledBefore, termVal);
        }
        finalUnits = ZERO;
        finalRef = ZERO;
      }
      nextLedger.positions[event.instrument_id].unresolved_pending_evidence = false;
      nextLedger.positions[event.instrument_id].delisted_settled = true;
      nextLedger.v3.triggered = true;
      nextLedger.v3.unresolved_instruments = nextLedger.v3.unresolved_instruments.filter(
        (id) => id !== event.instrument_id,
      );
    }
    nextLedger.settled_cash_usd = formatUsdAmount(nextSettled);
    nextLedger.dividend_receivable_usd = formatUsdAmount(nextRec);
    nextLedger.positions[event.instrument_id].units = formatUnits(finalUnits);
    nextLedger.positions[event.instrument_id].ref_price_usd = formatUsdAmount(finalRef);
  } else {
    return rejectAction(ledgerState, "unsupported_action_type");
  }

  if (event.action_type !== "delisting") {
    nextLedger.settled_cash_usd = formatUsdAmount(nextSettled);
    nextLedger.dividend_receivable_usd = formatUsdAmount(nextRec);
    nextLedger.positions[event.instrument_id].units = formatUnits(postUnits);
    nextLedger.positions[event.instrument_id].ref_price_usd = formatUsdAmount(postRef);
  }

  if (v2Triggered) {
    const existingHalted = Array.isArray(nextLedger.v2?.halted_instruments)
      ? [...nextLedger.v2.halted_instruments]
      : [];
    if (!existingHalted.some((h) => h.instrument_id === event.instrument_id)) {
      existingHalted.push({ instrument_id: event.instrument_id, symbol: pos.symbol });
    }
    nextLedger.v2 = {
      halted: true,
      state: "HALT",
      auto_cleared: false,
      human_rearm_required: true,
      halted_instruments: existingHalted,
      triggers: [
        ...(nextLedger.v2?.triggers || []),
        {
          event_id: event.event_id,
          instrument_id: event.instrument_id,
          symbol: pos.symbol,
          announced_within_two_sessions: Boolean(event.v2_control.announced_within_two_sessions),
          price_anomaly_detected: Boolean(event.v2_control.price_anomaly_detected),
        },
      ],
    };
  }

  nextLedger.applied_events.push({
    event_id: event.event_id,
    revision: event.revision,
    action_type: event.action_type,
    event_digest: eventDigest,
  });

  if (v2Triggered && event.v2_control?.broker_reconciled === "exact_match" && event.v2_control?.broker_ledger) {
    const rec = reconcileV2Broker(nextLedger, event.instrument_id, event.v2_control);
    return {
      ok: true,
      replayed: false,
      external_flow_delta: "0",
      phantom_return: "0",
      phantom_drawdown: "0",
      ledger: rec.ledger,
      v2: rec.v2,
    };
  }

  return {
    ok: true,
    replayed: false,
    external_flow_delta: "0",
    phantom_return: "0",
    phantom_drawdown: "0",
    ledger: nextLedger,
    v2: structuredClone(nextLedger.v2),
  };
}

/**
 * Reconciles V2 HALT against broker ledger: auto-clears ONLY when adjusted equity,
 * instrument shares, and HWM match exactly with broker_reconciled === "exact_match".
 * Any mismatch leaves V2 halted and requires human re-arm.
 */
export function reconcileV2Broker(ledgerState, instrumentId, reconcilePayload = {}) {
  const nextLedger = structuredClone(ledgerState);
  const pos = nextLedger.positions?.[instrumentId];
  const broker = reconcilePayload?.broker_ledger;
  const rawHalted = Array.isArray(nextLedger.v2?.halted_instruments) && nextLedger.v2.halted_instruments.length > 0
    ? [...nextLedger.v2.halted_instruments]
    : (nextLedger.v2?.halted && Array.isArray(nextLedger.v2?.triggers)
      ? nextLedger.v2.triggers.map((t) => ({
        instrument_id: t.instrument_id,
        symbol: t.symbol || nextLedger.positions?.[t.instrument_id]?.symbol || null,
      }))
      : []);
  const withFailedTarget = () => {
    const next = [...rawHalted];
    if (instrumentId && !next.some((h) => h.instrument_id === instrumentId)) {
      next.push({
        instrument_id: instrumentId,
        symbol: pos?.symbol || reconcilePayload?.symbol || null,
      });
    }
    return next;
  };
  const haltedMatchesTarget = rawHalted.length === 0
    ? !nextLedger.v2?.halted
    : rawHalted.some((h) => h.instrument_id === instrumentId && (!reconcilePayload?.symbol || h.symbol === reconcilePayload.symbol));
  const payloadSymbolValid = !reconcilePayload?.symbol || reconcilePayload.symbol === pos?.symbol;

  const brokerEq = broker ? ratFromText(broker.adjusted_equity_usd) : null;
  const brokerShares = broker ? ratFromText(broker.shares) : null;
  const brokerHwm = broker ? ratFromText(broker.hwm_usd) : null;
  const ledgerEq = pos ? computeTotalEquityRat(nextLedger) : null;
  const ledgerShares = pos ? ratFromText(pos.units) : null;
  const ledgerHwm = ratFromText(nextLedger.loss_memory?.w_ref_usd);

  const ledgerExactMatch = Boolean(
    pos
    && broker
    && payloadSymbolValid
    && reconcilePayload?.broker_reconciled === "exact_match"
    && brokerEq && brokerShares && brokerHwm && ledgerEq && ledgerShares && ledgerHwm
    && ratCmp(brokerEq, ledgerEq) === 0
    && ratCmp(brokerShares, ledgerShares) === 0
    && ratCmp(brokerHwm, ledgerHwm) === 0,
  );

  if (!ledgerExactMatch || !haltedMatchesTarget) {
    const updatedHalted = !haltedMatchesTarget && ledgerExactMatch ? rawHalted : withFailedTarget();
    let failReason = "v2_reconcile_failed";
    if (!payloadSymbolValid || (ledgerExactMatch && !haltedMatchesTarget)) {
      failReason = "halted_instrument_mismatch";
    } else if (pos && broker && reconcilePayload?.broker_reconciled === "exact_match") {
      failReason = "v2_ledger_mismatch";
    }
    nextLedger.v2 = {
      ...nextLedger.v2,
      halted: true,
      state: "HALT",
      auto_cleared: false,
      human_rearm_required: true,
      halted_instruments: updatedHalted,
    };
    return {
      ok: false,
      reason: failReason,
      v2: structuredClone(nextLedger.v2),
      ledger: nextLedger,
    };
  }

  const remainingHalted = rawHalted.filter((h) => h.instrument_id !== instrumentId);
  const clearedAll = remainingHalted.length === 0;
  nextLedger.v2 = {
    ...nextLedger.v2,
    halted: !clearedAll,
    state: clearedAll ? "CLEAR" : "HALT",
    auto_cleared: clearedAll,
    human_rearm_required: !clearedAll,
    halted_instruments: remainingHalted,
  };
  return { ok: clearedAll, v2: structuredClone(nextLedger.v2), ledger: nextLedger };
}

/**
 * Verifies tier change invariance: changing tier drawdown limit D leaves
 * historical loss-memory tuple (dd_b, W_t^{ref}, L_t) untouched and updates c_t.
 */
export function evaluateTierChangeInvariance(ledgerState, newTierDrawdownLimitD) {
  const d = ratFromText(String(newTierDrawdownLimitD));
  const ddB = ratFromText(String(ledgerState?.loss_memory?.dd_b ?? "0"));
  if (!d || !ddB || d.n <= 0n) {
    throw new Error("invalid_tier_drawdown_limit");
  }
  const oneMinusDd = ratSub(ONE, ddB);
  const cT = ratCmp(ddB, d) >= 0 || oneMinusDd.n <= 0n ? ZERO : ratDiv(ratSub(d, ddB), oneMinusDd);
  return {
    dd_b: ledgerState.loss_memory.dd_b,
    w_ref_usd: ledgerState.loss_memory.w_ref_usd,
    l_usd: ledgerState.loss_memory.l_usd,
    tier_drawdown_limit_d: String(newTierDrawdownLimitD),
    c_t: ratToDecimalText(cT),
  };
}
