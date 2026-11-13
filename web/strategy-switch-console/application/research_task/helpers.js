/**
 * Research-task normalize / assert / hash helpers and sync-token gate.
 *
 * Pure helpers extracted from runtime_support. Choice/domain identifiers and
 * strategy-health timestamp normalizers stay injected so this module never
 * imports runtime_support (avoids cycles).
 */

import { HttpError } from "../http_error.js";
import {
  RESEARCH_TASK_DASHBOARD_SCHEMA_VERSION,
  RESEARCH_TASK_DEFAULT_STALE_TTL_SECONDS,
  RESEARCH_TASK_OBJECTIVES,
  RESEARCH_TASK_SCHEMA_VERSION,
  RESEARCH_TASK_SOURCE_PREFIX,
  RESEARCH_TASK_SOURCE_SCHEMA_VERSION,
  RESEARCH_TASK_TYPES,
} from "./constants.js";

export function requireDedicatedResearchTaskSyncToken(request, env) {
  const expected = String(env.RESEARCH_TASK_SYNC_TOKEN || "");
  if (!expected) throw new HttpError("research task sync token is not configured", 500);
  const header = request.headers.get("Authorization") || "";
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (token !== expected) throw new HttpError("research task sync token is invalid", 401);
}

export function researchTaskSourceKey(sourceId) {
  return `${RESEARCH_TASK_SOURCE_PREFIX}${sourceId}`;
}

export function assertExactFields(value, fields, fieldName) {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${fieldName} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((item, index) => item !== expected[index])) {
    throw new Error(`${fieldName} has invalid fields`);
  }
  return value;
}

export function assertRequiredAndOptionalFields(value, requiredFields, optionalFields, fieldName) {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${fieldName} must be an object`);
  }
  const allowed = new Set([...requiredFields, ...optionalFields]);
  const actual = Object.keys(value);
  if (
    requiredFields.some((field) => !Object.prototype.hasOwnProperty.call(value, field))
    || actual.some((field) => !allowed.has(field))
  ) {
    throw new Error(`${fieldName} has invalid fields`);
  }
  return value;
}

export function normalizeResearchTaskIdentity(value, fieldName) {
  const text = String(value || "").trim();
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(text)) {
    throw new Error(`${fieldName} must be a stable identity`);
  }
  return text;
}

export function normalizeResearchTaskDigest(value, fieldName, nullable = false) {
  if ((value === null || value === undefined || value === "") && nullable) return null;
  const text = String(value || "").trim();
  if (!/^[0-9a-f]{64}$/.test(text)) throw new Error(`${fieldName} must be a lowercase SHA-256`);
  return text;
}

export function normalizeResearchTaskRevision(value, fieldName) {
  const text = String(value || "").trim();
  if (!/^[0-9a-f]{40}$/.test(text)) throw new Error(`${fieldName} must be a 40-character revision`);
  return text;
}

export function normalizeResearchTaskTimestamp(value, fieldName) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(text) || Number.isNaN(Date.parse(text))) {
    throw new Error(`${fieldName} must be a UTC timestamp`);
  }
  return text;
}

export function normalizeResearchTaskText(value, fieldName, maxLength) {
  const text = String(value || "").trim();
  if (!text || text.length > maxLength || /[<>\\]/.test(text)) throw new Error(`${fieldName} is invalid`);
  if (/\b(?:token|secret|password|credential|api[_ -]?key)\s*[:=]/i.test(text)) {
    throw new Error(`${fieldName} contains sensitive material`);
  }
  return text;
}

export function assertResearchTaskHasNoUnsafeMaterial(value, fieldName = "research task") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertResearchTaskHasNoUnsafeMaterial(item, `${fieldName}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (key !== "no_order" && /(?:secret|token|password|credential|api[_-]?key|order|fill|capital|account|broker)/i.test(key)) {
      throw new Error(`${fieldName} contains forbidden execution or secret material`);
    }
    assertResearchTaskHasNoUnsafeMaterial(nested, `${fieldName}.${key}`);
  }
}

export function canonicalResearchTaskJson(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("research task must use finite JSON values");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalResearchTaskJson).join(",")}]`;
  if (!value || typeof value !== "object") throw new Error("research task must use JSON values");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalResearchTaskJson(value[key])}`).join(",")}}`;
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function calculateResearchTaskSha256(payload) {
  const material = { ...payload };
  delete material.task_sha256;
  const raw = new TextEncoder().encode(canonicalResearchTaskJson(material));
  const digest = await crypto.subtle.digest("SHA-256", raw);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * @param {any} payload
 * @param {string} fieldName
 * @param {{
 *   cleanChoice: Function,
 *   CONTROL_PLANE_CANDIDATE_KINDS: string[],
 *   STRATEGY_HEALTH_DOMAINS: string[]|ReadonlyArray<string>,
 * }} deps
 */
export async function normalizeResearchTask(payload, fieldName, deps) {
  const { cleanChoice, CONTROL_PLANE_CANDIDATE_KINDS, STRATEGY_HEALTH_DOMAINS } = deps;
  const task = assertExactFields(payload, [
    "schema", "task_id", "created_at", "digest_algorithm", "task_type", "target", "evidence", "experiment", "authority", "task_sha256",
  ], fieldName);
  assertResearchTaskHasNoUnsafeMaterial(task, fieldName);
  if (task.schema !== RESEARCH_TASK_SCHEMA_VERSION) throw new Error(`${fieldName}.schema is unsupported`);
  if (task.digest_algorithm !== "sha256") throw new Error(`${fieldName}.digest_algorithm must be sha256`);
  const target = assertExactFields(task.target, ["candidate_id", "candidate_kind", "domain", "repository", "strategy_revision"], `${fieldName}.target`);
  const evidence = assertExactFields(task.evidence, ["p1_input_digest", "p2_config_digest", "p3_evidence_id", "producer_revision"], `${fieldName}.evidence`);
  const experiment = assertExactFields(task.experiment, ["objective", "hypothesis", "parameter_bounds_sha256", "max_runs", "max_wall_seconds"], `${fieldName}.experiment`);
  const authority = assertExactFields(task.authority, ["research_only", "no_order", "size_zero_required", "p4_p5_p6_authorized"], `${fieldName}.authority`);
  const normalized = {
    schema: RESEARCH_TASK_SCHEMA_VERSION,
    task_id: normalizeResearchTaskIdentity(task.task_id, `${fieldName}.task_id`),
    created_at: normalizeResearchTaskTimestamp(task.created_at, `${fieldName}.created_at`),
    digest_algorithm: "sha256",
    task_type: cleanChoice(task.task_type, RESEARCH_TASK_TYPES, `${fieldName}.task_type`),
    target: {
      candidate_id: normalizeResearchTaskIdentity(target.candidate_id, `${fieldName}.target.candidate_id`),
      candidate_kind: cleanChoice(target.candidate_kind, CONTROL_PLANE_CANDIDATE_KINDS, `${fieldName}.target.candidate_kind`),
      domain: cleanChoice(target.domain, STRATEGY_HEALTH_DOMAINS, `${fieldName}.target.domain`),
      repository: normalizeResearchTaskRepository(target.repository, `${fieldName}.target.repository`),
      strategy_revision: normalizeResearchTaskRevision(target.strategy_revision, `${fieldName}.target.strategy_revision`),
    },
    evidence: {
      p1_input_digest: normalizeResearchTaskDigest(evidence.p1_input_digest, `${fieldName}.evidence.p1_input_digest`, true),
      p2_config_digest: normalizeResearchTaskDigest(evidence.p2_config_digest, `${fieldName}.evidence.p2_config_digest`, true),
      p3_evidence_id: normalizeResearchTaskDigest(evidence.p3_evidence_id, `${fieldName}.evidence.p3_evidence_id`, true),
      producer_revision: normalizeResearchTaskRevision(evidence.producer_revision, `${fieldName}.evidence.producer_revision`),
    },
    experiment: {
      objective: cleanChoice(experiment.objective, RESEARCH_TASK_OBJECTIVES, `${fieldName}.experiment.objective`),
      hypothesis: normalizeResearchTaskText(experiment.hypothesis, `${fieldName}.experiment.hypothesis`, 800),
      parameter_bounds_sha256: normalizeResearchTaskDigest(experiment.parameter_bounds_sha256, `${fieldName}.experiment.parameter_bounds_sha256`, true),
      max_runs: normalizeResearchTaskBound(experiment.max_runs, `${fieldName}.experiment.max_runs`, 100),
      max_wall_seconds: normalizeResearchTaskBound(experiment.max_wall_seconds, `${fieldName}.experiment.max_wall_seconds`, 86400),
    },
    authority: {
      research_only: authority.research_only,
      no_order: authority.no_order,
      size_zero_required: authority.size_zero_required,
      p4_p5_p6_authorized: authority.p4_p5_p6_authorized,
    },
    task_sha256: normalizeResearchTaskDigest(task.task_sha256, `${fieldName}.task_sha256`),
  };
  if (JSON.stringify(normalized.authority) !== JSON.stringify({ research_only: true, no_order: true, size_zero_required: true, p4_p5_p6_authorized: false })) {
    throw new Error(`${fieldName}.authority must be fixed to offline research only`);
  }
  if (normalized.task_sha256 !== await calculateResearchTaskSha256(normalized)) {
    throw new Error(`${fieldName}.task_sha256 mismatch`);
  }
  return normalized;
}

export function normalizeResearchTaskRepository(value, fieldName) {
  const text = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(text)) {
    throw new Error(`${fieldName} is invalid`);
  }
  return text;
}

export function normalizeResearchTaskBound(value, fieldName, maximum) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${fieldName} is outside its safe bound`);
  }
  return value;
}

/**
 * @param {any} payload
 * @param {string} [fieldName]
 * @param {{
 *   cleanChoice: Function,
 *   CONTROL_PLANE_CANDIDATE_KINDS: string[],
 *   STRATEGY_HEALTH_DOMAINS: string[]|ReadonlyArray<string>,
 *   STRATEGY_HEALTH_DATA_STATUSES: string[],
 *   normalizeControlPlaneIdentifier: Function,
 *   normalizeStrategyHealthTimestamp: Function,
 *   normalizeStrategyHealthErrors: Function,
 * }} deps
 */
export async function normalizeResearchTaskSourceSnapshot(
  payload,
  fieldName = "research task source snapshot",
  deps,
) {
  const {
    cleanChoice,
    STRATEGY_HEALTH_DATA_STATUSES,
    normalizeControlPlaneIdentifier,
    normalizeStrategyHealthTimestamp,
    normalizeStrategyHealthErrors,
  } = deps;
  const source = assertExactFields(payload, ["schema_version", "source_id", "generated_at", "computed_at", "data_status", "tasks", "errors"], fieldName);
  if (source.schema_version !== RESEARCH_TASK_SOURCE_SCHEMA_VERSION) throw new Error(`${fieldName}.schema_version is unsupported`);
  const dataStatus = cleanChoice(source.data_status, STRATEGY_HEALTH_DATA_STATUSES, `${fieldName}.data_status`);
  if (!Array.isArray(source.tasks) || source.tasks.length > 100) {
    throw new Error(`${fieldName}.tasks must be an array with at most 100 items`);
  }
  const tasks = [];
  const seen = new Set();
  for (const [index, item] of source.tasks.entries()) {
    const task = await normalizeResearchTask(item, `${fieldName}.tasks[${index}]`, deps);
    if (seen.has(task.task_id)) throw new Error(`${fieldName}.tasks contains duplicate task_id`);
    seen.add(task.task_id);
    tasks.push(task);
  }
  if (dataStatus === "unavailable" && tasks.length) throw new Error(`${fieldName}.tasks must be empty when unavailable`);
  return {
    schema_version: RESEARCH_TASK_SOURCE_SCHEMA_VERSION,
    source_id: normalizeControlPlaneIdentifier(source.source_id, `${fieldName}.source_id`, false),
    generated_at: normalizeStrategyHealthTimestamp(source.generated_at, `${fieldName}.generated_at`, true),
    computed_at: normalizeStrategyHealthTimestamp(source.computed_at, `${fieldName}.computed_at`, true),
    data_status: dataStatus,
    tasks,
    errors: normalizeStrategyHealthErrors(source.errors),
  };
}

export function emptyResearchTaskSourceSnapshot(errorCode) {
  return {
    schema_version: RESEARCH_TASK_SOURCE_SCHEMA_VERSION,
    source_id: "unavailable",
    generated_at: null,
    computed_at: null,
    data_status: "unavailable",
    tasks: [],
    errors: [errorCode],
  };
}

export function emptyResearchTaskPayload(errorCode) {
  return {
    schema_version: RESEARCH_TASK_DASHBOARD_SCHEMA_VERSION,
    generated_at: null,
    computed_at: null,
    data_status: "unavailable",
    summary: { task_count: 0 },
    tasks: [],
    policy: {
      research_only: true,
      no_order: true,
      size_zero_required: true,
      p4_p5_p6_authorized: false,
      notice: "研究任务只用于离线、零仓位实验；不会调参、改代码、部署或下单。",
    },
    errors: [errorCode],
  };
}

export function researchTaskStaleTtlSeconds(env) {
  const configured = Number(env.RESEARCH_TASK_STALE_TTL_SECONDS);
  if (!Number.isFinite(configured) || configured < 300 || configured > 604800) {
    return RESEARCH_TASK_DEFAULT_STALE_TTL_SECONDS;
  }
  return Math.floor(configured);
}
