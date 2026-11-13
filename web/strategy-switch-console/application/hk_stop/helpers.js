import { HttpError } from "../http_error.js";
import { HK_STOP_REQUEST_ID, HK_STOP_TARGET_ID } from "./constants.js";

export function hkStopSourceIdentity(config, item = {}) {
  const source = config || {};
  const selector = source.account_selector;
  const selectors = Array.isArray(selector)
    ? selector.map((value) => String(value).trim()).filter(Boolean)
    : String(selector || "").split(",").map((value) => value.trim()).filter(Boolean);
  const broker = source.broker_environment;
  return {
    key: String(source.key || item.key || ""),
    target_name: String(source.target_name || ""),
    platform_id: "longbridge",
    deployment_selector: String(source.deployment_selector || "").trim(),
    account_selector: selectors,
    account_scope: String(source.account_scope || "").trim(),
    service_name: String(source.service_name || "").trim(),
    variable_scope: source.variable_scope === "environment" ? "environment" : "",
    github_environment: String(source.github_environment || "").trim(),
    broker_environment: broker === "live" || broker === "paper" ? broker : null,
    runtime_status_target_id: String(source.runtime_status_target_id || "").trim(),
  };
}

export function hkStopDigestOrEmpty(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value) ? value : "";
}

export function hkStopExactObject(value, keys) {
  return Boolean(value) && !Array.isArray(value) && typeof value === "object"
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

export function normalizeHkStopResult(raw, env) {
  const expectedProject = env?.HK_STOP_GCP_PROJECT_ID;
  if (typeof expectedProject !== "string" || !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(expectedProject)) {
    throw new HttpError("hk_stop_project_not_configured", 503);
  }
  const top = ["schema_version", "request_id", "source_revision", "source_identity_sha256", "target_id", "runtime_identity_sha256", "producer", "observed_at", "readback", "no_order", "in_flight_state", "retirement_complete"];
  const producerKeys = ["repository", "workflow_path", "run_id", "run_attempt", "head_sha"];
  const readbackKeys = ["project", "region", "service", "revision_name", "runtime_enabled", "scheduler_state", "scheduler_count", "scheduler_set_sha256", "complete"];
  if (!hkStopExactObject(raw, top)
    || raw.schema_version !== "qsl_hk_stop_result.v1"
    || !HK_STOP_REQUEST_ID.test(String(raw.request_id || ""))
    || !Number.isSafeInteger(raw.source_revision) || raw.source_revision < 0
    || !hkStopDigestOrEmpty(raw.source_identity_sha256) || !hkStopDigestOrEmpty(raw.runtime_identity_sha256)
    || raw.target_id !== HK_STOP_TARGET_ID
    || !hkStopExactObject(raw.producer, producerKeys)
    || raw.producer.repository !== "QuantStrategyLab/LongBridgePlatform"
    || raw.producer.workflow_path !== ".github/workflows/stop-hk-runtime.yml"
    || !/^(0|[1-9][0-9]*)$/.test(raw.producer.run_id)
    || raw.producer.run_attempt !== 1
    || !/^[0-9a-f]{40}$/.test(raw.producer.head_sha)
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(raw.observed_at)
    || !hkStopExactObject(raw.readback, readbackKeys)
    || raw.readback.project !== expectedProject
    || raw.readback.region !== "asia-east2"
    || raw.readback.service !== "longbridge-quant-hk-service"
    || typeof raw.readback.revision_name !== "string"
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(raw.readback.revision_name)
    || raw.readback.runtime_enabled !== false
    || raw.readback.scheduler_state !== "paused"
    || !Number.isSafeInteger(raw.readback.scheduler_count) || raw.readback.scheduler_count < 1
    || !hkStopDigestOrEmpty(raw.readback.scheduler_set_sha256)
    || raw.readback.complete !== true
    || raw.no_order !== true
    || raw.in_flight_state !== "unknown"
    || raw.retirement_complete !== false) {
    throw new HttpError("hk_stop_result_rejected", 400);
  }
  return {
    schema_version: raw.schema_version,
    request_id: String(raw.request_id).toLowerCase(),
    source_revision: raw.source_revision,
    source_identity_sha256: raw.source_identity_sha256,
    target_id: raw.target_id,
    runtime_identity_sha256: raw.runtime_identity_sha256,
    producer: {
      repository: raw.producer.repository,
      workflow_path: raw.producer.workflow_path,
      run_id: raw.producer.run_id,
      run_attempt: raw.producer.run_attempt,
      head_sha: raw.producer.head_sha,
    },
    observed_at: raw.observed_at,
    readback: { ...raw.readback },
    no_order: true,
    in_flight_state: "unknown",
    retirement_complete: false,
  };
}

export function hkStopIdentityComplete(identity) {
  return identity?.key === "hk"
    && identity.target_name === "hk"
    && identity.platform_id === "longbridge"
    && identity.deployment_selector
    && identity.account_selector?.length
    && identity.account_scope === "HK"
    && identity.service_name === "longbridge-quant-hk-service"
    && identity.variable_scope === "environment"
    && identity.github_environment === "longbridge-hk";
}

export function presentHkStop(record, observation, repository) {
  const dispatchResult = record?.dispatch_result || null;
  return {
    ok: true,
    configured: false,
    platform_applied: false,
    request_succeeded: false,
    stop_confirmed: record?.phase === "stopped",
    in_flight_state: "unknown",
    reused: record?.reused === true,
    persisted: record?.persisted !== false,
    request_id: record?.request_id || null,
    phase: record?.phase || null,
    dispatch_result: dispatchResult,
    action: record ? "stop" : null,
    requested_at: record?.requested_at || null,
    updated_at: record?.updated_at || null,
    workflow_run_id: null,
    workflow_run_attempt: null,
    actions_url: dispatchResult === "accepted"
      ? `https://github.com/${repository}/actions/workflows/manual-runtime-stop.yml`
      : null,
    runtime_observation: observation || { status: "unknown", request_succeeded: false },
  };
}

export async function hkStopObservation() {
  // Lifecycle snapshots identify a target id, not this stop request's account.
  // A fresh disabled snapshot can belong to an older identity, so it stays unknown.
  return { status: "unknown", request_succeeded: false };
}
