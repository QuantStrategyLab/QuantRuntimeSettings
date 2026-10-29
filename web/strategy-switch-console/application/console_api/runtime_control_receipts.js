import { boundedReceiptBytes, publicReceiptFromZip } from './notification_receipts.js';

// Read only the result of the exact QRS request. A missing or ambiguous read stays unknown.
export async function readRuntimeControlReceipt({ repository, token, requestId, operation, runId, requestedAt = null, checkId = null, fetchImpl = fetch }) {
  const unknown = { status: 'unknown' };
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '') || !token
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId || '')
      || !['enable', 'disable'].includes(operation) || (runId != null && !/^[1-9][0-9]*$/.test(String(runId)))
      || (checkId != null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(checkId))) return unknown;
  const title = checkId ? `Runtime control readback ${checkId}` : `Runtime control ${requestId}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`,
    'User-Agent': 'console-runtime-control-reader', 'X-GitHub-Api-Version': '2022-11-28' };
  const api = async (path, archive = false) => {
    let response = await fetchImpl(`https://api.github.com/repos/${repository}/${path}`, { headers, redirect: 'manual', signal: controller.signal });
    if (archive && response.status === 302) {
      const location = new URL(response.headers.get('location'));
      if (location.protocol !== 'https:') throw Error('invalid_redirect');
      response = await fetchImpl(location.href, { redirect: 'manual', signal: controller.signal });
    }
    if (!response.ok) throw Error('read_failed');
    const data = await boundedReceiptBytes(response, archive ? 262144 : 524288);
    return archive ? data : JSON.parse(new TextDecoder().decode(data));
  };
  let verifiedRunId = null;
  try {
    const workflow = await api('actions/workflows/manual-runtime-stop.yml');
    if (workflow.path !== '.github/workflows/manual-runtime-stop.yml') return unknown;
    if (runId == null) {
      const instant = Date.parse(requestedAt);
      if (!Number.isFinite(instant)) return unknown;
      const since = new Date(instant - 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
      const runs = [];
      let total, page = 0;
      while (true) {
        page++;
        const listing = await api(`actions/workflows/manual-runtime-stop.yml/runs?event=workflow_dispatch&branch=main&per_page=100&created=${encodeURIComponent('>=' + since)}&page=${page}`);
        if (!Number.isSafeInteger(listing.total_count) || !Array.isArray(listing.workflow_runs)) return unknown;
        total = listing.total_count;
        runs.push(...listing.workflow_runs);
        if (runs.length >= total) break;
        if (!listing.workflow_runs.length) return unknown;
      }
      if (runs.length !== total) return unknown;
      const matches = runs.filter(item => item.display_title === title
        && item.workflow_id === workflow.id && item.event === 'workflow_dispatch' && item.head_branch === 'main' && item.run_attempt === 1);
      if (matches.length !== 1 || !Number.isSafeInteger(matches[0].id) || matches[0].id <= 0) return unknown;
      runId = matches[0].id;
    }
    const run = await api(`actions/runs/${runId}`);
    if (workflow.path !== '.github/workflows/manual-runtime-stop.yml' || run.workflow_id !== workflow.id
        || String(run.id) !== String(runId) || run.run_attempt !== 1 || run.event !== 'workflow_dispatch'
        || run.head_branch !== 'main' || run.display_title !== title) return unknown;
    verifiedRunId = String(runId);
    if (run.status !== 'completed') return { status: 'unknown', run_id: verifiedRunId };
    const listing = await api(`actions/runs/${runId}/artifacts?per_page=100`);
    if (!Array.isArray(listing.artifacts) || !Number.isSafeInteger(listing.total_count) || listing.total_count > 100) return unknown;
    const matches = listing.artifacts.filter(item => item.name === `runtime-control-safe-${runId}-1` && !item.expired);
    if (matches.length !== 1 || !Number.isSafeInteger(matches[0].id) || !Number.isSafeInteger(matches[0].size_in_bytes)
        || matches[0].size_in_bytes > 262144) return unknown;
    const archive = await api(`actions/artifacts/${matches[0].id}/zip`, true);
    const receipt = await publicReceiptFromZip(archive, 'runtime-control.safe.json');
    if (receipt.request_id !== requestId || receipt.operation !== operation || String(receipt.run_id) !== String(runId)
        || String(receipt.attempt) !== '1' || (checkId && receipt.check_id !== checkId)
        || !['applied', 'partial', 'protected', 'rejected', 'unknown'].includes(receipt.status)) return unknown;
    const reason = ['runtime_control_workflow_permission_denied', 'runtime_control_workflow_unavailable', 'runtime_control_target_unsupported', 'stop_source_permission_denied', 'stop_source_not_accessible', 'platform_dispatch_rejected', 'platform_result_unavailable', 'platform_dispatch_unverified'].includes(receipt.reason) ? receipt.reason : null;
    const platformRunId = /^[1-9][0-9]*$/.test(String(receipt.platform_run_id || '')) ? String(receipt.platform_run_id) : null;
    return { status: receipt.status, run_id: String(runId), platform_run_id: platformRunId, reason, complete: true };
  } catch { return verifiedRunId ? { status: 'unknown', run_id: verifiedRunId } : unknown; }
  finally { clearTimeout(timeout); }
}
