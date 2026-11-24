import { rangeStart } from "../../performance_math.js";
import { mergeExecutionRecord } from "../account_facts/executions.js";
import {
  adaptLegacyBrokerExecutionPayload,
  evaluateAuthoritativeOrdersAndFills,
} from "../orders_fills/helpers.js";

const REQUIRED_FIELDS = ["execution_ref", "trade_date", "symbol", "asset_category", "side", "quantity", "price", "currency"];
const OPTIONAL_FIELDS = ["local_time", "time_zone", "commission", "commission_currency", "taxes"];
const SUBSTANTIVE_FIELDS = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS];
const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const fieldTupleKey = (row, fields) => JSON.stringify(fields.map(field => row[field] ?? null));
const entrySortOrder = (left, right) =>
  compareText(fieldTupleKey(left.row, SUBSTANTIVE_FIELDS), fieldTupleKey(right.row, SUBSTANTIVE_FIELDS))
  || compareText(left.platform, right.platform)
  || compareText(left.account_alias, right.account_alias)
  || compareText(left.row.report_ref || "", right.row.report_ref || "");

function compatibleOptional(leftRow, rightRow) {
  for (const field of OPTIONAL_FIELDS) {
    const left = leftRow[field] ?? null;
    const right = rightRow[field] ?? null;
    if (left !== null && right !== null && left !== right) return false;
  }
  return true;
}

function strictlyExtends(richerRow, partialRow) {
  let added = false;
  for (const field of OPTIONAL_FIELDS) {
    const richer = richerRow[field] ?? null;
    const partial = partialRow[field] ?? null;
    if (partial !== null && richer !== partial) return false;
    if (partial === null && richer !== null) added = true;
  }
  return added;
}

function mergeGroup(entries) {
  const sorted = [...entries].sort(entrySortOrder);
  let merged = { ...sorted[0].row };
  for (const entry of sorted.slice(1)) merged = mergeExecutionRecord(merged, entry.row);
  return { platform: sorted[0].platform, account_alias: sorted[0].account_alias, ...merged };
}

function maximalCliques(adj) {
  const cliques = [];
  const expand = (r, p, x) => {
    if (p.size === 0 && x.size === 0) {
      cliques.push([...r]);
      return;
    }
    // Pivot with maximum neighbors in p to prune branching on large partitions.
    let pivot = -1;
    let best = -1;
    for (const u of [...p, ...x]) {
      let deg = 0;
      for (const v of p) if (adj[u].has(v)) deg++;
      if (deg > best) { best = deg; pivot = u; }
    }
    const candidates = [...p].filter(v => !adj[pivot].has(v));
    for (const v of candidates) {
      const nextP = new Set([...p].filter(u => adj[v].has(u)));
      const nextX = new Set([...x].filter(u => adj[v].has(u)));
      r.push(v);
      expand(r, nextP, nextX);
      r.pop();
      p.delete(v);
      x.add(v);
    }
  };
  expand([], new Set(adj.keys()), new Set());
  return cliques;
}

function reduceExecutionBucket(bucket) {
  const byRequired = new Map();
  for (const entry of bucket) {
    const reqKey = fieldTupleKey(entry.row, REQUIRED_FIELDS);
    const list = byRequired.get(reqKey) || [];
    list.push(entry);
    byRequired.set(reqKey, list);
  }
  const out = [];
  for (const partition of byRequired.values()) {
    // Collapse exact substantive repeats first so repeat multiplicity never
    // alters compatibility or survives as duplicate rows.
    const bySubstantive = new Map();
    for (const entry of partition) {
      const subKey = fieldTupleKey(entry.row, SUBSTANTIVE_FIELDS);
      const list = bySubstantive.get(subKey) || [];
      list.push(entry);
      bySubstantive.set(subKey, list);
    }
    const nodes = [...bySubstantive.entries()]
      .sort((a, b) => compareText(a[0], b[0]))
      .map(([, entries]) => ({ row: entries[0].row, entries }));
    if (nodes.length === 1) {
      out.push(mergeGroup(nodes[0].entries));
      continue;
    }
    // Attribute strict projections only when their evidence identifies a
    // single substantive version and excludes competing maximal versions
    // against the fixed maximal set. Compatibility with an extension shared by
    // incompatible alternatives supplies no proof, so ambiguous nodes stay
    // distinct through clique handling while proven unique assignments absorb
    // before partial-only cliques can form.
    const isMaximal = nodes.map((_, i) => !nodes.some((other, j) => i !== j && strictlyExtends(other.row, nodes[i].row)));
    const maximalIndices = nodes.map((_, i) => i).filter(i => isMaximal[i]);
    const attributedNodes = maximalIndices.map(i => ({ row: nodes[i].row, entries: [...nodes[i].entries] }));
    const remainingNodes = [];
    for (let i = 0; i < nodes.length; i++) {
      if (isMaximal[i]) continue;
      const extensions = maximalIndices.filter(m => strictlyExtends(nodes[m].row, nodes[i].row));
      const compatMaximal = maximalIndices.filter(m => compatibleOptional(nodes[i].row, nodes[m].row));
      const uniqueTarget = extensions.length > 0 && compatMaximal.every((left, idx) =>
        compatMaximal.slice(idx + 1).every(right => compatibleOptional(nodes[left].row, nodes[right].row))
      );
      if (uniqueTarget) {
        attributedNodes[maximalIndices.indexOf(extensions[0])].entries.push(...nodes[i].entries);
      } else {
        remainingNodes.push({ row: nodes[i].row, entries: [...nodes[i].entries] });
      }
    }
    const activeNodes = [...attributedNodes, ...remainingNodes];
    if (activeNodes.length === 1) {
      out.push(mergeGroup(activeNodes[0].entries));
      continue;
    }
    const adj = activeNodes.map(() => new Set());
    let hasConflict = false;
    for (let i = 0; i < activeNodes.length; i++) {
      for (let j = i + 1; j < activeNodes.length; j++) {
        if (compatibleOptional(activeNodes[i].row, activeNodes[j].row)) {
          adj[i].add(j);
          adj[j].add(i);
        } else {
          hasConflict = true;
        }
      }
    }
    if (!hasConflict) {
      out.push(mergeGroup(activeNodes.flatMap(node => node.entries)));
      continue;
    }
    // Pairwise compatibility is non-transitive across partial observations:
    // assign a node to a substantive version only when it belongs to a unique
    // maximal clique across the whole bucket; ambiguous nodes stay separate.
    const cliques = maximalCliques(adj);
    const memberCliques = activeNodes.map(() => []);
    for (let c = 0; c < cliques.length; c++) {
      for (const nodeIndex of cliques[c]) memberCliques[nodeIndex].push(c);
    }
    const cliqueEntries = cliques.map(() => []);
    for (let i = 0; i < activeNodes.length; i++) {
      if (memberCliques[i].length === 1) {
        cliqueEntries[memberCliques[i][0]].push(...activeNodes[i].entries);
      } else {
        out.push(mergeGroup(activeNodes[i].entries));
      }
    }
    for (const entries of cliqueEntries) {
      if (entries.length) out.push(mergeGroup(entries));
    }
  }
  return out;
}

/** Only broker executions. Snapshot, benchmark and wallet failures are unrelated. */
export async function executionStatsResponse(options, { scope, range, today, groupOf = null }, env, deps) {
  const coverage = [], rows = [], buckets = new Map();
  let asOf = null, connected = 0, failures = 0;
  const start = range === "ALL" ? null : rangeStart(range.toLowerCase(), today);
  for (const option of options) {
    let source;
    try { source = deps.executions ? await deps.executions(option, env) : null; }
    catch {
      failures++;
      coverage.push({ platform: option.platform, account_alias: option.key, status: "unavailable",
        unavailable_reason: "stored_records_unreadable" });
      continue;
    }
    if (!source) {
      coverage.push({ platform: option.platform, account_alias: option.key, status: "not_connected",
        unavailable_reason: "fills_not_connected" });
      continue;
    }
    connected++;
    coverage.push({ platform: option.platform, account_alias: option.key, status: "partial",
      unavailable_reason: "execution_coverage_unverified", coverage: source.coverage, reports: source.reports, reports_truncated: source.reports_truncated ?? false });
    const observations = source.as_of ? [source.as_of] : source.reports.map(report => report.observed_at);
    for (const observedAt of observations) if (!asOf || Date.parse(observedAt) > Date.parse(asOf)) asOf = observedAt;
    // Sibling deployments of one physical account observe the same executions:
    // one execution reference in one group is bucketed across all reports.
    // Compatible supplemental fields merge deterministically across the bucket;
    // each substantively conflicting version is retained once.
    const owner = groupOf?.(option) ?? JSON.stringify([option.platform, option.key]);
    for (const row of source.records) {
      if (row.trade_date > today || start && row.trade_date < start) continue;
      const identity = JSON.stringify([owner, row.execution_ref]);
      const bucket = buckets.get(identity) || [];
      bucket.push({ platform: option.platform, account_alias: option.key, row });
      buckets.set(identity, bucket);
    }
  }
  for (const bucket of buckets.values()) rows.push(...reduceExecutionBucket(bucket));
  rows.sort((a, b) => compareText(b.trade_date, a.trade_date)
    || compareText(b.local_time || "", a.local_time || "")
    || compareText(a.execution_ref, b.execution_ref)
    || compareText(fieldTupleKey(a, SUBSTANTIVE_FIELDS), fieldTupleKey(b, SUBSTANTIVE_FIELDS))
    || compareText(a.platform, b.platform)
    || compareText(a.account_alias, b.account_alias)
    || compareText(a.report_ref || "", b.report_ref || ""));
  const status = connected ? "partial" : failures ? "unavailable" : "not_connected";
  return deps.json({ schema_version: "console_api.v1", scope, range, status,
    unavailable_reason: connected ? "execution_coverage_unverified"
      : failures ? "stored_records_unreadable" : "fills_not_connected",
    as_of: asOf, coverage, value_kind: "pnl", rows,
    // Count only the actual observed rows. These are neither closed trades nor a full history.
    reported_execution_count: connected ? rows.length : null,
    per_currency: [...new Set(rows.map(row => row.currency))].sort().map(currency => {
      const group = rows.filter(row => row.currency === currency);
      return { currency, reported_execution_count: group.length,
        buy_execution_count: group.filter(row => row.side === "BUY").length,
        sell_execution_count: group.filter(row => row.side === "SELL").length };
    }), win_rate_percent: null, realized_pnl: null,
  }, status === "unavailable" ? 503 : 200);
}

/**
 * Pure read-only C-SA-25 authoritative orders/fills projection helper.
 * Never touches KV or SQLite writes (ADR 0002 compliant).
 */
export function buildConsoleOrdersFillsReadModel(input = {}, _deps = {}) {
  const payload = input?.legacyPayload
    ? adaptLegacyBrokerExecutionPayload(input.legacyPayload, input.context || {})
    : input;
  return evaluateAuthoritativeOrdersAndFills(payload, {
    lockStore: input?.lockStore ?? null,
    priorKPendUsd: input?.priorKPendUsd ?? input?.prior_k_pend_usd ?? null,
    evaluated_at: input?.evaluated_at,
  });
}
