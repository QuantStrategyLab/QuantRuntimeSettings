/**
 * Market-benchmark HTTP use cases (read / sync / revision) and DO action set.
 *
 * Application layer over infrastructure/market_benchmark + runtimeInstanceCommand.
 * Does not open Durable Object transactions or import worker.js.
 */

import { HttpError } from "../http_error.js";
import { json, responseHeaders } from "../http_response.js";
import {
  hasRuntimeInstanceStore,
  runtimeInstanceCommand,
} from "../runtime_instances/command.js";
import {
  MARKET_BENCHMARK_SCHEMA,
  MarketBenchmarkError,
} from "../../infrastructure/market_benchmark/market_benchmark.js";
import {
  planRevisionApply,
  revisionApplyLogSummary,
  MarketBenchmarkRevisionError,
} from "../../infrastructure/market_benchmark/market_benchmark_revision.js";

export const MARKET_BENCHMARK_DO_ACTIONS = new Set([
  "market_benchmark_put", "market_benchmark_read", "market_benchmark_revise",
]);

async function readBoundedJson(request, maxBytes) {
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > maxBytes) throw new HttpError("request body is too large", 413);
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > maxBytes) throw new HttpError("request body is too large", 413);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError("request body must be valid JSON", 400);
  }
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function requireMarketBenchmarkSyncToken(request, env) {
  const expected = String(env.MARKET_BENCHMARK_SYNC_TOKEN || env.STRATEGY_SWITCH_SYNC_TOKEN || env.RUNTIME_SETTINGS_DISPATCH_TOKEN || "");
  if (!expected) throw new HttpError("market_benchmark_sync_token_missing", 503);
  const token = (request.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (!token || token !== expected) throw new HttpError("unauthorized", 401);
  // Fail closed if the bearer equals another dedicated sync token family when those are set differently.
  const forbidden = [
    env.ACCOUNT_FACTS_SYNC_TOKEN,
    env.IBKR_ACCOUNT_FACTS_SYNC_TOKEN,
    env.SCHWAB_ACCOUNT_FACTS_SYNC_TOKEN,
    env.FIRSTRADE_ACCOUNT_FACTS_SYNC_TOKEN,
    env.BINANCE_ACCOUNT_FACTS_SYNC_TOKEN,
    env.EXECUTION_EVIDENCE_SYNC_TOKEN,
  ].filter((value) => typeof value === "string" && value && value !== expected);
  if (forbidden.includes(token)) throw new HttpError("unauthorized", 401);
}

export async function marketBenchmarkResponse(request, env) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }
  if (!hasRuntimeInstanceStore(env)) {
    return json({ ok: false, error: "market_benchmark_store_unavailable" }, 503);
  }
  try {
    const stored = await runtimeInstanceCommand(env, {
      action: "market_benchmark_read",
    });
    const body = {
      ok: true,
      schema_version: MARKET_BENCHMARK_SCHEMA,
      inception_date: stored.inception_date ?? null,
      timezone: stored.timezone || "Asia/Shanghai",
      points: Array.isArray(stored.points) ? stored.points : [],
    };
    const headers = responseHeaders({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    return new Response(request.method === "HEAD" ? null : JSON.stringify(body), { status: 200, headers });
  } catch (error) {
    if (error instanceof HttpError) return json({ ok: false, error: error.message }, error.status || 500);
    return json({ ok: false, error: "market_benchmark_unavailable" }, 503);
  }
}

export function requireMarketBenchmarkRevisionToken(request, env) {
  // Dedicated secret only — never fall back to sync/dispatch tokens.
  const expected = String(env.MARKET_BENCHMARK_REVISION_TOKEN || "");
  if (!expected) throw new HttpError("market_benchmark_revision_token_missing", 503);
  const token = (request.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (!token || token !== expected) throw new HttpError("unauthorized", 401);
  const forbidden = [
    env.MARKET_BENCHMARK_SYNC_TOKEN,
    env.STRATEGY_SWITCH_SYNC_TOKEN,
    env.RUNTIME_SETTINGS_DISPATCH_TOKEN,
    env.ACCOUNT_FACTS_SYNC_TOKEN,
    env.IBKR_ACCOUNT_FACTS_SYNC_TOKEN,
    env.SCHWAB_ACCOUNT_FACTS_SYNC_TOKEN,
    env.FIRSTRADE_ACCOUNT_FACTS_SYNC_TOKEN,
    env.BINANCE_ACCOUNT_FACTS_SYNC_TOKEN,
    env.EXECUTION_EVIDENCE_SYNC_TOKEN,
  ].filter((value) => typeof value === "string" && value && value !== expected);
  if (forbidden.includes(token)) throw new HttpError("unauthorized", 401);
}

export async function reviseMarketBenchmarkResponse(request, env) {
  try {
    requireMarketBenchmarkRevisionToken(request, env);
  } catch (error) {
    if (error instanceof HttpError) return json({ ok: false, error: error.message }, error.status || 401);
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  if (!hasRuntimeInstanceStore(env)) {
    return json({ ok: false, error: "market_benchmark_store_unavailable" }, 503);
  }
  let raw;
  try {
    raw = await readBoundedJson(request, 64 * 1024);
  } catch (error) {
    if (error instanceof HttpError) return json({ ok: false, error: error.message }, error.status || 400);
    return json({ ok: false, error: "invalid_market_benchmark_revision_payload" }, 400);
  }
  try {
    const stored = await runtimeInstanceCommand(env, {
      action: "market_benchmark_read",
    });
    const appliedAt = typeof raw.applied_at === "string" && !Number.isNaN(Date.parse(raw.applied_at))
      ? raw.applied_at
      : new Date().toISOString();
    const digestHex = async (value) => sha256Hex(String(value));
    // planRevisionApply expects sync digest; pre-hash with Web Crypto then use a map.
    const strings = new Set();
    const proposal = raw.proposal;
    if (proposal && Array.isArray(proposal.entries)) {
      strings.add(JSON.stringify(proposal.entries));
      for (const entry of proposal.entries) {
        if (entry && typeof entry.series_id_sha256 === "string") strings.add(entry.series_id_sha256);
      }
    }
    for (const point of (raw.replacements || [])) {
      if (point?.seriesId) strings.add(point.seriesId);
      if (point?.close) strings.add(point.close);
    }
    for (const point of (Array.isArray(stored.points) ? stored.points : [])) {
      if (point?.close) strings.add(point.close);
      if (point?.seriesId) strings.add(point.seriesId);
    }
    const cache = new Map();
    for (const value of strings) cache.set(value, await digestHex(value));
    // Also hash every seriesId/close used by planRevisionApply via digest()
    const digest = (value) => {
      const text = String(value);
      if (cache.has(text)) return cache.get(text);
      throw new HttpError("benchmark_revision_digest_cache_miss", 500);
    };
    // Ensure proposal.entries JSON and all replacement/stored closes/seriesIds are cached —
    // re-walk after building any missing by computing individually.
    async function ensure(value) {
      const text = String(value);
      if (!cache.has(text)) cache.set(text, await digestHex(text));
      return cache.get(text);
    }
    await ensure(JSON.stringify(proposal?.entries || []));
    for (const point of (raw.replacements || [])) {
      await ensure(point.seriesId);
      await ensure(point.close);
    }
    for (const point of (Array.isArray(stored.points) ? stored.points : [])) {
      await ensure(point.seriesId);
      await ensure(point.close);
    }
    const plan = planRevisionApply({
      proposal: raw.proposal,
      approvedProposalSha256: raw.approved_proposal_sha256,
      replacements: raw.replacements || [],
      storedPoints: Array.isArray(stored.points) ? stored.points : [],
      digest: (value) => cache.get(String(value)) || (() => { throw new HttpError("benchmark_revision_digest_cache_miss", 500); })(),
      appliedAt,
      previouslyAppliedProposalSha256s: [],
    });
    const result = await runtimeInstanceCommand(env, {
      action: "market_benchmark_revise",
      plan: {
        proposal_sha256: plan.proposal_sha256,
        overwrites: plan.overwrites,
        deletes: plan.deletes,
        updates: plan.updates,
        ledger_entries: plan.ledger_entries,
      },
      applied_at: appliedAt,
    });
    return json({
      ok: true,
      applied: true,
      proposal_sha256: result.proposal_sha256 || plan.proposal_sha256,
      overwrites: result.overwrites || plan.overwrites,
      deletes: 0,
      ledger_entries: result.ledger_entries || plan.ledger_entries.length,
      log: revisionApplyLogSummary(plan),
    });
  } catch (error) {
    if (error instanceof HttpError) return json({ ok: false, error: error.message }, error.status || 500);
    if (error instanceof MarketBenchmarkRevisionError) return json({ ok: false, error: error.code }, error.status || 400);
    if (error instanceof MarketBenchmarkError) return json({ ok: false, error: error.code }, error.status || 400);
    return json({ ok: false, error: "market_benchmark_revision_failed" }, 502);
  }
}

export async function syncMarketBenchmarkResponse(request, env) {
  try {
    requireMarketBenchmarkSyncToken(request, env);
  } catch (error) {
    if (error instanceof HttpError) return json({ ok: false, error: error.message }, error.status || 401);
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  if (!hasRuntimeInstanceStore(env)) {
    return json({ ok: false, error: "market_benchmark_store_unavailable" }, 503);
  }
  let raw;
  try {
    raw = await readBoundedJson(request, 64 * 1024);
  } catch (error) {
    if (error instanceof HttpError) return json({ ok: false, error: error.message }, error.status || 400);
    return json({ ok: false, error: "invalid_market_benchmark_payload" }, 400);
  }
  try {
    const result = await runtimeInstanceCommand(env, {
      action: "market_benchmark_put",
      payload: raw,
    });
    return json({
      ok: true,
      stored: true,
      schema_version: MARKET_BENCHMARK_SCHEMA,
      inception_date: result.inception_date ?? null,
      written: result.written || 0,
      unchanged: result.unchanged || 0,
      points: result.points || 0,
    });
  } catch (error) {
    if (error instanceof HttpError) return json({ ok: false, error: error.message }, error.status || 500);
    if (error instanceof MarketBenchmarkError) return json({ ok: false, error: error.code }, error.status || 400);
    return json({ ok: false, error: "market_benchmark_sync_failed" }, 502);
  }
}
