/** Read existing public Actions receipts. No dispatch, sender, KV scan, or storage writes. */
import { READ_ONLY } from "./operations.js";
const RUN_LIMIT = 5;
const MAX_ARCHIVE = 262144;
const MAX_JSON = 65536;
const RECEIPT_STATUSES = ["route_check", "dry_run", "blocked_missing_secrets", "delivered", "send_failed",
  "skipped_duplicate", "blocked_resend_guard", "business_digest_failed", "skipped_empty"];
const GUARD_REASONS = ["FIRST_SEND", "ALREADY_DELIVERED", "EXPLICIT_TEST_RESEND", "HISTORY_UNAVAILABLE",
  "DELIVERY_UNCERTAIN", "CONFIGURATION_INVALID", "UNSUPPORTED_EVENT", "LOCAL_EXECUTION", "DRY_RUN"];
const READ_STAGES = ["run_listing", "artifact_listing", "artifact_archive", "artifact_download", "receipt_decode", "receipt_projection", "sender_jobs"];
const READ_HTTP_STATUSES = [401, 403, 404, 429, 500, 502, 503, 504];
export const RECEIPT_READ_ERROR_CODES = ["receipt_read_timeout", "receipt_too_large", "receipt_body_missing", "invalid_receipt_archive", "public_receipt_missing", "invalid_public_receipt",
  ...READ_STAGES.flatMap(stage => [`${stage}_failed`, `${stage}_transport_failed`, `${stage}_http_other`, ...READ_HTTP_STATUSES.map(status => `${stage}_http_${status}`)])];
function readError(code) { return Object.assign(new Error("receipt_read_failed"), { receiptReadCode: code }); }
function readErrorCode(error, stage) {
  const code = error?.receiptReadCode || error?.message;
  return RECEIPT_READ_ERROR_CODES.includes(code) ? code : `${stage}_failed`;
}
const boolean = value => typeof value === "boolean" ? value : null;
const date = value => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const instant = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === value ? value : null;
};
const time = value => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;

// Completeness of this bounded receipt read, never proof of delivery or today's coverage.
function receiptReadCoverage(listing, runs, items, failures) {
  const reasons = [];
  if (listing.total_count === undefined) reasons.push("run_listing_coverage_unknown");
  else {
    if (listing.total_count > RUN_LIMIT) reasons.push("run_listing_truncated");
    if (runs.length < Math.min(listing.total_count, RUN_LIMIT)) reasons.push("run_listing_incomplete");
  }
  if (failures) reasons.push("notification_receipts_read_failed");
  for (const status of ["receipt_missing", "receipt_expired", "sender_skipped"]) {
    if (items.some(item => item.status === status)) reasons.push(status);
  }
  const status = failures && !items.some(item => item.status !== "read_failed") ? "read_failed"
    : reasons.length ? runs.length || listing.total_count > 0 ? "partial" : "unknown"
    : runs.length ? "complete" : "no_data";
  return { read_status: status,
    read_reason_codes: status === "no_data" ? ["no_completed_workflow_runs"] : reasons };
}

export async function boundedReceiptBytes(response, limit) {
  if (Number(response.headers.get("content-length")) > limit) throw Error("receipt_too_large");
  const reader = response.body?.getReader();
  if (!reader) throw Error("receipt_body_missing");
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw Error("receipt_too_large");
      chunks.push(value);
    }
  } catch (error) { await reader.cancel(); throw error; }
  const output = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}

/** Only the exact public JSON member is read; never extract private previews/files. */
export async function publicReceiptFromZip(archive, member = "receipt-public.json") {
  if (!["receipt-public.json", "runtime-control.safe.json"].includes(member)) throw Error("invalid_receipt_archive");
  if (archive.length > MAX_ARCHIVE) throw Error("receipt_too_large");
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  let end = archive.length - 22;
  while (end >= Math.max(0, archive.length - 65557) && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < Math.max(0, archive.length - 65557)) throw Error("invalid_receipt_archive");
  const count = view.getUint16(end + 10, true);
  if (count > 16 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw Error("invalid_receipt_archive");
  let offset = view.getUint32(end + 16, true); let receipt = null;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw Error("invalid_receipt_archive");
    const nameSize = view.getUint16(offset + 28, true);
    const next = offset + 46 + nameSize + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    if (next > end) throw Error("invalid_receipt_archive");
    const name = new TextDecoder().decode(archive.subarray(offset + 46, offset + 46 + nameSize));
    if (name === member) {
      if (receipt || view.getUint16(offset + 8, true) & 1) throw Error("invalid_receipt_archive");
      const method = view.getUint16(offset + 10, true);
      const compressed = view.getUint32(offset + 20, true), size = view.getUint32(offset + 24, true);
      const local = view.getUint32(offset + 42, true);
      if (size > MAX_JSON || local + 30 > offset || view.getUint32(local, true) !== 0x04034b50) throw Error("invalid_receipt_archive");
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      if (start + compressed > offset) throw Error("invalid_receipt_archive");
      const content = archive.subarray(start, start + compressed);
      const decoded = method === 0 ? content : method === 8
        ? await boundedReceiptBytes(new Response(new Blob([content]).stream().pipeThrough(new DecompressionStream("deflate-raw"))), MAX_JSON)
        : null;
      if (!decoded || decoded.length !== size) throw Error("invalid_receipt_archive");
      receipt = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decoded));
    }
    offset = next;
  }
  if (!receipt) throw Error("public_receipt_missing");
  return receipt;
}

export function projectNotificationReceipt(receipt, run) {
  if (!["qsl.daily_digest_receipt.v1", "qsl.daily_digest_delivery_receipt.v1"].includes(receipt?.schema_version)
    || receipt.projection !== "public_summary" || receipt.source_sha !== run.head_sha) throw Error("invalid_public_receipt");
  return {
    status: receipt.status === "delivered" && !(receipt.delivered === true && receipt.dry_run === false && receipt.test_message === false)
      ? "unknown" : RECEIPT_STATUSES.includes(receipt.status) ? receipt.status : "unknown",
    receipt_status: RECEIPT_STATUSES.includes(receipt.status) ? receipt.status : "unknown",
    business_day: date(receipt.business_day), report_date: date(receipt.report_date),
    delivered: boolean(receipt.delivered), dry_run: boolean(receipt.dry_run), test_message: boolean(receipt.test_message),
    reason_code: GUARD_REASONS.includes(receipt.resend_guard?.reason) ? receipt.resend_guard.reason : null,
    // The current public projection contains no sent_at. Workflow time is never substituted.
    sent_at: null,
  };
}

export function createNotificationLogReader(fetchImpl = (...args) => fetch(...args), now = Date.now) {
  const cache = new Map();
  return async function read({ repository, token, workflow = "daily-digest-notify.yml" } = {}) {
    const base = { as_of: null, items: [], next_cursor: null, coverage: "recent_daily_digest_public_receipts_only", ...READ_ONLY };
    if (!repository || !token) return { ...base, status: "not_connected", unavailable_reason: "notification_log_not_connected",
      read_status: "not_connected", read_reason_codes: ["notification_log_not_connected"] };
    const readFailed = { ...base, status: "read_failed", unavailable_reason: "notification_receipts_read_failed",
      read_status: "read_failed", read_reason_codes: ["notification_receipts_read_failed"] };
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[\w.-]+\.yml$/.test(workflow))
      return readFailed;
    const key = `${repository}/${workflow}`;
    const prior = cache.get(key);
    if (prior && now() - prior.at < 60000) return prior.result;
    const task = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const request = async (url, init, stage) => {
        try { return await fetchImpl(url, init); }
        catch { throw readError(controller.signal.aborted ? "receipt_read_timeout" : `${stage}_transport_failed`); }
      };
      const httpFailure = (response, stage) => readError(`${stage}_http_${READ_HTTP_STATUSES.includes(response.status) ? response.status : "other"}`);
      const api = async (path, archive = false, stage = "run_listing") => {
        const response = await request(`https://api.github.com/repos/${repository}/${path}`, {
          method: "GET", redirect: "manual", signal: controller.signal,
          headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "User-Agent": "console-receipt-reader", "X-GitHub-Api-Version": "2022-11-28" },
        }, stage);
        if (archive && response.status === 302) {
          const location = new URL(response.headers.get("location"));
          if (location.protocol !== "https:") throw Error("invalid_artifact_redirect");
          // Signed artifact URL: never forward the GitHub credential to blob storage.
          // workerd supports manual/follow, not error. Reject a second redirect
          // through the explicit HTTP check without forwarding any credential.
          const download = await request(location.href, { method: "GET", redirect: "manual", signal: controller.signal }, "artifact_download");
          if (!download.ok) throw httpFailure(download, "artifact_download");
          return boundedReceiptBytes(download, MAX_ARCHIVE);
        }
        if (!response.ok) throw httpFailure(response, stage);
        const body = await boundedReceiptBytes(response, archive ? MAX_ARCHIVE : 524288);
        return archive ? body : JSON.parse(new TextDecoder().decode(body));
      };
      try {
        const listing = await api(`actions/workflows/${encodeURIComponent(workflow)}/runs?branch=main&status=completed&per_page=${RUN_LIMIT}`);
        if (!Array.isArray(listing.workflow_runs)
          || (listing.total_count !== undefined && (!Number.isSafeInteger(listing.total_count)
            || listing.total_count < listing.workflow_runs.length))) throw Error("invalid_run_listing");
        const runs = listing.workflow_runs.slice(0, RUN_LIMIT);
        let failures = 0;
        const items = await Promise.all(runs.map(async run => {
          if (!Number.isSafeInteger(run?.id) || !Number.isSafeInteger(run.run_attempt) || !/^[a-f0-9]{40}$/.test(run.head_sha)
            || run.head_branch !== "main" || run.head_repository?.full_name?.toLowerCase() !== repository.toLowerCase()
            || !["schedule", "workflow_dispatch", "push"].includes(run.event)) { failures++; return null; }
          const item = { id: `${run.id}:${run.run_attempt}`, source_run_id: run.id, source_run_attempt: run.run_attempt,
            source_sha: run.head_sha, source_url: `https://github.com/${repository}/actions/runs/${run.id}/attempts/${run.run_attempt}`,
            workflow_updated_at: time(run.updated_at), sent_at: null, channel: "telegram", status: "receipt_missing",
            receipt_status: null, business_day: null, report_date: null, delivered: null, dry_run: null, test_message: null, reason_code: null };
          let stage = "artifact_listing";
          try {
            const artifacts = await api(`actions/runs/${run.id}/artifacts?per_page=100`, false, stage);
            if (!Array.isArray(artifacts.artifacts) || artifacts.total_count > 100) throw Error("incomplete_artifact_listing");
            const matches = artifacts.artifacts.filter(a => a.name === "daily-digest-receipt"
              && time(a.created_at) && time(run.run_started_at) && Date.parse(a.created_at) >= Date.parse(run.run_started_at));
            if (matches.length > 1) throw Error("ambiguous_receipt");
            const artifact = matches[0];
            if (artifact?.expired) return { ...item, status: "receipt_expired" };
            if (artifact) {
              if (!Number.isSafeInteger(artifact.id) || artifact.size_in_bytes > MAX_ARCHIVE) throw Error("invalid_artifact");
              stage = "artifact_archive";
              const archive = await api(`actions/artifacts/${artifact.id}/zip`, true, stage);
              stage = "receipt_decode";
              const receipt = await publicReceiptFromZip(archive);
              stage = "receipt_projection";
              return { ...item, ...projectNotificationReceipt(receipt, run) };
            }
            stage = "sender_jobs";
            const jobs = await api(`actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`, false, stage);
            if (!Array.isArray(jobs.jobs) || jobs.total_count > 100) throw Error("incomplete_jobs_listing");
            const senders = jobs.jobs.flatMap(job => job.steps || []).filter(step => step.name === "Aggregate, render, and send daily digest");
            if (senders.length === 1 && senders[0].conclusion === "skipped") return { ...item, status: "sender_skipped" };
            return item;
          } catch (error) { failures++; return { ...item, status: "read_failed", read_error_code: readErrorCode(error, stage) }; }
        }));
        const present = items.filter(Boolean);
        const coverage = receiptReadCoverage(listing, runs, present, failures);
        const status = coverage.read_status === "read_failed" ? "read_failed"
          : ["complete", "no_data"].includes(coverage.read_status) ? "ok" : "partial";
        return { ...base, ...coverage, status,
          unavailable_reason: failures ? "notification_receipts_read_failed"
            : status === "partial" ? "notification_receipts_incomplete" : null,
          as_of: new Date(now()).toISOString(),
          items: present, run_limit: RUN_LIMIT, truncated: listing.total_count > RUN_LIMIT, read_failure_count: failures };
      } catch (error) { return { ...readFailed, read_error_code: readErrorCode(error, "run_listing") }; }
      finally { clearTimeout(timeout); }
    })();
    if (cache.size >= 4) cache.delete(cache.keys().next().value);
    cache.set(key, { at: now(), result: task });
    return task;
  };
}
export const readNotificationLog = createNotificationLogReader();
